import type { Client } from "@pm/db";
import { buildLeaseRenewalDraft, type RentReviewWindow } from "@pm/prompts";
import {
  addDays,
  assessRentIncrease,
  earliestRentIncreaseDate,
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
// Lease-renewal scan (Phase 2, spec §8 "Lease-renewal pipeline")
// ============================================================================
// Fires daily. For each active agency with the lease_renewal sequence enabled:
//   1. Find fixed-term, active tenancies whose end_date falls within the lead
//      window (default 90 days out).
//   2. Idempotently open a run per (tenancy, end_date) — re-scans are no-ops.
//   3. Compute the compliant rent-review window via @pm/rules (never a rent
//      figure — that's a PM/commercial decision).
//   4. Render the vetted renewal-offer template and queue it as a pending
//      outbound draft for the PM to review and send. Nothing auto-sends (§13).
// ============================================================================

const DEFAULT_LEAD_DAYS = 90;
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

/** Today's calendar date in QLD (AEST, UTC+10, no DST) as `YYYY-MM-DD`. */
export function aestToday(now: Date): string {
  return new Date(now.getTime() + AEST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface LeaseRenewalResult {
  agenciesInspected: number;
  agenciesSkipped: number;
  tenanciesConsidered: number;
  draftsCreated: number;
  alreadyHandled: number;
  noRecipient: number;
  failures: number;
}

export async function runLeaseRenewalScan(
  env: WorkerBindings,
  log: Logger,
  now: Date = new Date(),
): Promise<LeaseRenewalResult> {
  const supabase = createServiceClient(env);
  const today = aestToday(now);

  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, name")
    .eq("status", "active");
  if (error) throw new Error(`lease renewal: agencies scan failed: ${error.message}`);

  const result: LeaseRenewalResult = {
    agenciesInspected: 0,
    agenciesSkipped: 0,
    tenanciesConsidered: 0,
    draftsCreated: 0,
    alreadyHandled: 0,
    noRecipient: 0,
    failures: 0,
  };

  for (const agency of agencies ?? []) {
    result.agenciesInspected += 1;
    const agencyLog = log.child({ agency_id: agency.id });
    try {
      const seq = await getSequenceConfig(supabase, agency.id, "lease_renewal");
      if (!seq.active) {
        result.agenciesSkipped += 1;
        continue;
      }
      const leadDays = configNumber(seq.config, "lead_days", DEFAULT_LEAD_DAYS);
      const windowEnd = addDays(today, leadDays);

      // PM sign-off default for the whole agency (cheap to read once).
      const { data: config } = await supabase
        .from("agency_config")
        .select("pm_signoff_default")
        .eq("agency_id", agency.id)
        .maybeSingle();
      const pmSignoff = config?.pm_signoff_default ?? undefined;

      const { data: tenancies, error: tErr } = await supabase
        .from("tenancies")
        .select("id, property_id, end_date, last_rent_increase_date")
        .eq("agency_id", agency.id)
        .eq("status", "active")
        .eq("agreement_type", "fixed")
        .gte("end_date", today)
        .lte("end_date", windowEnd);
      if (tErr) throw new Error(`tenancies scan failed: ${tErr.message}`);

      for (const tenancy of tenancies ?? []) {
        if (!tenancy.end_date) continue; // gte/lte already exclude nulls; belt-and-braces
        result.tenanciesConsidered += 1;
        try {
          const outcome = await processTenancy(supabase, {
            agencyId: agency.id,
            agencyName: agency.name,
            sequenceId: seq.sequenceId,
            tenancyId: tenancy.id,
            propertyId: tenancy.property_id,
            endDate: tenancy.end_date,
            lastIncreaseDate: tenancy.last_rent_increase_date,
            pmSignoff,
            today,
            log: agencyLog,
          });
          if (outcome === "drafted") result.draftsCreated += 1;
          else if (outcome === "already_handled") result.alreadyHandled += 1;
          else if (outcome === "no_recipient") result.noRecipient += 1;
        } catch (err) {
          result.failures += 1;
          agencyLog.error("lease renewal: tenancy failure", {
            tenancy_id: tenancy.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      result.failures += 1;
      agencyLog.error("lease renewal: per-agency failure", {
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
  endDate: string;
  lastIncreaseDate: string | null;
  pmSignoff: string | undefined;
  today: string;
  log: Logger;
}

type TenancyOutcome = "drafted" | "already_handled" | "no_recipient";

async function processTenancy(client: Client, input: ProcessTenancyInput): Promise<TenancyOutcome> {
  const dedupeKey = `lease_renewal:${input.tenancyId}:${input.endDate}`;

  // Resolve recipient (primary tenant with an email) + property address. If
  // there's no contactable tenant we DON'T open a run, so a later data fix is
  // picked up on the next scan rather than being permanently marked handled.
  const recipient = await resolvePrimaryTenant(client, input.agencyId, input.tenancyId);
  if (!recipient) {
    input.log.warn("lease renewal: no contactable tenant", { tenancy_id: input.tenancyId });
    return "no_recipient";
  }
  const propertyAddress = await resolvePropertyAddress(client, input.agencyId, input.propertyId);
  const pmName = await resolvePmName(client, input.agencyId, input.propertyId);

  const rentReview = computeRentReview(input.today, input.lastIncreaseDate, input.log);

  // Open the run idempotently. null => another scan already handled this cycle.
  const runId = await openRun(client, {
    agencyId: input.agencyId,
    sequenceId: input.sequenceId,
    type: "lease_renewal",
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    dedupeKey,
    openEntry: {
      at: new Date().toISOString(),
      step: 0,
      action: "run_opened",
      note: `lease ends ${input.endDate}`,
    },
  });
  if (runId === null) return "already_handled";

  const built = buildLeaseRenewalDraft({
    tenantName: recipient.name,
    propertyAddress,
    leaseEndDate: input.endDate,
    agencyName: input.agencyName,
    pmName,
    pmSignoff: input.pmSignoff,
    rentReview: rentReview ?? undefined,
  });

  const draftId = await insertSequenceDraft(client, {
    agencyId: input.agencyId,
    sequenceRunId: runId,
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    category: "LEASE",
    subject: built.subject,
    body: built.body,
    reviewNotes: built.reviewNotes,
    templateKey: "lease_renewal_v1",
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
    action: "sequence.lease_renewal.draft_created",
    entity_type: "ai_drafts",
    entity_id: draftId,
    metadata: {
      sequence_run_id: runId,
      tenancy_id: input.tenancyId,
      property_id: input.propertyId,
      lease_end_date: input.endDate,
      recipient: recipient.email,
      rent_review: rentReview
        ? {
            earliest_compliant_date: rentReview.earliestCompliantDate,
            rules: rentReview.ruleVersions,
          }
        : null,
    },
  });

  input.log.info("lease renewal draft created", {
    draft_id: draftId,
    sequence_run_id: runId,
    tenancy_id: input.tenancyId,
  });
  return "drafted";
}

/**
 * Compliant rent-review window from @pm/rules, or null if the rules engine
 * can't resolve it (we still draft the renewal offer; the PM just won't get the
 * computed window). Never invents a value — on a config gap it returns null.
 */
function computeRentReview(
  today: string,
  lastIncreaseDate: string | null,
  log: Logger,
): RentReviewWindow | null {
  try {
    const earliest = earliestRentIncreaseDate({ noticeDate: today, lastIncreaseDate });
    const assessment = assessRentIncrease({
      proposedEffectiveDate: earliest,
      noticeDate: today,
      lastIncreaseDate,
    });
    return {
      lastIncreaseDate,
      earliestCompliantDate: assessment.earliestCompliantDate,
      minNoticeMonths: assessment.minNoticeMonths,
      minIntervalMonths: assessment.minIntervalMonths,
      ruleVersions: assessment.ruleVersions,
    };
  } catch (err) {
    if (err instanceof RuleNotConfiguredError || err instanceof RuleNotFoundError) {
      log.warn("lease renewal: rent-review window unavailable (rule not configured)", {
        error: err.message,
      });
      return null;
    }
    throw err;
  }
}
