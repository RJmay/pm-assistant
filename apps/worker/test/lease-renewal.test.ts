import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real writeAuditLog (it runs against the fake client); only swap the
// client factory so the scanner talks to our in-memory DB.
const fakeClientRef = vi.hoisted(() => ({ current: null as Client | null }));
vi.mock("../src/services/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/supabase")>();
  return { ...actual, createServiceClient: () => fakeClientRef.current };
});

import { runLeaseRenewalScan } from "../src/cron/lease-renewal";
import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { type Db, makeFakeClient, type Row } from "./helpers/fake-supabase";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const AGENCY = "11111111-1111-1111-1111-111111111111";
const PROPERTY = "44444444-4444-4444-4444-444444444401";
const TENANCY = "55555555-5555-5555-5555-555555555501";
const PM = "22222222-2222-2222-2222-222222222201";

// 2026-06-02 in AEST → a 90-day window reaches ~2026-08-31.
const NOW = new Date("2026-06-02T00:00:00Z");

function baseDb(overrides: Partial<Db> = {}): Db {
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
        agreement_type: "fixed",
        end_date: "2026-07-15",
        last_rent_increase_date: "2025-07-01",
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
    ...overrides,
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
  // sequence_runs is idempotent on (agency_id, dedupe_key).
  fakeClientRef.current = makeFakeClient(db, {
    uniqueKeys: { sequence_runs: ["agency_id", "dedupe_key"] },
  });
});

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("runLeaseRenewalScan", () => {
  it("queues a renewal draft for a fixed-term tenancy expiring within the window", async () => {
    const result = await runLeaseRenewalScan(env, silent, NOW);
    expect(result.draftsCreated).toBe(1);
    expect(result.tenanciesConsidered).toBe(1);

    expect(rows("ai_drafts")).toHaveLength(1);
    const draft = first("ai_drafts");
    expect(draft.draft_source).toBe("sequence");
    expect(draft.category).toBe("LEASE");
    expect(draft.status).toBe("pending");
    expect(draft.recipient_email).toBe("alex.tan@example.com");
    expect(draft.tenancy_id).toBe(TENANCY);
    expect(draft.property_id).toBe(PROPERTY);
    expect(draft.email_message_id ?? null).toBeNull();
    expect(draft.model_used).toBe("template:lease_renewal_v1");
    expect(draft.do_not_send).toBe(false);
    expect(draft.draft_body).toContain("Alex Tan");
    expect(draft.draft_body).toContain("12 Marine Parade, Maroochydore");
    expect(draft.draft_body).toContain("Jess Bowman");
    expect(draft.draft_body).toContain("15 July 2026");
    expect(draft.draft_body).not.toMatch(/\{\{|\}\}/);

    // Run opened + advanced to awaiting_response, draft linked.
    expect(rows("sequence_runs")).toHaveLength(1);
    const run = first("sequence_runs");
    expect(run.type).toBe("lease_renewal");
    expect(run.state).toBe("awaiting_response");
    expect(run.dedupe_key).toBe(`lease_renewal:${TENANCY}:2026-07-15`);
    expect(draft.sequence_run_id).toBe(run.id);

    // Audited.
    expect(rows("audit_log").some((r) => r.action === "sequence.lease_renewal.draft_created")).toBe(
      true,
    );
  });

  it("surfaces the compliant rent-review window in PM notes, never a rent figure in the body", async () => {
    await runLeaseRenewalScan(env, silent, NOW);
    const draft = first("ai_drafts");
    const notes = draft.pm_review_notes as string[];
    const joined = notes.join("\n");
    // earliest = max(notice 2026-06-02 + 2mo = 2026-08-02, last 2025-07-01 + 12mo = 2026-07-01)
    expect(joined).toContain("earliest a new rent could lawfully take effect is 2 August 2026");
    expect(joined).toContain("Do not state a new rent in this email");
    expect(draft.draft_body).not.toMatch(/\$\d/);
  });

  it("is idempotent — a second scan opens no new run and queues no new draft", async () => {
    await runLeaseRenewalScan(env, silent, NOW);
    const second = await runLeaseRenewalScan(env, silent, NOW);
    expect(second.draftsCreated).toBe(0);
    expect(second.alreadyHandled).toBe(1);
    expect(rows("ai_drafts")).toHaveLength(1);
    expect(rows("sequence_runs")).toHaveLength(1);
  });

  it("ignores periodic tenancies and tenancies outside the lead window", async () => {
    rows("tenancies").push(
      {
        id: "periodic",
        agency_id: AGENCY,
        property_id: PROPERTY,
        status: "active",
        agreement_type: "periodic",
        end_date: null,
        last_rent_increase_date: null,
      },
      {
        id: "far-future",
        agency_id: AGENCY,
        property_id: PROPERTY,
        status: "active",
        agreement_type: "fixed",
        end_date: "2027-01-01", // beyond the 90-day window
        last_rent_increase_date: null,
      },
      {
        id: "already-ended",
        agency_id: AGENCY,
        property_id: PROPERTY,
        status: "active",
        agreement_type: "fixed",
        end_date: "2026-01-01", // already past
        last_rent_increase_date: null,
      },
    );
    const result = await runLeaseRenewalScan(env, silent, NOW);
    expect(result.tenanciesConsidered).toBe(1);
    expect(result.draftsCreated).toBe(1);
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
    const result = await runLeaseRenewalScan(env, silent, NOW);
    expect(result.draftsCreated).toBe(0);
    expect(result.noRecipient).toBe(1);
    expect(rows("sequence_runs")).toHaveLength(0); // not opened → retried next scan
    expect(rows("ai_drafts")).toHaveLength(0);
  });

  it("respects an explicit disabled sequence row", async () => {
    db.sequences = [{ id: "seq-1", agency_id: AGENCY, type: "lease_renewal", is_active: false }];
    const result = await runLeaseRenewalScan(env, silent, NOW);
    expect(result.agenciesSkipped).toBe(1);
    expect(result.draftsCreated).toBe(0);
  });

  it("honours a lead_days config override", async () => {
    db.sequences = [
      {
        id: "seq-1",
        agency_id: AGENCY,
        type: "lease_renewal",
        is_active: true,
        config: { lead_days: 7 }, // only 7 days out → the 2026-07-15 lease is excluded
      },
    ];
    const result = await runLeaseRenewalScan(env, silent, NOW);
    expect(result.tenanciesConsidered).toBe(0);
    expect(result.draftsCreated).toBe(0);
  });

  it("falls back to a generic PM name when the property's managing PM is unknown", async () => {
    first("properties").managing_pm_id = null;
    db.agency_users = []; // no active PMs at all
    await runLeaseRenewalScan(env, silent, NOW);
    expect(first("ai_drafts").draft_body).toContain("your property manager");
  });
});
