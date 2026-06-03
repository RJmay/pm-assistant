import type { Client, Json } from "@pm/db";
import { buildTradieQuoteRequest } from "@pm/prompts";
import { RuleNotConfiguredError, RuleNotFoundError, triageEmergencyRepair } from "@pm/rules";
import type { MaintenanceClassification, MaintenanceQuote } from "@pm/shared";
import type { Logger } from "../lib/log";
import { resolvePmName, resolvePropertyAddress } from "./sequences/resolve";
import { writeAuditLog } from "./supabase";

// ============================================================================
// Maintenance coordination service (Phase 3, spec §9)
// ============================================================================
// PM-initiated: from a MAINTENANCE draft the PM creates a job (triaged
// EMERGENCY vs routine via the rules-engine s214 list), then we draft tradie
// quote requests to the agency's approved tradies for the trade. Every outbound
// message is an ai_drafts row (draft_source='maintenance', linked via
// maintenance_job_id) queued for the PM to review and send — never auto-sent.
// All queries are agency-scoped (service-role bypasses RLS).
// ============================================================================

const PG_UNIQUE_VIOLATION = "23505";
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

interface ConfigTradie {
  trade: string;
  name: string;
  email?: string;
  business_hours_contact?: string;
  after_hours_contact?: string;
}

/** First email-looking contact for a tradie, or null. */
function tradieEmail(t: ConfigTradie): string | null {
  for (const c of [t.email, t.business_hours_contact, t.after_hours_contact]) {
    if (c && c.includes("@")) return c.trim();
  }
  return null;
}

