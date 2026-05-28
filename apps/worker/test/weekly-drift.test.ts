import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeClientRef = vi.hoisted(() => ({ current: null as Client | null }));
vi.mock("../src/services/supabase", () => ({
  createServiceClient: () => fakeClientRef.current,
}));

import {
  computeSignals,
  detectShifts,
  runWeeklyDrift,
  weekWindows,
} from "../src/cron/weekly-drift";
import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";

// ----------------------------------------------------------------------------
// Lightweight supabase fake — just the methods runWeeklyDrift uses.
// ----------------------------------------------------------------------------

interface AgencyRow {
  id: string;
  status: "active" | "suspended" | "archived";
}
interface DraftRow {
  agency_id: string;
  category: "MAINTENANCE" | "RENT" | "LEASE" | "COMPLAINT" | "ADMIN" | "OTHER";
  escalation_flag: "NONE" | "WELFARE" | "LEGAL" | "REPUTATIONAL" | "INCIDENT";
  do_not_send: boolean;
  draft_confidence: "HIGH" | "MEDIUM" | "LOW";
  created_at: string; // ISO
}
interface DigestRow {
  agency_id: string;
  week_start_date: string;
}

interface State {
  agencies: AgencyRow[];
  drafts: DraftRow[];
  existingDigests: DigestRow[];
  insertedDigests: Array<Record<string, unknown>>;
  agenciesError: { message: string } | null;
  insertError: { message: string } | null;
  /** Optional per-call hook to make the agencies scan throw — for the "per-agency failure" test. */
  failOnDraftsScanForAgency?: string;
}

let state: State;

function reset() {
  state = {
    agencies: [],
    drafts: [],
    existingDigests: [],
    insertedDigests: [],
    agenciesError: null,
    insertError: null,
  };
}

function fakeClient(): Client {
  return {
    from(table: string) {
      if (table === "agencies") return agenciesBuilder();
      if (table === "ai_drafts") return draftsBuilder();
      if (table === "weekly_digests") return digestsBuilder();
      throw new Error(`unexpected table ${table}`);
    },
    // biome-ignore lint/suspicious/noExplicitAny: only the surface we touch is mocked
  } as any;
}

function agenciesBuilder() {
  return {
    select: () => ({
      eq: async () => ({ data: state.agencies, error: state.agenciesError }),
    }),
  };
}

interface DraftQuery {
  agency_id?: string;
  gte?: string;
  lt?: string;
}
function draftsBuilder() {
  const q: DraftQuery = {};
  const finish = async () => {
    if (state.failOnDraftsScanForAgency && q.agency_id === state.failOnDraftsScanForAgency) {
      return { data: null, error: { message: "simulated drafts scan failure" } };
    }
    const data = state.drafts.filter((d) => {
      if (q.agency_id && d.agency_id !== q.agency_id) return false;
      if (q.gte && d.created_at < q.gte) return false;
      if (q.lt && d.created_at >= q.lt) return false;
      return true;
    });
    return { data, error: null };
  };
  const builder = {
    select: () => builder,
    eq: (col: string, val: string) => {
      if (col === "agency_id") q.agency_id = val;
      return builder;
    },
    gte: (_col: string, val: string) => {
      q.gte = val;
      return builder;
    },
    lt: (_col: string, val: string) => {
      q.lt = val;
      return builder;
    },
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for fake supabase builder
    then: <T>(resolve: (v: unknown) => T) => finish().then(resolve),
  };
  return builder;
}

function digestsBuilder() {
  return {
    select: () => ({
      eq: (_col: string, agencyId: string) => ({
        eq: (_col2: string, weekStart: string) => ({
          maybeSingle: async () => {
            const found = state.existingDigests.find(
              (d) => d.agency_id === agencyId && d.week_start_date === weekStart,
            );
            return { data: found ?? null, error: null };
          },
        }),
      }),
    }),
    insert: async (row: Record<string, unknown>) => {
      if (state.insertError) return { error: state.insertError };
      state.insertedDigests.push(row);
      return { error: null };
    },
  };
}

