import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeClientRef = vi.hoisted(() => ({ current: null as Client | null }));
vi.mock("../src/services/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/supabase")>();
  return { ...actual, createServiceClient: () => fakeClientRef.current };
});

import { runInspectionScan } from "../src/cron/inspection";
import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { type Db, makeFakeClient, type Row } from "./helpers/fake-supabase";

const AGENCY = "11111111-1111-1111-1111-111111111111";
const PROPERTY = "44444444-4444-4444-4444-444444444401";
const TENANCY = "55555555-5555-5555-5555-555555555501";
const PM = "22222222-2222-2222-2222-222222222201";

// 2026-06-02 AEST. Lead window default 14d → dueBy 2026-06-16. Interval 6mo.
const NOW = new Date("2026-06-02T00:00:00Z");

function baseDb(): Db {
  return {
    agencies: [{ id: AGENCY, name: "Sunshine Coast Test Agency", status: "active" }],
    sequences: [],
    agency_config: [{ agency_id: AGENCY, pm_signoff_default: "Kind regards," }],
    tenancies: [
      {
        id: TENANCY,
        agency_id: AGENCY,
        property_id: PROPERTY,
        status: "active",
        start_date: "2024-06-01",
        last_routine_inspection_date: "2025-12-01", // +6mo = 2026-06-01, within window
      },
    ],
    tenants: [
      {
        id: "tenant-1",
        agency_id: AGENCY,
        tenancy_id: TENANCY,
        full_name: "Alex Tan",
        email: "alex.tan@example.com",
        is_primary: true,
      },
    ],
    properties: [
      {
        id: PROPERTY,
        agency_id: AGENCY,
        address_line1: "12 Marine Parade",
        suburb: "Maroochydore",
        managing_pm_id: PM,
      },
    ],
    agency_users: [
      { id: PM, agency_id: AGENCY, full_name: "Jess Bowman", role: "pm", active: true },
    ],
    ai_drafts: [],
    sequence_runs: [],
    audit_log: [],
  };
}

const env = {} as unknown as WorkerBindings;
const silent = createLogger({ level: "error" });

let db: Db;
const rows = (t: string): Row[] => db[t] ?? [];
const first = (t: string): Row => {
  const r = rows(t)[0];
  if (!r) throw new Error(`expected at least one row in ${t}`);
  return r;
};

beforeEach(() => {
  db = baseDb();
  fakeClientRef.current = makeFakeClient(db, {
    uniqueKeys: { sequence_runs: ["agency_id", "dedupe_key"] },
  });
});

describe("runInspectionScan", () => {
  it("queues a compliant inspection draft for a tenancy whose inspection is due", async () => {
    const result = await runInspectionScan(env, silent, NOW);
    expect(result.draftsCreated).toBe(1);
    expect(result.tenanciesConsidered).toBe(1);

    const draft = first("ai_drafts");
    expect(draft.draft_source).toBe("sequence");
    expect(draft.category).toBe("ADMIN");
    expect(draft.model_used).toBe("template:inspection_v1");
    expect(draft.recipient_email).toBe("alex.tan@example.com");
    // proposed date = 2026-06-02 + 7 days = 2026-06-09 (notice period bound)
    expect(draft.draft_body).toContain("9 June 2026");
    expect(draft.draft_body).toContain("Form 9");
    expect(draft.draft_body).not.toMatch(/\{\{|\}\}/);

    const run = first("sequence_runs");
    expect(run.type).toBe("inspection");
    expect(run.dedupe_key).toBe(`inspection:${TENANCY}:2026-06-01`);
    expect(rows("audit_log").some((r) => r.action === "sequence.inspection.draft_created")).toBe(
      true,
    );
  });

  it("uses the tenancy start date as the baseline when there's no prior inspection", async () => {
    first("tenancies").last_routine_inspection_date = null;
    const result = await runInspectionScan(env, silent, NOW);
    // start 2024-06-01 + 6mo = 2024-12-01, long overdue → due now
    expect(result.draftsCreated).toBe(1);
  });

  it("does not draft when the next inspection is beyond the lead window", async () => {
    first("tenancies").last_routine_inspection_date = "2026-05-01"; // +6mo = 2026-11-01
    const result = await runInspectionScan(env, silent, NOW);
    expect(result.tenanciesConsidered).toBe(0);
    expect(result.draftsCreated).toBe(0);
  });

  it("is idempotent across scans", async () => {
    await runInspectionScan(env, silent, NOW);
    const second = await runInspectionScan(env, silent, NOW);
    expect(second.draftsCreated).toBe(0);
    expect(second.alreadyHandled).toBe(1);
    expect(rows("ai_drafts")).toHaveLength(1);
  });

  it("skips (without opening a run) when there's no contactable tenant", async () => {
    db.tenants = [
      {
        id: "tenant-1",
        agency_id: AGENCY,
        tenancy_id: TENANCY,
        full_name: "Alex Tan",
        email: null,
        is_primary: true,
      },
    ];
    const result = await runInspectionScan(env, silent, NOW);
    expect(result.noRecipient).toBe(1);
    expect(result.draftsCreated).toBe(0);
    expect(rows("sequence_runs")).toHaveLength(0);
  });

  it("respects a disabled sequence row", async () => {
    db.sequences = [{ id: "seq-1", agency_id: AGENCY, type: "inspection", is_active: false }];
    const result = await runInspectionScan(env, silent, NOW);
    expect(result.agenciesSkipped).toBe(1);
    expect(result.draftsCreated).toBe(0);
  });

  it("honours interval_months + lead_days config overrides", async () => {
    // interval 12mo from last 2025-12-01 = 2026-12-01, far beyond a 7-day lead.
    db.sequences = [
      {
        id: "seq-1",
        agency_id: AGENCY,
        type: "inspection",
        is_active: true,
        config: { interval_months: 12, lead_days: 7 },
      },
    ];
    const result = await runInspectionScan(env, silent, NOW);
    expect(result.tenanciesConsidered).toBe(0);
    expect(result.draftsCreated).toBe(0);
  });
});
