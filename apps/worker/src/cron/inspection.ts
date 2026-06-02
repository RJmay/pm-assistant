import type { Client } from "@pm/db";
import { buildInspectionDraft } from "@pm/prompts";
import {
  addDays,
  addMonths,
  compareIso,
  earliestRoutineInspectionDate,
  RuleNotConfiguredError,
  RuleNotFoundError,
} from "@pm/rules";
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
// Inspection-scheduling scan (Phase 2, spec §8 "Inspection scheduling")
// ============================================================================
// Fires daily. For each active agency with the inspection sequence enabled:
//   1. Find active tenancies whose NEXT routine inspection (last inspection —
//      or the tenancy start as a baseline — plus the agency's interval) falls
//      due within the lead window.
//   2. Idempotently open a run per (tenancy, due date).
//   3. Compute a compliant proposed entry date via @pm/rules (statutory notice
//      period + frequency cap — never a guessed date).
//   4. Queue a scheduling draft for the PM to review and send. The formal
//      Entry Notice (Form 9) is generated later (Phase 4). Nothing auto-sends.
// ============================================================================

const DEFAULT_INTERVAL_MONTHS = 6;
const DEFAULT_LEAD_DAYS = 14;
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

function aestToday(now: Date): string {
  return new Date(now.getTime() + AEST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface InspectionResult {
  agenciesInspected: number;
  agenciesSkipped: number;
  tenanciesConsidered: number;
  draftsCreated: number;
  alreadyHandled: number;
  noRecipient: number;
  ruleGap: number;
  failures: number;
}

export async function runInspectionScan(
  env: WorkerBindings,
  log: Logger,
  now: Date = new Date(),
): Promise<InspectionResult> {
  const supabase = createServiceClient(env);
  const today = aestToday(now);

  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, name")
    .eq("status", "active");
  if (error) throw new Error(`inspection: agencies scan failed: ${error.message}`);

  const result: InspectionResult = {
    agenciesInspected: 0,
    agenciesSkipped: 0,
    tenanciesConsidered: 0,
    draftsCreated: 0,
    alreadyHandled: 0,
    noRecipient: 0,
    ruleGap: 0,
    failures: 0,
  };

  for (const agency of agencies ?? []) {
    result.agenciesInspected += 1;
    const agencyLog = log.child({ agency_id: agency.id });
    try {
      const seq = await getSequenceConfig(supabase, agency.id, "inspection");
      if (!seq.active) {
        result.agenciesSkipped += 1;
        continue;
      }
      const intervalMonths = configNumber(seq.config, "interval_months", DEFAULT_INTERVAL_MONTHS);
      const leadDays = configNumber(seq.config, "lead_days", DEFAULT_LEAD_DAYS);
      const dueBy = addDays(today, leadDays);

      const { data: config } = await supabase
        .from("agency_config")
        .select("pm_signoff_default")
        .eq("agency_id", agency.id)
        .maybeSingle();
      const pmSignoff = config?.pm_signoff_default ?? undefined;

      const { data: tenancies, error: tErr } = await supabase
        .from("tenancies")
        .select("id, property_id, start_date, last_routine_inspection_date")
        .eq("agency_id", agency.id)
        .eq("status", "active");
      if (tErr) throw new Error(`tenancies scan failed: ${tErr.message}`);

      for (const tenancy of tenancies ?? []) {
        // Baseline for the next inspection: the last one, or the tenancy start.
        const baseline = tenancy.last_routine_inspection_date ?? tenancy.start_date;
        if (!baseline) continue; // can't compute a due date without a baseline
        const nextDue = addMonths(baseline, intervalMonths);
        if (compareIso(nextDue, dueBy) > 0) continue; // not yet within the lead window
        result.tenanciesConsidered += 1;
        try {
          const outcome = await processTenancy(supabase, {
            agencyId: agency.id,
            agencyName: agency.name,
            sequenceId: seq.sequenceId,
            tenancyId: tenancy.id,
            propertyId: tenancy.property_id,
            lastInspectionDate: tenancy.last_routine_inspection_date,
            nextDue,
            pmSignoff,
            today,
            log: agencyLog,
          });
          result[outcome] += 1;
        } catch (err) {
          result.failures += 1;
          agencyLog.error("inspection: tenancy failure", {
            tenancy_id: tenancy.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      result.failures += 1;
      agencyLog.error("inspection: per-agency failure", {
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
  lastInspectionDate: string | null;
  nextDue: string;
  pmSignoff: string | undefined;
  today: string;
  log: Logger;
}

type TenancyOutcome = "draftsCreated" | "alreadyHandled" | "noRecipient" | "ruleGap";

async function processTenancy(client: Client, input: ProcessTenancyInput): Promise<TenancyOutcome> {
  const dedupeKey = `inspection:${input.tenancyId}:${input.nextDue}`;

  // Compute a compliant proposed entry date first — if the rules engine can't
  // resolve the notice period we skip WITHOUT opening a run (never guess a
  // statutory date), so a later rule-confirmation is picked up next scan.
  let window: ReturnType<typeof earliestRoutineInspectionDate>;
  try {
    window = earliestRoutineInspectionDate({
      noticeDate: input.today,
      lastInspectionDate: input.lastInspectionDate,
    });
  } catch (err) {
    if (err instanceof RuleNotConfiguredError || err instanceof RuleNotFoundError) {
      input.log.warn("inspection: entry-notice rules unavailable; skipping", {
        tenancy_id: input.tenancyId,
        error: err.message,
      });
      return "ruleGap";
    }
    throw err;
  }

  const recipient = await resolvePrimaryTenant(client, input.agencyId, input.tenancyId);
  if (!recipient) {
    input.log.warn("inspection: no contactable tenant", { tenancy_id: input.tenancyId });
    return "noRecipient";
  }
  const propertyAddress = await resolvePropertyAddress(client, input.agencyId, input.propertyId);
  const pmName = await resolvePmName(client, input.agencyId, input.propertyId);

  const runId = await openRun(client, {
    agencyId: input.agencyId,
    sequenceId: input.sequenceId,
    type: "inspection",
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    dedupeKey,
    openEntry: {
      at: new Date().toISOString(),
      step: 0,
      action: "run_opened",
      note: `inspection due ${input.nextDue}`,
    },
  });
  if (runId === null) return "alreadyHandled";

  const built = buildInspectionDraft({
    tenantName: recipient.name,
    propertyAddress,
    proposedDate: window.earliestDate,
    noticeDays: window.requirements.routineInspectionNoticeDays,
    formId: window.requirements.formId,
    agencyName: input.agencyName,
    pmName,
    pmSignoff: input.pmSignoff,
    cappedByFrequency: window.cappedByFrequency,
    minMonthsBetween: window.requirements.minMonthsBetween,
    ruleVersions: window.requirements.ruleVersions,
  });

  const draftId = await insertSequenceDraft(client, {
    agencyId: input.agencyId,
    sequenceRunId: runId,
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    category: "ADMIN",
    subject: built.subject,
    body: built.body,
    reviewNotes: built.reviewNotes,
    templateKey: "inspection_v1",
  });

  await advanceRun(client, input.agencyId, runId, {
    state: "awaiting_response",
    step: 1,
    appendHistory: {
      at: new Date().toISOString(),
      step: 1,
      action: "draft_queued",
      draft_id: draftId,
    },
  });

  await writeAuditLog(client, {
    agency_id: input.agencyId,
    actor_type: "system",
    action: "sequence.inspection.draft_created",
    entity_type: "ai_drafts",
    entity_id: draftId,
    metadata: {
      sequence_run_id: runId,
      tenancy_id: input.tenancyId,
      property_id: input.propertyId,
      next_due: input.nextDue,
      proposed_date: window.earliestDate,
      capped_by_frequency: window.cappedByFrequency,
      recipient: recipient.email,
      rules: window.requirements.ruleVersions,
    },
  });

  input.log.info("inspection draft created", {
    draft_id: draftId,
    sequence_run_id: runId,
    tenancy_id: input.tenancyId,
    proposed_date: window.earliestDate,
  });
  return "draftsCreated";
}
