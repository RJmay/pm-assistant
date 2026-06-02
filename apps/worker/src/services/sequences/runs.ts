import type { Client, Json } from "@pm/db";
import type {
  DraftSubmission,
  SequenceHistoryEntry,
  SequenceRunState,
  SequenceType,
} from "@pm/shared";

// ============================================================================
// Sequence-run plumbing — shared by every outbound sequence (spec §8)
// ============================================================================
// A "run" is one durable, idempotent unit of outbound work for one entity in
// one cycle (e.g. a lease renewal for tenancy X expiring on date D). The
// dedupe_key makes re-scans no-ops. The draft a run produces is a normal
// `ai_drafts` row with `draft_source='sequence'`, so it flows through the same
// review → edit → send → audit stack as inbound replies — still human-sent.
//
// Every query is scoped by agency_id: the worker uses the service-role client,
// which bypasses RLS (ARCHITECTURE §"Worker access").
// ============================================================================

const PG_UNIQUE_VIOLATION = "23505";

export interface SequenceConfig {
  active: boolean;
  sequenceId: string | null;
  config: Record<string, unknown>;
}

/**
 * Whether a sequence type is enabled for an agency. A missing `sequences` row
 * means "enabled, with code defaults" — so a new agency gets sequences without
 * any setup, and an explicit row is only needed to disable or tune one.
 */
export async function getSequenceConfig(
  client: Client,
  agencyId: string,
  type: SequenceType,
): Promise<SequenceConfig> {
  const { data, error } = await client
    .from("sequences")
    .select("id, is_active, config")
    .eq("agency_id", agencyId)
    .eq("type", type)
    .maybeSingle();
  if (error) throw new Error(`sequences lookup failed: ${error.message}`);
  if (!data) return { active: true, sequenceId: null, config: {} };
  return {
    active: data.is_active,
    sequenceId: data.id,
    config: (data.config ?? {}) as Record<string, unknown>,
  };
}

/** Read a numeric config override, falling back to a code default. */
export function configNumber(
  config: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = config[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export interface OpenRunInput {
  agencyId: string;
  sequenceId: string | null;
  type: SequenceType;
  tenancyId?: string | null;
  propertyId?: string | null;
  ownerId?: string | null;
  dedupeKey: string;
  openEntry: SequenceHistoryEntry;
}

/**
 * Open a new run in `pending`, idempotently. Returns the run id, or null when a
 * run already exists for this `(agency_id, dedupe_key)` — i.e. the cycle was
 * already handled (by a prior scan or a concurrent one). Callers treat null as
 * "skip, already done".
 */
export async function openRun(client: Client, input: OpenRunInput): Promise<string | null> {
  const { data, error } = await client
    .from("sequence_runs")
    .insert({
      agency_id: input.agencyId,
      sequence_id: input.sequenceId,
      type: input.type,
      tenancy_id: input.tenancyId ?? null,
      property_id: input.propertyId ?? null,
      owner_id: input.ownerId ?? null,
      dedupe_key: input.dedupeKey,
      state: "pending",
      step: 0,
      history: [input.openEntry] as unknown as Json,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) return null; // already opened
    throw new Error(`sequence_runs insert failed: ${error.message}`);
  }
  return data.id;
}

export interface SequenceDraftInput {
  agencyId: string;
  sequenceRunId: string;
  tenancyId?: string | null;
  propertyId?: string | null;
  recipientEmail: string;
  recipientName?: string | null;
  category: DraftSubmission["category"];
  subject: string;
  body: string;
  reviewNotes: string[];
  /** Template key, recorded as `model_used='template:<key>'`. */
  templateKey: string;
}

/**
 * Insert the outbound draft a run produces. It's a normal pending `ai_drafts`
 * row with `draft_source='sequence'` and its own recipient (no inbound
 * message). Template-generated → vetted compliant language, so confidence is
 * HIGH and there's no escalation/do-not-send by construction. Returns the id.
 */
export async function insertSequenceDraft(
  client: Client,
  input: SequenceDraftInput,
): Promise<string> {
  const { data, error } = await client
    .from("ai_drafts")
    .insert({
      agency_id: input.agencyId,
      draft_source: "sequence",
      sequence_run_id: input.sequenceRunId,
      tenancy_id: input.tenancyId ?? null,
      property_id: input.propertyId ?? null,
      recipient_email: input.recipientEmail,
      recipient_name: input.recipientName ?? null,
      category: input.category,
      category_confidence: "HIGH",
      priority: "STANDARD",
      escalation_flag: "NONE",
      emergency_landlord_alert: false,
      safety_critical: false,
      do_not_send: false,
      draft_confidence: "HIGH",
      draft_subject: input.subject,
      draft_body: input.body,
      pm_review_notes: input.reviewNotes as unknown as Json,
      model_used: `template:${input.templateKey}`,
      // We know the exact tenancy/property the draft is for.
      match_confidence: "high",
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`sequence ai_drafts insert failed: ${error?.message ?? "no row returned"}`);
  }
  return data.id;
}

export interface AdvanceRunInput {
  state?: SequenceRunState;
  step?: number;
  nextActionAt?: string | null;
  appendHistory?: SequenceHistoryEntry;
}

/**
 * Advance a run: set state/step/next_action_at and append a history entry.
 * History is read-modify-written so the append is additive (runs are advanced
 * once per scan, so there's no contention to worry about).
 */
export async function advanceRun(
  client: Client,
  agencyId: string,
  runId: string,
  patch: AdvanceRunInput,
): Promise<void> {
  let history: SequenceHistoryEntry[] | undefined;
  if (patch.appendHistory) {
    const { data: current } = await client
      .from("sequence_runs")
      .select("history")
      .eq("agency_id", agencyId)
      .eq("id", runId)
      .maybeSingle();
    const existing = (current?.history ?? []) as unknown as SequenceHistoryEntry[];
    history = [...existing, patch.appendHistory];
  }

  const update: {
    state?: SequenceRunState;
    step?: number;
    next_action_at?: string | null;
    history?: Json;
  } = {};
  if (patch.state !== undefined) update.state = patch.state;
  if (patch.step !== undefined) update.step = patch.step;
  if (patch.nextActionAt !== undefined) update.next_action_at = patch.nextActionAt;
  if (history !== undefined) update.history = history as unknown as Json;

  const { error } = await client
    .from("sequence_runs")
    .update(update)
    .eq("agency_id", agencyId)
    .eq("id", runId);
  if (error) throw new Error(`sequence_runs update failed: ${error.message}`);
}
