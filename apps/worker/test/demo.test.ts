import { DEMO_AGENCY_ID, DEMO_ARREARS_TENANCY_ID, demoId } from "@pm/shared";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// --- Module mocks -----------------------------------------------------------
vi.mock("../src/services/supabase", () => ({
  createServiceClient: vi.fn(() => currentClient),
  writeAuditLog: vi.fn(async () => undefined),
}));
vi.mock("../src/services/draft-pipeline", () => ({
  runDraftPipeline: vi.fn(async () => ({
    kind: "ok",
    draftId: "draft-demo-1",
    matchConfidence: "high",
    matchedVia: "exact_email",
  })),
}));

import {
  buildDemoFixtures,
  did,
  DEMO_AGENCY_ID as FIXTURE_AGENCY_ID,
} from "../../../scripts/demo-fixtures.mjs";
import type { WorkerBindings } from "../src/lib/env";
import { demoRoute } from "../src/routes/demo";
import { runDraftPipeline } from "../src/services/draft-pipeline";

const runDraftPipelineMock = runDraftPipeline as Mock;

// --- Fake supabase (only the surfaces the demo routes touch) -----------------
interface DemoState {
  isDemo: boolean;
  scenario: {
    id: string;
    key: string;
    title: string;
    from_name: string;
    from_address: string;
    subject: string;
    body: string;
  } | null;
  scenarioUpdates: Array<Record<string, unknown>>;
  threadUpserts: Array<Record<string, unknown>>;
  messageInserts: Array<Record<string, unknown>>;
  deletes: string[];
  tenancyUpdates: Array<{ patch: Record<string, unknown>; filters: unknown[] }>;
}

let state: DemoState;
// biome-ignore lint/suspicious/noExplicitAny: only the touched shape is mocked
let currentClient: any;

function makeClient(s: DemoState) {
  return {
    from(table: string) {
      switch (table) {
        case "agencies":
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { is_demo: s.isDemo }, error: null }),
              }),
            }),
          };
        case "demo_scenarios":
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: s.scenario, error: null }) }),
              }),
            }),
            update: (patch: Record<string, unknown>) => {
              s.scenarioUpdates.push(patch);
              return {
                eq: () => ({ eq: async () => ({ error: null }) }),
              };
            },
          };
        case "email_threads":
          return {
            upsert: (row: Record<string, unknown>) => {
              s.threadUpserts.push(row);
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: { id: "thread-db-1" }, error: null }),
                }),
              };
            },
            delete: () => ({
              eq: async () => {
                s.deletes.push(table);
                return { error: null };
              },
            }),
          };
        case "email_messages":
          return {
            insert: (row: Record<string, unknown>) => {
              s.messageInserts.push(row);
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: { id: "msg-db-1" }, error: null }),
                }),
              };
            },
            delete: () => ({
              eq: async () => {
                s.deletes.push(table);
                return { error: null };
              },
            }),
          };
        case "tenancies":
          return {
            update: (patch: Record<string, unknown>) => ({
              eq: (c1: string, v1: unknown) => ({
                eq: async (c2: string, v2: unknown) => {
                  s.tenancyUpdates.push({ patch, filters: [c1, v1, c2, v2] });
                  return { error: null };
                },
              }),
            }),
          };
        default:
          // Activity tables in the reset path all use .delete().eq(...)
          return {
            delete: () => ({
              eq: async () => {
                s.deletes.push(table);
                return { error: null };
              },
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: async () => {
                s.scenarioUpdates.push(patch);
                return { error: null };
              },
            }),
          };
      }
    },
  };
}

// --- Env + token --------------------------------------------------------------
const SECRET = "test-supabase-jwt-secret-0123456789";
const SUPABASE_URL = "http://127.0.0.1:54321";
const env = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-key-1234567890abcdef",
  SUPABASE_JWT_SECRET: SECRET,
  ANTHROPIC_API_KEY: "sk-ant-test-key-123456789",
} as unknown as WorkerBindings;