const env = { SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y" } as unknown as WorkerBindings;
const silent = createLogger({ level: "error" });

beforeEach(() => {
  reset();
  fakeClientRef.current = fakeClient();
});

// ----------------------------------------------------------------------------
// Pure functions
// ----------------------------------------------------------------------------

describe("computeSignals", () => {
  it("returns all-zero signals for an empty draft set", () => {
    const s = computeSignals([]);
    expect(s.drafts).toBe(0);
    expect(s.escalation_rate).toBe(0);
    expect(s.do_not_send_rate).toBe(0);
    expect(s.mean_draft_confidence).toBe(0);
    expect(s.category_mix.MAINTENANCE).toBe(0);
  });

  it("computes rates + means correctly across a mixed set", () => {
    const drafts = [
      draftRec({ category: "MAINTENANCE", draft_confidence: "HIGH" }),
      draftRec({ category: "MAINTENANCE", draft_confidence: "MEDIUM" }),
      draftRec({ category: "RENT", escalation_flag: "LEGAL", draft_confidence: "LOW" }),
      draftRec({ category: "OTHER", do_not_send: true, draft_confidence: "LOW" }),
    ];
    const s = computeSignals(drafts);
    expect(s.drafts).toBe(4);
    expect(s.category_mix.MAINTENANCE).toBeCloseTo(0.5);
    expect(s.category_mix.RENT).toBeCloseTo(0.25);
    expect(s.category_mix.OTHER).toBeCloseTo(0.25);
    expect(s.escalation_rate).toBeCloseTo(0.25);
    expect(s.do_not_send_rate).toBeCloseTo(0.25);
    // (1.0 + 0.5 + 0.0 + 0.0) / 4 = 0.375
    expect(s.mean_draft_confidence).toBeCloseTo(0.375);
  });
});

describe("detectShifts", () => {
  it("returns an empty shifts object when nothing crossed the threshold", () => {
    const baseline = computeSignals(repeat(20, () => draftRec({ category: "MAINTENANCE" })));
    const current = computeSignals(repeat(20, () => draftRec({ category: "MAINTENANCE" })));
    const shifts = detectShifts(current, baseline);
    expect(shifts.category_mix).toEqual({});
    expect(shifts.escalation_rate).toBeUndefined();
    expect(shifts.do_not_send_rate).toBeUndefined();
    expect(shifts.mean_draft_confidence).toBeUndefined();
  });

  it("flags an escalation_rate jump above 25 points", () => {
    const baseline = computeSignals(
      repeat(20, () => draftRec({ escalation_flag: "NONE" })), // 0% escalation
    );
    const current = computeSignals([
      ...repeat(5, () => draftRec({ escalation_flag: "LEGAL" })),
      ...repeat(5, () => draftRec({ escalation_flag: "NONE" })),
    ]); // 50% escalation
    const shifts = detectShifts(current, baseline);
    expect(shifts.escalation_rate?.delta).toBeCloseTo(0.5);
  });

  it("flags a category_mix shift on a single category", () => {
    const baseline = computeSignals(repeat(20, () => draftRec({ category: "MAINTENANCE" })));
    const current = computeSignals(repeat(20, () => draftRec({ category: "RENT" })));
    const shifts = detectShifts(current, baseline);
    expect(shifts.category_mix.MAINTENANCE?.delta).toBeCloseTo(-1);
    expect(shifts.category_mix.RENT?.delta).toBeCloseTo(1);
  });
});

// ----------------------------------------------------------------------------
// weekWindows
// ----------------------------------------------------------------------------

describe("weekWindows", () => {
  it("produces a Mon-Sun AEST window for a cron firing Monday 09:00 AEST", () => {
    // Monday 09:00 AEST = Sunday 23:00 UTC. Use 2026-06-01 (Monday).
    const cronFiresAt = new Date("2026-05-31T23:00:00Z"); // Sun 23:00 UTC = Mon 09:00 AEST
    const w = weekWindows(cronFiresAt);
    // thisWeekStart = Mon 2026-05-25 00:00 AEST = Sun 2026-05-24 14:00 UTC
    expect(w.thisWeekStart.toISOString()).toBe("2026-05-24T14:00:00.000Z");
    // thisWeekEnd = Mon 2026-06-01 00:00 AEST = Sun 2026-05-31 14:00 UTC
    expect(w.thisWeekEnd.toISOString()).toBe("2026-05-31T14:00:00.000Z");
    // baseline is the 4 weeks before
    expect(w.baselineEnd.toISOString()).toBe(w.thisWeekStart.toISOString());
    expect(w.baselineStart.toISOString()).toBe("2026-04-26T14:00:00.000Z");
  });
});

// ----------------------------------------------------------------------------
// runWeeklyDrift integration with the fake client
// ----------------------------------------------------------------------------

describe("runWeeklyDrift", () => {
  // Monday 09:00 AEST
  const NOW = new Date("2026-05-31T23:00:00Z");

  it("stays silent when there is no signal across an agency", async () => {
    state.agencies = [{ id: "a-1", status: "active" }];
    // 20 baseline + 10 current, identical mix → no shift
    state.drafts = [
      ...repeat(20, (i) =>
        draftRec({ agency_id: "a-1", category: "MAINTENANCE", created_at: nDaysAgo(NOW, 10 + i) }),
      ),
      ...repeat(10, (i) =>
        draftRec({
          agency_id: "a-1",
          category: "MAINTENANCE",
          created_at: nDaysAgo(NOW, 1 + i / 10),
        }),
      ),
    ];
    const result = await runWeeklyDrift(env, silent, NOW);
    expect(result.digestsWritten).toBe(0);
    expect(result.agenciesSkipped).toBe(1);
    expect(state.insertedDigests).toHaveLength(0);
  });

  it("writes a digest when the escalation rate shifts beyond the threshold", async () => {
    state.agencies = [{ id: "a-1", status: "active" }];
    // 20 baseline drafts, 0% escalation
    state.drafts = [
      ...repeat(20, (i) =>
        draftRec({
          agency_id: "a-1",
          category: "MAINTENANCE",
          escalation_flag: "NONE",
          created_at: nDaysAgo(NOW, 10 + i),
        }),
      ),
      // 10 current drafts, 60% escalation
      ...repeat(6, (i) =>
        draftRec({
          agency_id: "a-1",
          escalation_flag: "LEGAL",
          created_at: nDaysAgo(NOW, 1 + i / 10),
        }),
      ),
      ...repeat(4, (i) =>
        draftRec({
          agency_id: "a-1",
          escalation_flag: "NONE",
          created_at: nDaysAgo(NOW, 2 + i / 10),
        }),
      ),
    ];
    const result = await runWeeklyDrift(env, silent, NOW);
    expect(result.digestsWritten).toBe(1);
    expect(state.insertedDigests).toHaveLength(1);
    const row = state.insertedDigests[0] as {
      agency_id: string;
      week_start_date: string;
      signals: unknown;
      suggested_directions: Array<{ topic: string }>;
    };
    expect(row.agency_id).toBe("a-1");
    expect(row.week_start_date).toMatch(/^2026-05-/);
    expect(row.suggested_directions.some((s) => s.topic === "Escalation rate")).toBe(true);
  });

  it("skips when a digest already exists for the same week (idempotent)", async () => {
    state.agencies = [{ id: "a-1", status: "active" }];
    // Same drafts as the previous test, but pre-populate the digest table
    state.drafts = [
      ...repeat(20, (i) =>
        draftRec({
          agency_id: "a-1",
          escalation_flag: "NONE",
          created_at: nDaysAgo(NOW, 10 + i),
        }),
      ),
      ...repeat(10, (i) =>
        draftRec({
          agency_id: "a-1",
          escalation_flag: "LEGAL",
          created_at: nDaysAgo(NOW, 1 + i / 10),
        }),
      ),
    ];
    state.existingDigests = [{ agency_id: "a-1", week_start_date: "2026-05-25" }];
    const result = await runWeeklyDrift(env, silent, NOW);
    expect(result.digestsWritten).toBe(0);
    expect(result.agenciesSkipped).toBe(1);
    expect(state.insertedDigests).toHaveLength(0);
  });

  it("skips agencies with below-threshold sample sizes", async () => {
    state.agencies = [{ id: "a-1", status: "active" }];
    // Only 3 baseline drafts (< MIN_BASELINE=10), 2 this week
    state.drafts = [
      ...repeat(3, (i) => draftRec({ agency_id: "a-1", created_at: nDaysAgo(NOW, 10 + i) })),
      ...repeat(2, (i) => draftRec({ agency_id: "a-1", created_at: nDaysAgo(NOW, 1 + i / 10) })),
    ];
    const result = await runWeeklyDrift(env, silent, NOW);
    expect(result.digestsWritten).toBe(0);
    expect(result.agenciesSkipped).toBe(1);
  });

  it("continues the batch when one agency throws", async () => {
    state.agencies = [
      { id: "a-bad", status: "active" },
      { id: "a-good", status: "active" },
    ];
    state.failOnDraftsScanForAgency = "a-bad";
    state.drafts = [
      ...repeat(20, (i) =>
        draftRec({
          agency_id: "a-good",
          escalation_flag: "NONE",
          created_at: nDaysAgo(NOW, 10 + i),
        }),
      ),
      ...repeat(10, (i) =>
        draftRec({
          agency_id: "a-good",
          escalation_flag: "LEGAL",
          created_at: nDaysAgo(NOW, 1 + i / 10),
        }),
      ),
    ];
    const result = await runWeeklyDrift(env, silent, NOW);
    expect(result.failures).toBe(1);
    expect(result.digestsWritten).toBe(1); // a-good still processed
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function draftRec(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    agency_id: "a-1",
    category: "MAINTENANCE",
    escalation_flag: "NONE",
    do_not_send: false,
    draft_confidence: "MEDIUM",
    created_at: "2026-05-28T10:00:00Z",
    ...overrides,
  };
}

function repeat<T>(n: number, mk: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => mk(i));
}

function nDaysAgo(from: Date, n: number): string {
  return new Date(from.getTime() - n * 24 * 3600 * 1000).toISOString();
}
