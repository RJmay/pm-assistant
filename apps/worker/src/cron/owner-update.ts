import type { Client } from "@pm/db";
import { buildOwnerUpdateDraft } from "@pm/prompts";
import type { WorkerBindings } from "../lib/env";
import type { Logger } from "../lib/log";
import { resolvePmName } from "../services/sequences/resolve";
import {
  advanceRun,
  getSequenceConfig,
  insertSequenceDraft,
  openRun,
} from "../services/sequences/runs";
import { createServiceClient, writeAuditLog } from "../services/supabase";

// ============================================================================
// Owner month-end update scan (Phase 2, spec §8 "Owner updates")
// ============================================================================
// Fires monthly (1st of the month). For each active agency with the
// owner_update sequence enabled, draft one month-end summary per owner from the
// activity we already hold (drafts handled on the owner's properties last
// month). Recipient is the owner; the draft carries no inbound message and no
// single property. The PM reviews and sends — nothing auto-sends (§13).
// ============================================================================

const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface ReportWindow {
  /** UTC ISO instant of the report month's first day (AEST midnight). */
  startIso: string;
  /** UTC ISO instant of the following month's first day (AEST midnight). */
  endIso: string;
  /** Stable key for the reported month, e.g. "2026-05". */
  monthKey: string;
  /** Human label, e.g. "May 2026". */
  label: string;
}

/** The just-completed calendar month, in QLD (AEST) terms, relative to `now`. */
export function reportWindow(now: Date): ReportWindow {
  const aest = new Date(now.getTime() + AEST_OFFSET_MS);
  const y = aest.getUTCFullYear();
  const m = aest.getUTCMonth(); // AEST current month, 0-11
  const reportYear = m === 0 ? y - 1 : y;
  const reportMonth = m === 0 ? 11 : m - 1; // 0-11
  // AEST midnight of a day == that UTC midnight minus the AEST offset.
  const startIso = new Date(Date.UTC(reportYear, reportMonth, 1) - AEST_OFFSET_MS).toISOString();
  const endIso = new Date(Date.UTC(y, m, 1) - AEST_OFFSET_MS).toISOString();
  return {
    startIso,
    endIso,
    monthKey: `${reportYear}-${String(reportMonth + 1).padStart(2, "0")}`,
    label: `${MONTH_NAMES[reportMonth]} ${reportYear}`,
  };
}

export interface OwnerUpdateResult {
  agenciesInspected: number;
  agenciesSkipped: number;
  ownersConsidered: number;
  draftsCreated: number;
  alreadyHandled: number;
  skippedNoEmailOrProps: number;
  failures: number;
}

