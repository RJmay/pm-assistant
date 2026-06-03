import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeClientRef = vi.hoisted(() => ({ current: null as Client | null }));
vi.mock("../src/services/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/supabase")>();
  return { ...actual, createServiceClient: () => fakeClientRef.current };
});

import { runQuoteChaserScan } from "../src/cron/maintenance-chasers";
import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { type Db, makeFakeClient, type Row } from "./helpers/fake-supabase";

const AGENCY = "11111111-1111-1111-1111-111111111111";
const PROPERTY = "44444444-4444-4444-4444-444444444401";
const PM = "22222222-2222-2222-2222-222222222201";
// cutoff = NOW - 3 days = 2026-05-31. q-stale (2026-05-28) chases; q-recent (2026-06-02) doesn't.
const NOW = new Date("2026-06-03T00:00:00Z");

function baseDb(): Db {
  return {
    agencies: [{ id: AGENCY, name: "Sunshine Coast Test Agency", status: "active" }],
    agency_config: [{ agency_id: AGENCY, pm_signoff_default: "Kind regards," }],
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
    maintenance_jobs: [
      {
        id: "job-1",
        agency_id: AGENCY,
        property_id: PROPERTY,
        issue: "Leaking tap",
        trade: "plumbing",
        state: "quoting",
        quotes: [
          {
            id: "q-stale",
            tradie_name: "Coastline Plumbing",
            trade: "plumbing",
            status: "requested",
            requested_at: "2026-05-28T00:00:00Z",
            draft_id: "orig-1",
          },
          {
            id: "q-recent",
            tradie_name: "Fresh Plumbing",
            trade: "plumbing",
            status: "requested",
            requested_at: "2026-06-02T00:00:00Z",
            draft_id: "orig-2",
          },
        ],
      },
    ],
    ai_drafts: [
      { id: "orig-1", agency_id: AGENCY, recipient_email: "quotes@coastline.example" },
      { id: "orig-2", agency_id: AGENCY, recipient_email: "fresh@example.com" },
    ],
    audit_log: [],
  };
}

const env = {} as unknown as WorkerBindings;
const silent = createLogger({ level: "error" });

let db: Db;
const rows = (t: string): Row[] => db[t] ?? [];

beforeEach(() => {
  db = baseDb();
  fakeClientRef.current = makeFakeClient(db);
});

describe("runQuoteChaserScan", () => {
  it("chases only stale, un-chased requested quotes and stamps chased_at", async () => {
    const result = await runQuoteChaserScan(env, silent, NOW);
    expect(result.jobsInspected).toBe(1);
    expect(result.chasersDrafted).toBe(1);

    const chaser = rows("ai_drafts").find(
      (d) => d.model_used === "template:tradie_quote_chaser_v1",
    );
    expect(chaser?.recipient_email).toBe("quotes@coastline.example");
    expect(chaser?.draft_source).toBe("maintenance");
    expect(chaser?.draft_subject).toContain("Following up");
    expect(chaser?.draft_body).toContain("following up");
    expect(chaser?.draft_body).not.toMatch(/\{\{|\}\}/);

    const job = rows("maintenance_jobs")[0];
    const quotes = job?.quotes as Array<{ id: string; chased_at?: string }>;
    expect(quotes.find((q) => q.id === "q-stale")?.chased_at).toBeTruthy();
    expect(quotes.find((q) => q.id === "q-recent")?.chased_at).toBeUndefined();
    expect(rows("audit_log").some((r) => r.action === "maintenance.quote_chased")).toBe(true);
  });

  it("is idempotent — a second run chases nothing", async () => {
    await runQuoteChaserScan(env, silent, NOW);
    const second = await runQuoteChaserScan(env, silent, NOW);
    expect(second.chasersDrafted).toBe(0);
    expect(
      rows("ai_drafts").filter((d) => d.model_used === "template:tradie_quote_chaser_v1"),
    ).toHaveLength(1);
  });

  it("ignores jobs that aren't in the quoting state", async () => {
    (rows("maintenance_jobs")[0] as Row).state = "approved";
    const result = await runQuoteChaserScan(env, silent, NOW);
    expect(result.jobsInspected).toBe(0);
    expect(result.chasersDrafted).toBe(0);
  });
});
