import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeClientRef = vi.hoisted(() => ({ current: null as Client | null }));
vi.mock("../src/services/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/supabase")>();
  return { ...actual, createServiceClient: () => fakeClientRef.current };
});

import { runArrearsScan } from "../src/cron/arrears";
import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { type Db, makeFakeClient, type Row } from "./helpers/fake-supabase";

const AGENCY = "11111111-1111-1111-1111-111111111111";
const PROPERTY = "44444444-4444-4444-4444-444444444401";
const TENANCY = "55555555-5555-5555-5555-555555555501";
const PM = "22222222-2222-2222-2222-222222222201";

const NOW = new Date("2026-06-02T00:00:00Z"); // AEST today 2026-06-02

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
        arrears_since: "2026-05-30", // 3 days overdue at NOW
      },
      // not in arrears → excluded by the `.not(arrears_since is null)` filter
      {
        id: "tenancy-ok",
        agency_id: AGENCY,
        property_id: PROPERTY,
        status: "active",
        arrears_since: null,
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

describe("runArrearsScan", () => {
  it("queues a courtesy reminder for a flagged tenancy, scoped to in-arrears rows only", async () => {
    const result = await runArrearsScan(env, silent, NOW);
    expect(result.tenanciesConsidered).toBe(1); // the non-arrears tenancy is filtered out
    expect(result.draftsCreated).toBe(1);
    expect(result.escalationsFlagged).toBe(0); // 3 days < default 7

    const draft = first("ai_drafts");
    expect(draft.draft_source).toBe("sequence");
    expect(draft.category).toBe("RENT");
    expect(draft.model_used).toBe("template:arrears_v1");
    expect(draft.recipient_email).toBe("alex.tan@example.com");
    expect(draft.draft_body).toContain("3 days overdue");

    const run = first("sequence_runs");
    expect(run.type).toBe("arrears");
    expect(run.state).toBe("awaiting_response");
    expect(run.dedupe_key).toBe(`arrears:${TENANCY}:2026-05-30`);
    expect(rows("audit_log").some((r) => r.action === "sequence.arrears.draft_created")).toBe(true);
  });

  it("flags escalation and diverts the run state once past the policy threshold", async () => {
    first("tenancies").arrears_since = "2026-05-20"; // 13 days overdue >= 7
    const result = await runArrearsScan(env, silent, NOW);
    expect(result.draftsCreated).toBe(1);
    expect(result.escalationsFlagged).toBe(1);
    expect(first("sequence_runs").state).toBe("escalated");
    expect((first("ai_drafts").pm_review_notes as string[]).join("\n")).toContain("Form 11");
  });

  it("honours an escalate_after_days config override", async () => {
    db.sequences = [
      {
        id: "seq-1",
        agency_id: AGENCY,
        type: "arrears",
        is_active: true,
        config: { escalate_after_days: 2 }, // 3 days overdue now escalates
      },
    ];
    const result = await runArrearsScan(env, silent, NOW);
    expect(result.escalationsFlagged).toBe(1);
  });

  it("is idempotent per arrears episode", async () => {
    await runArrearsScan(env, silent, NOW);
    const second = await runArrearsScan(env, silent, NOW);
    expect(second.draftsCreated).toBe(0);
    expect(second.alreadyHandled).toBe(1);
    expect(rows("ai_drafts")).toHaveLength(1);
  });

  it("opens a fresh reminder when a new arrears episode starts", async () => {
    await runArrearsScan(env, silent, NOW);
    // Rent caught up then fell behind again on a new date.
    first("tenancies").arrears_since = "2026-06-01";
    const second = await runArrearsScan(env, silent, NOW);
    expect(second.draftsCreated).toBe(1);
    expect(rows("ai_drafts")).toHaveLength(2);
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
    const result = await runArrearsScan(env, silent, NOW);
    expect(result.noRecipient).toBe(1);
    expect(result.draftsCreated).toBe(0);
    expect(rows("sequence_runs")).toHaveLength(0);
  });

  it("respects a disabled sequence row", async () => {
    db.sequences = [{ id: "seq-1", agency_id: AGENCY, type: "arrears", is_active: false }];
    const result = await runArrearsScan(env, silent, NOW);
    expect(result.agenciesSkipped).toBe(1);
    expect(result.draftsCreated).toBe(0);
  });
});