export async function runOwnerUpdateScan(
  env: WorkerBindings,
  log: Logger,
  now: Date = new Date(),
): Promise<OwnerUpdateResult> {
  const supabase = createServiceClient(env);
  const window = reportWindow(now);

  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, name")
    .eq("status", "active");
  if (error) throw new Error(`owner update: agencies scan failed: ${error.message}`);

  const result: OwnerUpdateResult = {
    agenciesInspected: 0,
    agenciesSkipped: 0,
    ownersConsidered: 0,
    draftsCreated: 0,
    alreadyHandled: 0,
    skippedNoEmailOrProps: 0,
    failures: 0,
  };

  for (const agency of agencies ?? []) {
    result.agenciesInspected += 1;
    const agencyLog = log.child({ agency_id: agency.id });
    try {
      const seq = await getSequenceConfig(supabase, agency.id, "owner_update");
      if (!seq.active) {
        result.agenciesSkipped += 1;
        continue;
      }
      const tallied = await processAgency(supabase, {
        agencyId: agency.id,
        agencyName: agency.name,
        sequenceId: seq.sequenceId,
        window,
        log: agencyLog,
      });
      result.ownersConsidered += tallied.ownersConsidered;
      result.draftsCreated += tallied.draftsCreated;
      result.alreadyHandled += tallied.alreadyHandled;
      result.skippedNoEmailOrProps += tallied.skipped;
      result.failures += tallied.failures;
    } catch (err) {
      result.failures += 1;
      agencyLog.error("owner update: per-agency failure", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

interface ProcessAgencyInput {
  agencyId: string;
  agencyName: string;
  sequenceId: string | null;
  window: ReportWindow;
  log: Logger;
}

async function processAgency(
  client: Client,
  input: ProcessAgencyInput,
): Promise<{
  ownersConsidered: number;
  draftsCreated: number;
  alreadyHandled: number;
  skipped: number;
  failures: number;
}> {
  const tally = {
    ownersConsidered: 0,
    draftsCreated: 0,
    alreadyHandled: 0,
    skipped: 0,
    failures: 0,
  };

  const [ownersRes, propsRes, draftsRes] = await Promise.all([
    client
      .from("owners")
      .select("id, full_name, email")
      .eq("agency_id", input.agencyId)
      .is("archived_at", null),
    client
      .from("properties")
      .select("id, owner_id")
      .eq("agency_id", input.agencyId)
      .is("archived_at", null),
    client
      .from("ai_drafts")
      .select("property_id, created_at")
      .eq("agency_id", input.agencyId)
      .gte("created_at", input.window.startIso)
      .lt("created_at", input.window.endIso),
  ]);
  if (ownersRes.error) throw new Error(`owners scan failed: ${ownersRes.error.message}`);
  if (propsRes.error) throw new Error(`properties scan failed: ${propsRes.error.message}`);
  if (draftsRes.error) throw new Error(`ai_drafts scan failed: ${draftsRes.error.message}`);

  // Count handled items per property for the window.
  const itemsByProperty = new Map<string, number>();
  for (const d of draftsRes.data ?? []) {
    if (!d.property_id) continue;
    itemsByProperty.set(d.property_id, (itemsByProperty.get(d.property_id) ?? 0) + 1);
  }
  // Group properties by owner.
  const propsByOwner = new Map<string, string[]>();
  for (const p of propsRes.data ?? []) {
    if (!p.owner_id) continue;
    const list = propsByOwner.get(p.owner_id) ?? [];
    list.push(p.id);
    propsByOwner.set(p.owner_id, list);
  }

  for (const owner of ownersRes.data ?? []) {
    const propertyIds = propsByOwner.get(owner.id) ?? [];
    if (!owner.email || owner.email.trim() === "" || propertyIds.length === 0) {
      tally.skipped += 1;
      continue;
    }
    tally.ownersConsidered += 1;
    try {
      const itemsHandled = propertyIds.reduce((sum, id) => sum + (itemsByProperty.get(id) ?? 0), 0);
      const outcome = await draftForOwner(client, {
        agencyId: input.agencyId,
        agencyName: input.agencyName,
        sequenceId: input.sequenceId,
        window: input.window,
        ownerId: owner.id,
        ownerName: owner.full_name,
        ownerEmail: owner.email,
        propertyCount: propertyIds.length,
        itemsHandled,
        log: input.log,
      });
      if (outcome === "drafted") tally.draftsCreated += 1;
      else tally.alreadyHandled += 1;
    } catch (err) {
      tally.failures += 1;
      input.log.error("owner update: per-owner failure", {
        owner_id: owner.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return tally;
}

interface DraftForOwnerInput {
  agencyId: string;
  agencyName: string;
  sequenceId: string | null;
  window: ReportWindow;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  propertyCount: number;
  itemsHandled: number;
  log: Logger;
}

async function draftForOwner(
  client: Client,
  input: DraftForOwnerInput,
): Promise<"drafted" | "already_handled"> {
  const dedupeKey = `owner_update:${input.ownerId}:${input.window.monthKey}`;
  const runId = await openRun(client, {
    agencyId: input.agencyId,
    sequenceId: input.sequenceId,
    type: "owner_update",
    ownerId: input.ownerId,
    dedupeKey,
    openEntry: {
      at: new Date().toISOString(),
      step: 0,
      action: "run_opened",
      note: `owner update ${input.window.monthKey}`,
    },
  });
  if (runId === null) return "already_handled";

  const pmName = await resolvePmName(client, input.agencyId, null);
  const built = buildOwnerUpdateDraft({
    ownerName: input.ownerName,
    agencyName: input.agencyName,
    reportMonthLabel: input.window.label,
    propertyCount: input.propertyCount,
    itemsHandled: input.itemsHandled,
    pmName,
  });

  const draftId = await insertSequenceDraft(client, {
    agencyId: input.agencyId,
    sequenceRunId: runId,
    recipientEmail: input.ownerEmail,
    recipientName: input.ownerName,
    category: "ADMIN",
    subject: built.subject,
    body: built.body,
    reviewNotes: built.reviewNotes,
    templateKey: "owner_update_v1",
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
    action: "sequence.owner_update.draft_created",
    entity_type: "ai_drafts",
    entity_id: draftId,
    metadata: {
      sequence_run_id: runId,
      owner_id: input.ownerId,
      report_month: input.window.monthKey,
      property_count: input.propertyCount,
      items_handled: input.itemsHandled,
      recipient: input.ownerEmail,
    },
  });

  input.log.info("owner update draft created", {
    draft_id: draftId,
    sequence_run_id: runId,
    owner_id: input.ownerId,
  });
  return "drafted";
}
