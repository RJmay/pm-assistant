import type { Client } from "@pm/db";
import { buildArrearsDraft } from "@pm/prompts";
import type { WorkerBindings } from "../lib/env";
import type { Logger } from "../lib/log";
import {
  resolvePmName,
  resolvePrimaryTenant,
  resolvePropertyAddress,
} from "../services/sequences/resolve";
import {
  advanceRun,
  configNumber,
  getSequenceConfig,
  insertSequenceDraft,
  openRun,
} from "../services/sequences/runs";
import { createServiceClient, writeAuditLog } from "../services/supabase";

// ============================================================================
// Arrears reminder scan (Phase 2, spec §8 "Arrears sequence")
// ============================================================================
// Fires daily. Arrears are flagged MANUALLY (no payment feed yet) via
// tenancies.arrears_since. For each active agency with the arrears sequence
// enabled, draft ONE courtesy reminder per arrears episode (idempotent on the
// arrears_since date) and, when overdue beyond the agency's operational
// escalation policy, flag the PM to consider a formal notice. Never auto-sends;
// never asserts a statutory threshold.
// ============================================================================

const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Operational policy (NOT a statutory fact): after how many days overdue we
// nudge the PM to consider escalation. Configurable per agency.
const DEFAULT_ESCALATE_AFTER_DAYS = 7;

