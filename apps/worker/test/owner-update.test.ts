import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeClientRef = vi.hoisted(() => ({ current: null as Client | null }));
vi.mock("../src/services/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/supabase")>();
  return { ...actual, createServiceClient: () => fakeClientRef.current };
});

import { reportWindow, runOwnerUpdateScan } from "../src/cron/owner-update";
import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { type Db, makeFakeClient, type Row } from "./helpers/fake-supabase";

const AGENCY = "11111111-1111-1111-1111-111111111111";
const PM = "22222222-2222-2222-2222-222222222201";
const OWNER_A = "33333333-3333-3333-3333-333333333301";
const OWNER_B = "33333333-3333-3333-3333-333333333302";

// Fires 1 Jun 2026 → reports May 2026.
const NOW = new Date("2026-06-01T23:00:00Z");

function baseDb(): Db {
  return {
    agencies: [{ id: AGENCY, name: "Sunshine Coast Test Agency", status: "active" }],
    sequences: [],
    owners: [
      { id: OWNER_A, agency_id: AGENCY, full_name: "Casey Brennan", email: "casey@example.com" },
      { id: OWNER_B, agency_id: AGENCY, full_name: "Pat Nguyen", email: "pat@example.com" },
    ],
    properties: [
      { id: "prop-a1", agency_id: AGENCY, owner_id: OWNER_A },
      { id: "prop-a2", agency_id: AGENCY, owner_id: OWNER_A },
      { id: "prop-b1", agency_id: AGENCY, owner_id: OWNER_B },
    ],
    agency_users: [
      { id: PM, agency_id: AGENCY, full_name: "Jess Bowman", role: "pm", active: true },
    ],
    ai_drafts: [
      // 3 items on owner A's properties in May; 0 on owner B's.
      { id: "d1", agency_id: AGENCY, property_id: "prop-a1", created_at: "2026-05-04T01:00:00Z" },
      { id: "d2", agency_id: AGENCY, property_id: "prop-a1", created_at: "2026-05-20T02:00:00Z" },
      { id: "d3", agency_id: AGENCY, property_id: "prop-a2", created_at: "2026-05-28T03:00:00Z" },
      // outside the window (April + June) — must be excluded
      { id: "d4", agency_id: AGENCY, property_id: "prop-a1", created_at: "2026-04-30T10:00:00Z" },
      { id: "d5", agency_id: AGENCY, property_id: "prop-b1", created_at: "2026-06-01T22:00:00Z" },
    ],
    sequence_runs: [],
    audit_log: [],
  };
}

const env = {} as unknown as WorkerBindings;
const silent = createLogger({ level: "error" });

let db: Db;
const rows = (t: string): Row[] => db[t] ?? [];

beforeEach(() => {
  db = baseDb();
  fakeClientRef.current = makeFakeClient(db, {
    uniqueKeys: { sequence_runs: ["agency_id", "dedupe_key"] },
  });
});

describe("reportWindow", () => {
  it("reports the just-completed AEST month", () => {
    const w = reportWindow(NOW);
    expect(w.monthKey).toBe("2026-05");
    expect(w.label).toBe("May 2026");
  });
});

describe("runOwnerUpdateScan", () => {
  it("drafts one update per owner with the month's item count, scoped to the window", async () => {
    const result = await runOwnerUpdateScan(env, silent, NOW);
    expect(result.draftsCreated).toBe(2);
    expect(result.ownersConsidered).toBe(2);
    const seqDrafts = rows("ai_drafts").filter((d) => d.draft_source === "sequence");
    expect(seqDrafts).toHaveLength(2);

    const casey = seqDrafts.find((d) => d.recipient_email === "casey@example.com");
    const pat = seqDrafts.find((d) => d.recipient_email === "pat@example.com");
    expect(casey?.draft_source).toBe("sequence");
    expect(casey?.category).toBe("ADMIN");
    expect(casey?.model_used).toBe("template:owner_update_v1");
    // owner A: 2 properties, 3 in-window items (April + June excluded)
    expect(casey?.draft_body).toContain("2 properties");
    expect(casey?.draft_body).toContain("3 matters");
    // owner B: 1 property, 0 in-window items
    expect(pat?.draft_body).toContain("1 property");
    expect(pat?.draft_body).toContain("no new matters");

    expect(
      rows("audit_log").filter((r) => r.action === "sequence.owner_update.draft_created"),
    ).toHaveLength(2);
  });

  it("is idempotent for the same report month", async () => {
    await runOwnerUpdateScan(env, silent, NOW);
    const second = await runOwnerUpdateScan(env, silent, NOW);
    expect(second.draftsCreated).toBe(0);
    expect(second.alreadyHandled).toBe(2);
    expect(rows("ai_drafts").filter((d) => d.draft_source === "sequence")).toHaveLength(2);
  });

  it("skips owners with no email or no properties", async () => {
    db.owners = [
      { id: OWNER_A, agency_id: AGENCY, full_name: "Casey", email: null }, // no email
      { id: "owner-c", agency_id: AGENCY, full_name: "No Props", email: "c@example.com" }, // no props
    ];
    const result = await runOwnerUpdateScan(env, silent, NOW);
    expect(result.draftsCreated).toBe(0);
    expect(result.skippedNoEmailOrProps).toBe(2);
  });

  it("respects a disabled sequence row", async () => {
    db.sequences = [{ id: "seq-1", agency_id: AGENCY, type: "owner_update", is_active: false }];
    const result = await runOwnerUpdateScan(env, silent, NOW);
    expect(result.agenciesSkipped).toBe(1);
    expect(result.draftsCreated).toBe(0);
  });
});
