import type { Client, Json } from "@pm/db";
import type { WorkerBindings } from "../lib/env";
import { createLogger, type Logger } from "../lib/log";
import { createServiceClient } from "../services/supabase";

/**
 * Weekly drift detection — fires Mondays 09:00 AEST (Sundays 23:00 UTC).
 *
 * For each active agency:
 *  1. Compute draft signals for the just-completed week (Mon→Sun AEST).
 *  2. Compute a 4-week baseline for the same metrics.
 *  3. If any metric shifts by more than the threshold AND sample sizes are
 *     large enough to be meaningful, insert a `weekly_digests` row that the
 *     M8 dashboard surfaces as a tuning card. Silent otherwise.
 *
 * Idempotent on `(agency_id, week_start_date)` via a unique constraint — a
 * re-run for the same week is a no-op (we pre-check before inserting).
 */

// Absolute-shift thresholds. Tuned tight: a 25-point swing in escalation rate
// is a real signal at the volumes we expect (single-pilot agency, ~10-30
// drafts/week). Adjust per-agency once we have multi-tenant baselines.
const CATEGORY_SHIFT_THRESHOLD = 0.25;
const ESCALATION_SHIFT_THRESHOLD = 0.25;
const DO_NOT_SEND_SHIFT_THRESHOLD = 0.25;
const CONFIDENCE_SHIFT_THRESHOLD = 0.25;

// Minimum sample sizes — below this the comparison is too noisy to surface.
const MIN_THIS_WEEK = 5;
const MIN_BASELINE = 10;

// AEST is fixed UTC+10 in QLD (no DST). Hard-code so the cron always lines
// up with the PM's local week boundaries.
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

const CONFIDENCE_TO_SCORE: Record<"HIGH" | "MEDIUM" | "LOW", number> = {
  HIGH: 1.0,
  MEDIUM: 0.5,
  LOW: 0.0,
};

const CATEGORIES = ["MAINTENANCE", "RENT", "LEASE", "COMPLAINT", "ADMIN", "OTHER"] as const;
type Category = (typeof CATEGORIES)[number];

// ----------------------------------------------------------------------------
// Public surface
// ----------------------------------------------------------------------------

export interface WeeklyDriftResult {
  agenciesInspected: number;
  digestsWritten: number;
  agenciesSkipped: number;
  failures: number;
}

