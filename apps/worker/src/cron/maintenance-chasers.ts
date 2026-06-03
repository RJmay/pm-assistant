import type { Client, Json } from "@pm/db";
import { buildTradieQuoteChaser } from "@pm/prompts";
import type { MaintenanceQuote } from "@pm/shared";
import type { WorkerBindings } from "../lib/env";
import type { Logger } from "../lib/log";
import { resolvePmName, resolvePropertyAddress } from "../services/sequences/resolve";
import { createServiceClient, writeAuditLog } from "../services/supabase";

// ============================================================================
// Quote-chaser scan (Phase 3, spec §9 "track/chase quotes")
// ============================================================================
// Runs in the daily sequence sweep. For each job still in 'quoting', any quote
// that's been 'requested' for more than CHASE_AFTER_DAYS and hasn't been chased
// yet gets a follow-up draft to the tradie. Idempotent: we stamp the quote's
// `chased_at` so it's never chased twice. Drafted-and-queued, never auto-sent.
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_CHASE_AFTER_DAYS = 3;

export interface QuoteChaserResult {
  agenciesInspected: number;
  jobsInspected: number;
  chasersDrafted: number;
  failures: number;
}

export async function runQuoteChaserScan(
  env: WorkerBindings,
  log: Logger,
  now: Date = new Date(),
): Promise<QuoteChaserResult> {
  const supabase = createServiceClient(env);
  const cutoffMs = now.getTime() - DEFAULT_CHASE_AFTER_DAYS * MS_PER_DAY;

  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, name")
    .eq("status", "active");
  if (error) throw new Error(`quote chaser: agencies scan failed: ${error.message}`);

  const result: QuoteChaserResult = {
    agenciesInspected: 0,
    jobsInspected: 0,
    chasersDrafted: 0,
    failures: 0,
  };

  for (const agency of agencies ?? []) {
    result.agenciesInspected += 1;
    const agencyLog = log.child({ agency_id: agency.id });
    try {
      const { data: config } = await supabase
        .from("agency_config")
        .select("pm_signoff_default")
        .eq("agency_id", agency.id)
        .maybeSingle();
      const pmSignoff = config?.pm_signoff_default ?? undefined;

      const { data: jobs, error: jobsErr } = await supabase
        .from("maintenance_jobs")
        .select("id, property_id, issue, trade, quotes")
        .eq("agency_id", agency.id)
        .eq("state", "quoting");
      if (jobsErr) throw new Error(`maintenance_jobs scan failed: ${jobsErr.message}`);

      for (const job of jobs ?? []) {
        result.jobsInspected += 1;
        try {
          const drafted = await chaseJob(supabase, {
            agencyId: agency.id,
            agencyName: agency.name,
            jobId: job.id,
            propertyId: job.property_id,
            issue: job.issue,
            quotes: (job.quotes ?? []) as unknown as MaintenanceQuote[],
            cutoffMs,
            pmSignoff,
            now,
            log: agencyLog,
          });
          result.chasersDrafted += drafted;
        } catch (err) {
          result.failures += 1;
          agencyLog.error("quote chaser: job failure", {
            job_id: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      result.failures += 1;
      agencyLog.error("quote chaser: per-agency failure", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

interface ChaseJobInput {
  agencyId: string;
  agencyName: string;
  jobId: string;
  propertyId: string | null;
  issue: string;
  quotes: MaintenanceQuote[];
  cutoffMs: number;
  pmSignoff: string | undefined;
  now: Date;
  log: Logger;
}

async function chaseJob(client: Client, input: ChaseJobInput): Promise<number> {
  const stale = input.quotes.filter(
    (q) =>
      q.status === "requested" &&
      !q.chased_at &&
      q.draft_id &&
      Date.parse(q.requested_at) <= input.cutoffMs,
  );
  if (stale.length === 0) return 0;

  const propertyAddress = await resolvePropertyAddress(client, input.agencyId, input.propertyId);
  const pmName = await resolvePmName(client, input.agencyId, input.propertyId);
  const chasedAt = input.now.toISOString();
  const chasedQuoteIds = new Set<string>();
  let drafted = 0;

  for (const quote of stale) {
    // The original quote-request draft holds the tradie's email + trade.
    const { data: orig } = await client
      .from("ai_drafts")
      .select("recipient_email")
      .eq("agency_id", input.agencyId)
      .eq("id", quote.draft_id as string)
      .maybeSingle();
    if (!orig?.recipient_email) continue;

    const built = buildTradieQuoteChaser({
      tradieName: quote.tradie_name,
      trade: quote.trade,
      propertyAddress,
      issueSummary: input.issue,
      agencyName: input.agencyName,
      pmName,
      pmSignoff: input.pmSignoff,
    });

    const { data: draft, error: draftErr } = await client
      .from("ai_drafts")
      .insert({
        agency_id: input.agencyId,
        draft_source: "maintenance",
        maintenance_job_id: input.jobId,
        property_id: input.propertyId,
        recipient_email: orig.recipient_email,
        recipient_name: quote.tradie_name,
        category: "MAINTENANCE",
        category_confidence: "HIGH",
        priority: "STANDARD",
        escalation_flag: "NONE",
        emergency_landlord_alert: false,
        safety_critical: false,
        do_not_send: false,
        draft_confidence: "HIGH",
        draft_subject: built.subject,
        draft_body: built.body,
        pm_review_notes: built.reviewNotes as unknown as Json,
        model_used: "template:tradie_quote_chaser_v1",
        match_confidence: "high",
        status: "pending",
      })
      .select("id")
      .single();
    if (draftErr || !draft) {
      throw new Error(`chaser ai_drafts insert failed: ${draftErr?.message ?? "no row"}`);
    }
    chasedQuoteIds.add(quote.id);
    drafted += 1;

    await writeAuditLog(client, {
      agency_id: input.agencyId,
      actor_type: "system",
      action: "maintenance.quote_chased",
      entity_type: "maintenance_jobs",
      entity_id: input.jobId,
      metadata: { quote_id: quote.id, tradie: quote.tradie_name, draft_id: draft.id },
    });
  }

  if (chasedQuoteIds.size > 0) {
    const nextQuotes = input.quotes.map((q) =>
      chasedQuoteIds.has(q.id) ? { ...q, chased_at: chasedAt } : q,
    );
    const { error: updErr } = await client
      .from("maintenance_jobs")
      .update({ quotes: nextQuotes as unknown as Json })
      .eq("agency_id", input.agencyId)
      .eq("id", input.jobId);
    if (updErr) throw new Error(`maintenance_jobs update failed: ${updErr.message}`);
    input.log.info("quote chasers drafted", { job_id: input.jobId, drafted });
  }

  return drafted;
}