function aestToday(now: Date): string {
  return new Date(now.getTime() + AEST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both `YYYY-MM-DD`); negative if to < from. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

export interface ArrearsResult {
  agenciesInspected: number;
  agenciesSkipped: number;
  tenanciesConsidered: number;
  draftsCreated: number;
  alreadyHandled: number;
  noRecipient: number;
  escalationsFlagged: number;
  failures: number;
}

export async function runArrearsScan(
  env: WorkerBindings,
  log: Logger,
  now: Date = new Date(),
): Promise<ArrearsResult> {
  const supabase = createServiceClient(env);
  const today = aestToday(now);

  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, name")
    .eq("status", "active");
  if (error) throw new Error(`arrears: agencies scan failed: ${error.message}`);

  const result: ArrearsResult = {
    agenciesInspected: 0,
    agenciesSkipped: 0,
    tenanciesConsidered: 0,
    draftsCreated: 0,
    alreadyHandled: 0,
    noRecipient: 0,
    escalationsFlagged: 0,
    failures: 0,
  };

  for (const agency of agencies ?? []) {
    result.agenciesInspected += 1;
    const agencyLog = log.child({ agency_id: agency.id });
    try {
      const seq = await getSequenceConfig(supabase, agency.id, "arrears");
      if (!seq.active) {
        result.agenciesSkipped += 1;
        continue;
      }
      const escalateAfterDays = configNumber(
        seq.config,
        "escalate_after_days",
        DEFAULT_ESCALATE_AFTER_DAYS,
      );

      const { data: config } = await supabase
        .from("agency_config")
        .select("pm_signoff_default")
        .eq("agency_id", agency.id)
        .maybeSingle();
      const pmSignoff = config?.pm_signoff_default ?? undefined;

      const { data: tenancies, error: tErr } = await supabase
        .from("tenancies")
        .select("id, property_id, arrears_since")
        .eq("agency_id", agency.id)
        .eq("status", "active")
        .not("arrears_since", "is", null);
      if (tErr) throw new Error(`tenancies scan failed: ${tErr.message}`);

      for (const tenancy of tenancies ?? []) {
        if (!tenancy.arrears_since) continue;
        result.tenanciesConsidered += 1;
        try {
          const outcome = await processTenancy(supabase, {
            agencyId: agency.id,
            agencyName: agency.name,
            sequenceId: seq.sequenceId,
            tenancyId: tenancy.id,
            propertyId: tenancy.property_id,
            arrearsSince: tenancy.arrears_since,
            daysOverdue: Math.max(0, daysBetween(tenancy.arrears_since, today)),
            escalateAfterDays,
            pmSignoff,
            log: agencyLog,
          });
          if (outcome.kind === "drafted") {
            result.draftsCreated += 1;
            if (outcome.escalated) result.escalationsFlagged += 1;
          } else if (outcome.kind === "already_handled") {
            result.alreadyHandled += 1;
          } else {
            result.noRecipient += 1;
          }
        } catch (err) {
          result.failures += 1;
          agencyLog.error("arrears: tenancy failure", {
            tenancy_id: tenancy.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      result.failures += 1;
      agencyLog.error("arrears: per-agency failure", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

interface ProcessTenancyInput {
  agencyId: string;
  agencyName: string;
  sequenceId: string | null;
  tenancyId: string;
  propertyId: string | null;
  arrearsSince: string;
  daysOverdue: number;
  escalateAfterDays: number;
  pmSignoff: string | undefined;
  log: Logger;
}

type ProcessOutcome =
  | { kind: "drafted"; escalated: boolean }
  | { kind: "already_handled" }
  | { kind: "no_recipient" };

async function processTenancy(client: Client, input: ProcessTenancyInput): Promise<ProcessOutcome> {
  const dedupeKey = `arrears:${input.tenancyId}:${input.arrearsSince}`;

  const recipient = await resolvePrimaryTenant(client, input.agencyId, input.tenancyId);
  if (!recipient) {
    input.log.warn("arrears: no contactable tenant", { tenancy_id: input.tenancyId });
    return { kind: "no_recipient" };
  }
  const propertyAddress = await resolvePropertyAddress(client, input.agencyId, input.propertyId);
  const pmName = await resolvePmName(client, input.agencyId, input.propertyId);
  const escalate = input.daysOverdue >= input.escalateAfterDays;

  const runId = await openRun(client, {
    agencyId: input.agencyId,
    sequenceId: input.sequenceId,
    type: "arrears",
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    dedupeKey,
    openEntry: {
      at: new Date().toISOString(),
      step: 0,
      action: "run_opened",
      note: `arrears since ${input.arrearsSince}`,
    },
  });
  if (runId === null) return { kind: "already_handled" };

  const built = buildArrearsDraft({
    tenantName: recipient.name,
    propertyAddress,
    daysOverdue: input.daysOverdue,
    arrearsSince: input.arrearsSince,
    agencyName: input.agencyName,
    pmName,
    pmSignoff: input.pmSignoff,
    escalate,
  });

  const draftId = await insertSequenceDraft(client, {
    agencyId: input.agencyId,
    sequenceRunId: runId,
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    category: "RENT",
    subject: built.subject,
    body: built.body,
    reviewNotes: built.reviewNotes,
    templateKey: "arrears_v1",
  });

  // Escalation diverts the run's state so the PM sees it needs a decision.
  await advanceRun(client, input.agencyId, runId, {
    state: escalate ? "escalated" : "awaiting_response",
    step: 1,
    appendHistory: {
      at: new Date().toISOString(),
      step: 1,
      action: escalate ? "draft_queued_escalated" : "draft_queued",
      draft_id: draftId,
    },
  });

  await writeAuditLog(client, {
    agency_id: input.agencyId,
    actor_type: "system",
    action: "sequence.arrears.draft_created",
    entity_type: "ai_drafts",
    entity_id: draftId,
    metadata: {
      sequence_run_id: runId,
      tenancy_id: input.tenancyId,
      property_id: input.propertyId,
      arrears_since: input.arrearsSince,
      days_overdue: input.daysOverdue,
      escalated: escalate,
      recipient: recipient.email,
    },
  });

  input.log.info("arrears draft created", {
    draft_id: draftId,
    sequence_run_id: runId,
    tenancy_id: input.tenancyId,
    days_overdue: input.daysOverdue,
    escalated: escalate,
  });
  return { kind: "drafted", escalated: escalate };
}