export async function runWeeklyDrift(
  env: WorkerBindings,
  log: Logger,
  now: Date = new Date(),
): Promise<WeeklyDriftResult> {
  const supabase = createServiceClient(env);
  const { thisWeekStart, thisWeekEnd, baselineStart, baselineEnd } = weekWindows(now);

  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, status")
    .eq("status", "active");
  if (error) {
    throw new Error(`weekly drift: agencies scan failed: ${error.message}`);
  }

  let inspected = 0;
  let written = 0;
  let skipped = 0;
  let failures = 0;
  for (const agency of agencies ?? []) {
    inspected += 1;
    const agencyLog = log.child({ agency_id: agency.id });
    try {
      const result = await processAgency(supabase, agency.id, {
        thisWeekStart,
        thisWeekEnd,
        baselineStart,
        baselineEnd,
      });
      if (result.kind === "written") {
        written += 1;
        agencyLog.info("weekly drift digest written", {
          week_start_date: result.weekStartDate,
          metric_shifts: result.shifts,
        });
      } else {
        skipped += 1;
        agencyLog.debug("weekly drift digest skipped", { reason: result.reason });
      }
    } catch (err) {
      failures += 1;
      agencyLog.error("weekly drift per-agency failure", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    agenciesInspected: inspected,
    digestsWritten: written,
    agenciesSkipped: skipped,
    failures,
  };
}

// ----------------------------------------------------------------------------
// Per-agency logic
// ----------------------------------------------------------------------------

interface WeekWindows {
  thisWeekStart: Date;
  thisWeekEnd: Date;
  baselineStart: Date;
  baselineEnd: Date;
}

interface DraftRow {
  category: Category;
  escalation_flag: "NONE" | "WELFARE" | "LEGAL" | "REPUTATIONAL" | "INCIDENT";
  do_not_send: boolean;
  draft_confidence: "HIGH" | "MEDIUM" | "LOW";
}

interface Signals {
  drafts: number;
  category_mix: Record<Category, number>;
  escalation_rate: number;
  do_not_send_rate: number;
  mean_draft_confidence: number;
}

type ProcessResult =
  | { kind: "written"; weekStartDate: string; shifts: ShiftSummary }
  | { kind: "skipped"; reason: string };

interface ShiftSummary {
  category_mix: Partial<Record<Category, { delta: number; baseline: number; current: number }>>;
  escalation_rate?: { delta: number; baseline: number; current: number };
  do_not_send_rate?: { delta: number; baseline: number; current: number };
  mean_draft_confidence?: { delta: number; baseline: number; current: number };
}

async function processAgency(
  client: Client,
  agencyId: string,
  windows: WeekWindows,
): Promise<ProcessResult> {
  // Idempotency: skip if a digest already exists for this week. The stored
  // date is the AEST calendar Monday (what the PM sees), not the UTC prefix
  // of the instant — those can differ by a day.
  const weekStartDate = new Date(windows.thisWeekStart.getTime() + AEST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  const { data: existing } = await client
    .from("weekly_digests")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("week_start_date", weekStartDate)
    .maybeSingle();
  if (existing) {
    return { kind: "skipped", reason: "digest_already_exists" };
  }

  const [thisWeek, baseline] = await Promise.all([
    loadDrafts(client, agencyId, windows.thisWeekStart, windows.thisWeekEnd),
    loadDrafts(client, agencyId, windows.baselineStart, windows.baselineEnd),
  ]);
  if (thisWeek.length < MIN_THIS_WEEK || baseline.length < MIN_BASELINE) {
    return { kind: "skipped", reason: "below_min_sample" };
  }

  const thisSignals = computeSignals(thisWeek);
  const baselineSignals = computeSignals(baseline);
  const shifts = detectShifts(thisSignals, baselineSignals);
  if (!hasSignal(shifts)) {
    return { kind: "skipped", reason: "no_signal" };
  }

  const suggestions = buildSuggestions(shifts);
  const { error } = await client.from("weekly_digests").insert({
    agency_id: agencyId,
    week_start_date: weekStartDate,
    signals: { this_week: thisSignals, baseline: baselineSignals } as unknown as Json,
    suggested_directions: suggestions as unknown as Json,
  });
  if (error) {
    throw new Error(`weekly_digests insert failed: ${error.message}`);
  }
  return { kind: "written", weekStartDate, shifts };
}

async function loadDrafts(
  client: Client,
  agencyId: string,
  start: Date,
  end: Date,
): Promise<DraftRow[]> {
  const { data, error } = await client
    .from("ai_drafts")
    .select("category, escalation_flag, do_not_send, draft_confidence")
    .eq("agency_id", agencyId)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  if (error) {
    throw new Error(`ai_drafts scan failed: ${error.message}`);
  }
  return (data ?? []) as DraftRow[];
}

// ----------------------------------------------------------------------------
// Signal math
// ----------------------------------------------------------------------------

export function computeSignals(drafts: DraftRow[]): Signals {
  const total = drafts.length;
  const categoryCounts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
    Category,
    number
  >;
  let escalations = 0;
  let dnsCount = 0;
  let confidenceSum = 0;
  for (const d of drafts) {
    categoryCounts[d.category] += 1;
    if (d.escalation_flag !== "NONE") escalations += 1;
    if (d.do_not_send) dnsCount += 1;
    confidenceSum += CONFIDENCE_TO_SCORE[d.draft_confidence];
  }
  const category_mix = Object.fromEntries(
    CATEGORIES.map((c) => [c, total > 0 ? categoryCounts[c] / total : 0]),
  ) as Record<Category, number>;
  return {
    drafts: total,
    category_mix,
    escalation_rate: total > 0 ? escalations / total : 0,
    do_not_send_rate: total > 0 ? dnsCount / total : 0,
    mean_draft_confidence: total > 0 ? confidenceSum / total : 0,
  };
}

export function detectShifts(current: Signals, baseline: Signals): ShiftSummary {
  const shifts: ShiftSummary = { category_mix: {} };
  for (const c of CATEGORIES) {
    const delta = current.category_mix[c] - baseline.category_mix[c];
    if (Math.abs(delta) > CATEGORY_SHIFT_THRESHOLD) {
      shifts.category_mix[c] = {
        delta,
        baseline: baseline.category_mix[c],
        current: current.category_mix[c],
      };
    }
  }
  const escDelta = current.escalation_rate - baseline.escalation_rate;
  if (Math.abs(escDelta) > ESCALATION_SHIFT_THRESHOLD) {
    shifts.escalation_rate = {
      delta: escDelta,
      baseline: baseline.escalation_rate,
      current: current.escalation_rate,
    };
  }
  const dnsDelta = current.do_not_send_rate - baseline.do_not_send_rate;
  if (Math.abs(dnsDelta) > DO_NOT_SEND_SHIFT_THRESHOLD) {
    shifts.do_not_send_rate = {
      delta: dnsDelta,
      baseline: baseline.do_not_send_rate,
      current: current.do_not_send_rate,
    };
  }
  const confDelta = current.mean_draft_confidence - baseline.mean_draft_confidence;
  if (Math.abs(confDelta) > CONFIDENCE_SHIFT_THRESHOLD) {
    shifts.mean_draft_confidence = {
      delta: confDelta,
      baseline: baseline.mean_draft_confidence,
      current: current.mean_draft_confidence,
    };
  }
  return shifts;
}

function hasSignal(shifts: ShiftSummary): boolean {
  if (Object.keys(shifts.category_mix).length > 0) return true;
  if (shifts.escalation_rate || shifts.do_not_send_rate || shifts.mean_draft_confidence) {
    return true;
  }
  return false;
}

interface Suggestion {
  topic: string;
  prompt: string;
  options: Array<{ label: string; lean_to_apply: string | null }>;
}

function buildSuggestions(shifts: ShiftSummary): Suggestion[] {
  const out: Suggestion[] = [];
  if (shifts.escalation_rate) {
    const direction = shifts.escalation_rate.delta > 0 ? "jumped" : "dropped";
    out.push({
      topic: "Escalation rate",
      prompt: `Escalation rate ${direction} from ${pct(shifts.escalation_rate.baseline)} to ${pct(shifts.escalation_rate.current)} this week. Should drafts be more or less ready to escalate?`,
      options: [
        {
          label: "Lean less escalation-prone",
          lean_to_apply:
            "Default to STANDARD priority unless safety, legal, or welfare signals are clear.",
        },
        {
          label: "Lean more escalation-prone",
          lean_to_apply:
            "Err on PRIORITY+ when the issue is borderline — coast tenants want fast acknowledgement.",
        },
        { label: "Stay the course", lean_to_apply: null },
      ],
    });
  }
  if (shifts.do_not_send_rate) {
    const direction = shifts.do_not_send_rate.delta > 0 ? "jumped" : "dropped";
    out.push({
      topic: "Do-not-send rate",
      prompt: `Do-not-send rate ${direction} from ${pct(shifts.do_not_send_rate.baseline)} to ${pct(shifts.do_not_send_rate.current)}. Was the AI too cautious about sending replies?`,
      options: [
        {
          label: "Lean toward drafting more often",
          lean_to_apply:
            "When uncertain about sending, prefer a hedged draft + PM REVIEW NOTES over DO NOT SEND.",
        },
        { label: "Stay the course", lean_to_apply: null },
      ],
    });
  }
  if (shifts.mean_draft_confidence) {
    const direction = shifts.mean_draft_confidence.delta > 0 ? "rose" : "fell";
    out.push({
      topic: "Draft confidence",
      prompt: `Mean draft confidence ${direction} this week (${score(shifts.mean_draft_confidence.baseline)} → ${score(shifts.mean_draft_confidence.current)}). Was the AI losing footing on certain topics?`,
      options: [{ label: "Surface what's hard — no auto-apply", lean_to_apply: null }],
    });
  }
  for (const cat of Object.keys(shifts.category_mix) as Category[]) {
    const s = shifts.category_mix[cat];
    if (!s) continue;
    const direction = s.delta > 0 ? "rose" : "fell";
    out.push({
      topic: `Category mix — ${cat}`,
      prompt: `${cat} share ${direction} from ${pct(s.baseline)} to ${pct(s.current)}. Is the categoriser drifting on this category?`,
      options: [{ label: "Flag for manual review", lean_to_apply: null }],
    });
  }
  return out;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
function score(v: number): string {
  return v.toFixed(2);
}

// ----------------------------------------------------------------------------
// Week-window math (AEST, Mon-Sun)
// ----------------------------------------------------------------------------

export function weekWindows(now: Date): WeekWindows {
  // Shift to AEST so the math operates in the PM's local calendar.
  const aestMillis = now.getTime() + AEST_OFFSET_MS;
  const aestDate = new Date(aestMillis);

  // getUTCDay() on the shifted date returns the AEST weekday: 0=Sun, 1=Mon, …, 6=Sat
  const aestDow = aestDate.getUTCDay();
  // Days since the most recent Monday (treat Mon as week start). When today
  // IS Monday we still want the prior week as "this week" — the cron fires
  // Mon morning to report on the just-finished week.
  const daysSinceMon = aestDow === 0 ? 6 : aestDow - 1;
  const aestMidnightToday = startOfUtcDay(aestDate);
  // Monday 00:00 AEST of the current week (the week just starting)
  const thisMondayAest = new Date(aestMidnightToday.getTime() - daysSinceMon * 24 * 3600 * 1000);
  // The "this week" window is the prior Mon → this Mon (i.e. just-finished week)
  const thisWeekEnd = thisMondayAest;
  const thisWeekStart = new Date(thisWeekEnd.getTime() - 7 * 24 * 3600 * 1000);
  const baselineEnd = thisWeekStart;
  const baselineStart = new Date(baselineEnd.getTime() - 28 * 24 * 3600 * 1000);

  // Convert back to UTC for storage / SQL comparisons.
  return {
    thisWeekStart: fromAestToUtc(thisWeekStart),
    thisWeekEnd: fromAestToUtc(thisWeekEnd),
    baselineStart: fromAestToUtc(baselineStart),
    baselineEnd: fromAestToUtc(baselineEnd),
  };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function fromAestToUtc(aestDate: Date): Date {
  return new Date(aestDate.getTime() - AEST_OFFSET_MS);
}

/**
 * Cron handler for the weekly drift trigger (`0 23 * * 0`). The top-level
 * scheduled dispatch in src/index.ts routes to this based on `controller.cron`.
 */
export async function handleWeeklyDrift(
  controller: ScheduledController,
  env: WorkerBindings,
): Promise<void> {
  const log = createLogger({
    base: { request_id: crypto.randomUUID(), cron: controller.cron },
  });
  log.info("cron tick: weekly drift", {
    scheduled_time: new Date(controller.scheduledTime).toISOString(),
  });
  try {
    const result = await runWeeklyDrift(env, log, new Date(controller.scheduledTime));
    log.info("cron tick complete", { ...result });
  } catch (err) {
    log.error("cron tick failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