async function token(agencyId = DEMO_AGENCY_ID): Promise<string> {
  return new SignJWT({ app_metadata: { agency_id: agencyId } })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("auth-user-1")
    .setAudience("authenticated")
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

async function post(path: string, body: unknown, bearer?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return demoRoute.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}

beforeEach(() => {
  vi.clearAllMocks();
  runDraftPipelineMock.mockResolvedValue({
    kind: "ok",
    draftId: "draft-demo-1",
    matchConfidence: "high",
    matchedVia: "exact_email",
  });
  state = {
    isDemo: true,
    scenario: {
      id: "scen-1",
      key: "urgent-maintenance-hot-water",
      title: "Urgent: no hot water",
      from_name: "Mia Thompson",
      from_address: "mia.thompson@example.com",
      subject: "No hot water at 12 Banksia Street",
      body: "We've got no hot water at all…",
    },
    scenarioUpdates: [],
    threadUpserts: [],
    messageInserts: [],
    deletes: [],
    tenancyUpdates: [],
  };
  currentClient = makeClient(state);
});

describe("POST /api/demo/inject", () => {
  it("persists a synthetic inbound and runs the REAL draft pipeline", async () => {
    const res = await post(
      "/api/demo/inject",
      { scenarioKey: "urgent-maintenance-hot-water" },
      await token(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { draftId: string; emailMessageId: string };
    expect(json).toMatchObject({ ok: true, draftId: "draft-demo-1", emailMessageId: "msg-db-1" });

    // The inbound was persisted with the webhook's shapes (demo-marked ids).
    expect(state.threadUpserts).toHaveLength(1);
    expect(String(state.threadUpserts[0]?.gmail_thread_id)).toMatch(/^demo-thread-/);
    expect(state.messageInserts).toHaveLength(1);
    expect(state.messageInserts[0]).toMatchObject({
      direction: "inbound",
      from_address: "mia.thompson@example.com",
    });

    // The REAL pipeline ran with the scenario's content.
    expect(runDraftPipelineMock).toHaveBeenCalledTimes(1);
    expect(runDraftPipelineMock.mock.calls[0]?.[1]).toMatchObject({
      agencyId: DEMO_AGENCY_ID,
      fromAddress: "mia.thompson@example.com",
      subject: "No hot water at 12 Banksia Street",
    });
  });

  it("403s on a non-demo tenant — demo controls are sealed off real agencies", async () => {
    state.isDemo = false;
    const res = await post("/api/demo/inject", { scenarioKey: "x" }, await token("agency-real"));
    expect(res.status).toBe(403);
    expect(runDraftPipelineMock).not.toHaveBeenCalled();
  });

  it("404s on an unknown scenario", async () => {
    state.scenario = null;
    const res = await post("/api/demo/inject", { scenarioKey: "nope" }, await token());
    expect(res.status).toBe(404);
  });

  it("401s without a token", async () => {
    const res = await post("/api/demo/inject", { scenarioKey: "x" });
    expect(res.status).toBe(401);
  });

  it("502s (no scenario consumed) when the pipeline skips", async () => {
    runDraftPipelineMock.mockResolvedValueOnce({ kind: "skipped", reason: "no active prompt" });
    const res = await post(
      "/api/demo/inject",
      { scenarioKey: "urgent-maintenance-hot-water" },
      await token(),
    );
    expect(res.status).toBe(502);
  });
});

describe("POST /api/demo/reset", () => {
  it("clears activity tables, restores scenarios, and re-pins the arrears date", async () => {
    const res = await post("/api/demo/reset", {}, await token());
    expect(res.status).toBe(200);
    // Every activity table got a scoped delete.
    for (const t of ["maintenance_jobs", "ai_drafts", "email_messages", "audit_log"]) {
      expect(state.deletes).toContain(t);
    }
    // Scenarios restored to unused.
    expect(state.scenarioUpdates.some((u) => u.used_at === null)).toBe(true);
    // Arrears re-pinned on the fixed demo tenancy.
    expect(state.tenancyUpdates).toHaveLength(1);
    expect(state.tenancyUpdates[0]?.filters).toContain(DEMO_ARREARS_TENANCY_ID);
    expect(String(state.tenancyUpdates[0]?.patch.arrears_since)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("403s on a non-demo tenant", async () => {
    state.isDemo = false;
    const res = await post("/api/demo/reset", {}, await token("agency-real"));
    expect(res.status).toBe(403);
    expect(state.deletes).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Fixture invariants — the seed's structure is part of the demo's contract.
// -----------------------------------------------------------------------------

describe("demo fixtures", () => {
  const fx = buildDemoFixtures("2026-06-09");

  it("stays in sync with the @pm/shared demo constants", () => {
    expect(FIXTURE_AGENCY_ID).toBe(DEMO_AGENCY_ID);
    expect(did(305)).toBe(DEMO_ARREARS_TENANCY_ID);
    expect(demoId(305)).toBe(did(305));
    // The arrears scenario really anchors on that tenancy (21 Driftway Close,
    // PROPERTY_ROWS index 4 → tenancy did(301+4)).
    const arrears = fx.tenancies.filter((t) => t.arrears_since !== null);
    expect(arrears).toHaveLength(1);
    expect(arrears[0]?.id).toBe(DEMO_ARREARS_TENANCY_ID);
  });

  it("meets the brief: 25 properties across the four suburbs, rents $450–$850/wk, bond = 4 weeks", () => {
    expect(fx.properties).toHaveLength(25);
    const suburbs = new Set(fx.properties.map((p) => p.suburb));
    for (const s of ["Maroochydore", "Coolum Beach", "Buderim", "Caloundra"]) {
      expect(suburbs.has(s)).toBe(true);
    }
    for (const t of fx.tenancies) {
      const weekly = t.rent_amount_cents / 100;
      expect(weekly).toBeGreaterThanOrEqual(450);
      expect(weekly).toBeLessThanOrEqual(850);
      expect(t.bond_amount_cents).toBe(t.rent_amount_cents * 4);
      expect(t.bond_rta_reference).toMatch(/^RTA-1/);
    }
  });

  it("has 10 scenarios whose senders resolve to seeded people (tradie deliberately unknown)", () => {
    expect(fx.scenarios).toHaveLength(10);
    const people = new Set([...fx.tenants.map((t) => t.email), ...fx.owners.map((o) => o.email)]);
    const matched = fx.scenarios.filter((s) => people.has(s.from_address));
    expect(matched).toHaveLength(9);
    const unmatched = fx.scenarios.find((s) => !people.has(s.from_address));
    expect(unmatched?.key).toBe("tradie-quote-follow-up");
    // Fictional-only senders: the IANA-reserved example.com can never receive mail.
    for (const s of fx.scenarios) expect(s.from_address).toMatch(/@example\.com$/);
  });

  it("compliance chips only reference rule keys the engine actually has", async () => {
    const { RULE_KEYS } = await import("@pm/rules");
    const valid = new Set<string>(RULE_KEYS);
    for (const s of fx.scenarios) {
      for (const chip of s.compliance) {
        expect(chip.label.length).toBeGreaterThan(0);
        if (chip.ruleKey) expect(valid.has(chip.ruleKey)).toBe(true);
        // No chip label may smuggle in a hardcoded statutory number (§0.3):
        // statutory values must come from the rules engine at render time.
        expect(chip.label).not.toMatch(/\b\d+\s*(day|week|month)s?\b/i);
      }
    }
  });
});