function aestToday(now: Date): string {
  return new Date(now.getTime() + AEST_OFFSET_MS).toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
// Create a job from a MAINTENANCE draft
// ----------------------------------------------------------------------------

export interface CreateJobInput {
  agencyId: string;
  /** The inbound MAINTENANCE ai_drafts row the PM is acting on. */
  draftId: string;
  createdByPmId: string;
  /** Optional issue override; otherwise derived from the inbound email. */
  issue?: string;
  /** Optional trade override the PM picked. */
  trade?: string;
}

export interface CreateJobResult {
  jobId: string;
  classification: MaintenanceClassification;
  propertyId: string | null;
  alreadyExisted: boolean;
}

export async function createMaintenanceJob(
  client: Client,
  input: CreateJobInput,
  deps: { logger: Logger; now?: () => Date },
): Promise<CreateJobResult> {
  const now = deps.now ?? (() => new Date());

  const { data: draft, error: draftErr } = await client
    .from("ai_drafts")
    .select("id, email_message_id, draft_subject, category")
    .eq("agency_id", input.agencyId)
    .eq("id", input.draftId)
    .maybeSingle();
  if (draftErr) throw new Error(`ai_drafts lookup failed: ${draftErr.message}`);
  if (!draft) throw new MaintenanceError("draft_not_found", "draft not found");
  if (!draft.email_message_id) {
    throw new MaintenanceError("not_inbound", "a job can only be created from an inbound draft");
  }

  // Inbound message → text for triage + the thread's property.
  const { data: inbound } = await client
    .from("email_messages")
    .select("subject, body_plain, body_html, thread_id")
    .eq("agency_id", input.agencyId)
    .eq("id", draft.email_message_id)
    .maybeSingle();
  let propertyId: string | null = null;
  if (inbound?.thread_id) {
    const { data: thread } = await client
      .from("email_threads")
      .select("property_id")
      .eq("agency_id", input.agencyId)
      .eq("id", inbound.thread_id)
      .maybeSingle();
    propertyId = thread?.property_id ?? null;
  }

  const issue =
    input.issue?.trim() ||
    inbound?.subject?.trim() ||
    draft.draft_subject?.trim() ||
    "Maintenance request";
  const inboundText = `${inbound?.subject ?? ""}\n${inbound?.body_plain ?? inbound?.body_html ?? ""}`;
  const classification = classify(inboundText, aestToday(now()), deps.logger);

  // Insert the job; the unique index on source_draft_id makes this idempotent —
  // a second click on the same draft returns the existing job.
  const { data: created, error: insErr } = await client
    .from("maintenance_jobs")
    .insert({
      agency_id: input.agencyId,
      property_id: propertyId,
      source_draft_id: input.draftId,
      source_email_message_id: draft.email_message_id,
      issue,
      classification,
      trade: input.trade ?? null,
      state: "new",
      created_by: input.createdByPmId,
    })
    .select("id")
    .single();

  if (insErr) {
    if (insErr.code === PG_UNIQUE_VIOLATION) {
      const { data: existing } = await client
        .from("maintenance_jobs")
        .select("id, classification, property_id")
        .eq("agency_id", input.agencyId)
        .eq("source_draft_id", input.draftId)
        .maybeSingle();
      if (existing) {
        return {
          jobId: existing.id,
          classification: existing.classification,
          propertyId: existing.property_id,
          alreadyExisted: true,
        };
      }
    }
    throw new Error(`maintenance_jobs insert failed: ${insErr.message}`);
  }

  await writeAuditLog(client, {
    agency_id: input.agencyId,
    actor_type: "user",
    actor_id: input.createdByPmId,
    action: "maintenance.job_created",
    entity_type: "maintenance_jobs",
    entity_id: created.id,
    metadata: { source_draft_id: input.draftId, classification, property_id: propertyId, issue },
  });

  deps.logger.info("maintenance job created", {
    job_id: created.id,
    classification,
    property_id: propertyId,
  });
  return { jobId: created.id, classification, propertyId, alreadyExisted: false };
}

function classify(text: string, asOf: string, log: Logger): MaintenanceClassification {
  try {
    return triageEmergencyRepair(text, asOf).isEmergency ? "emergency" : "routine";
  } catch (err) {
    if (err instanceof RuleNotConfiguredError || err instanceof RuleNotFoundError) {
      log.warn("maintenance: s214 triage unavailable; defaulting to routine", {
        error: err.message,
      });
      return "routine";
    }
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Draft tradie quote requests for a job's trade
// ----------------------------------------------------------------------------

export interface QuoteRequestInput {
  agencyId: string;
  jobId: string;
  /** Trade to source quotes for (matches agency_config.approved_tradies.trade). */
  trade: string;
  createdByPmId: string;
}

export interface QuoteRequestResult {
  tradiesMatched: number;
  drafted: number;
  skippedNoEmail: number;
}

export async function draftTradieQuoteRequests(
  client: Client,
  input: QuoteRequestInput,
  deps: { logger: Logger; now?: () => Date },
): Promise<QuoteRequestResult> {
  const now = deps.now ?? (() => new Date());

  const { data: job, error: jobErr } = await client
    .from("maintenance_jobs")
    .select("id, property_id, issue, classification, quotes, trade")
    .eq("agency_id", input.agencyId)
    .eq("id", input.jobId)
    .maybeSingle();
  if (jobErr) throw new Error(`maintenance_jobs lookup failed: ${jobErr.message}`);
  if (!job) throw new MaintenanceError("job_not_found", "job not found");

  const [{ data: config }, { data: agency }] = await Promise.all([
    client
      .from("agency_config")
      .select("approved_tradies, pm_signoff_default")
      .eq("agency_id", input.agencyId)
      .maybeSingle(),
    client.from("agencies").select("name").eq("id", input.agencyId).maybeSingle(),
  ]);

  const tradies = ((config?.approved_tradies ?? []) as unknown as ConfigTradie[]).filter(
    (t) => t.trade?.toLowerCase() === input.trade.toLowerCase(),
  );
  const propertyAddress = await resolvePropertyAddress(client, input.agencyId, job.property_id);
  const pmName = await resolvePmName(client, input.agencyId, job.property_id);
  const agencyName = agency?.name ?? "";
  const pmSignoff = config?.pm_signoff_default ?? undefined;
  const isEmergency = job.classification === "emergency";

  const existingQuotes = (job.quotes ?? []) as unknown as MaintenanceQuote[];
  const newQuotes: MaintenanceQuote[] = [];
  let drafted = 0;
  let skippedNoEmail = 0;

  for (const tradie of tradies) {
    const email = tradieEmail(tradie);
    if (!email) {
      skippedNoEmail += 1;
      deps.logger.warn("maintenance: tradie has no email; skipping quote request", {
        tradie: tradie.name,
      });
      continue;
    }
    const built = buildTradieQuoteRequest({
      tradieName: tradie.name,
      trade: input.trade,
      propertyAddress,
      issueSummary: job.issue,
      isEmergency,
      agencyName,
      pmName,
      pmSignoff,
    });

    const { data: draft, error: draftErr } = await client
      .from("ai_drafts")
      .insert({
        agency_id: input.agencyId,
        draft_source: "maintenance",
        maintenance_job_id: input.jobId,
        property_id: job.property_id,
        recipient_email: email,
        recipient_name: tradie.name,
        category: "MAINTENANCE",
        category_confidence: "HIGH",
        priority: isEmergency ? "PRIORITY" : "STANDARD",
        escalation_flag: "NONE",
        emergency_landlord_alert: false,
        safety_critical: false,
        do_not_send: false,
        draft_confidence: "HIGH",
        draft_subject: built.subject,
        draft_body: built.body,
        pm_review_notes: built.reviewNotes as unknown as Json,
        model_used: "template:tradie_quote_request_v1",
        match_confidence: "high",
        status: "pending",
      })
      .select("id")
      .single();
    if (draftErr || !draft) {
      throw new Error(`quote-request ai_drafts insert failed: ${draftErr?.message ?? "no row"}`);
    }

    newQuotes.push({
      id: crypto.randomUUID(),
      tradie_name: tradie.name,
      trade: input.trade,
      status: "requested",
      requested_at: now().toISOString(),
      draft_id: draft.id,
    });
    drafted += 1;

    await writeAuditLog(client, {
      agency_id: input.agencyId,
      actor_type: "user",
      actor_id: input.createdByPmId,
      action: "maintenance.quote_requested",
      entity_type: "maintenance_jobs",
      entity_id: input.jobId,
      metadata: { tradie: tradie.name, draft_id: draft.id, recipient: email },
    });
  }

  if (drafted > 0) {
    const { error: updErr } = await client
      .from("maintenance_jobs")
      .update({
        quotes: [...existingQuotes, ...newQuotes] as unknown as Json,
        state: "quoting",
        trade: job.trade ?? input.trade,
      })
      .eq("agency_id", input.agencyId)
      .eq("id", input.jobId);
    if (updErr) throw new Error(`maintenance_jobs update failed: ${updErr.message}`);
  }

  deps.logger.info("maintenance quote requests drafted", {
    job_id: input.jobId,
    tradies_matched: tradies.length,
    drafted,
    skipped_no_email: skippedNoEmail,
  });
  return { tradiesMatched: tradies.length, drafted, skippedNoEmail };
}

/** Typed error so the route can map a known cause to the right HTTP status. */
export class MaintenanceError extends Error {
  override readonly name = "MaintenanceError";
  readonly code: "draft_not_found" | "not_inbound" | "job_not_found";
  constructor(code: MaintenanceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
