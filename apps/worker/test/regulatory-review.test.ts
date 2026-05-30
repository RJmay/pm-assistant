import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/supabase", () => ({
  createServiceClient: vi.fn(() => currentClient),
  writeAuditLog: vi.fn(async () => undefined),
}));

import type { WorkerBindings } from "../src/lib/env";
import { regulatoryReview } from "../src/routes/regulatory-review";

interface State {
  pm: { id: string; role: string; active: boolean } | null;
  updates: Array<Record<string, unknown>>;
  updateRows: Array<{ id: string }>;
}
let state: State;
// biome-ignore lint/suspicious/noExplicitAny: only the touched shape is mocked
let currentClient: any;

function selectChain(result: unknown) {
  const chain = { eq: () => chain, maybeSingle: async () => result };
  return chain;
}

function makeClient(s: State) {
  return {
    from(table: string) {
      if (table === "agency_users")
        return { select: () => selectChain({ data: s.pm, error: null }) };
      if (table === "regulatory_alerts") {
        return {
          update: (row: Record<string, unknown>) => {
            s.updates.push(row);
            return { eq: () => ({ select: async () => ({ data: s.updateRows, error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const SECRET = "test-supabase-jwt-secret-0123456789";
const SUPABASE_URL = "http://127.0.0.1:54321";
const env = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-key-1234567890abcdef",
  SUPABASE_JWT_SECRET: SECRET,
} as unknown as WorkerBindings;

async function token(overrides: { agencyId?: string } = {}): Promise<string> {
  return new SignJWT({ app_metadata: { agency_id: overrides.agencyId ?? "agency-aaa" } })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("auth-user-1")
    .setAudience("authenticated")
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

async function post(id: string, body: unknown, bearer?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return regulatoryReview.request(
    `/api/regulatory-alerts/${id}/review`,
    { method: "POST", headers, body: JSON.stringify(body) },
    env,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    pm: { id: "pm-1", role: "admin", active: true },
    updates: [],
    updateRows: [{ id: "alert-1" }],
  };
  currentClient = makeClient(state);
});

describe("POST /api/regulatory-alerts/:id/review", () => {
  it("approves an alert", async () => {
    const res = await post("alert-1", { action: "approve" }, await token());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "alert-1", state: "approved" });
    expect(state.updates[0]).toMatchObject({
      operator_review_state: "approved",
      reviewed_by: "pm-1",
    });
  });

  it("dismisses an alert", async () => {
    const res = await post("alert-1", { action: "dismiss" }, await token());
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ operator_review_state: "dismissed" });
  });

  it("rejects a missing/invalid token (401)", async () => {
    expect((await post("alert-1", { action: "approve" })).status).toBe(401);
  });

  it("rejects a non-admin caller (403)", async () => {
    if (state.pm) state.pm.role = "pm";
    expect((await post("alert-1", { action: "approve" }, await token())).status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects a caller with no active agency user (403)", async () => {
    state.pm = null;
    expect((await post("alert-1", { action: "approve" }, await token())).status).toBe(403);
  });

  it("rejects an invalid action (400)", async () => {
    expect((await post("alert-1", { action: "maybe" }, await token())).status).toBe(400);
  });

  it("returns 404 when the alert does not exist", async () => {
    state.updateRows = [];
    expect((await post("nope", { action: "approve" }, await token())).status).toBe(404);
  });
});
