import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// ---- Mocks BEFORE importing the route ----

interface UpsertCall {
  table: string;
  row: Record<string, unknown>;
}

const upsertCalls: UpsertCall[] = [];

function makeSupabaseMock() {
  return {
    from(table: string) {
      if (table === "agency_email_state") {
        return {
          upsert: async (row: Record<string, unknown>) => {
            upsertCalls.push({ table, row });
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table} in oauth supabase mock`);
    },
  };
}

vi.mock("../src/services/supabase", () => ({
  createServiceClient: () => makeSupabaseMock(),
  writeAuditLog: vi.fn(),
}));

vi.mock("../src/services/vault", () => ({
  storeGmailRefreshToken: vi.fn(),
}));

vi.mock("../src/services/gmail", () => ({
  exchangeCode: vi.fn(),
  usersGetProfile: vi.fn(),
  usersWatch: vi.fn(),
}));

import { Hono } from "hono";
import type { WorkerBindings } from "../src/lib/env";
import { oauthGmail } from "../src/routes/oauth-gmail";
import { exchangeCode, usersGetProfile, usersWatch } from "../src/services/gmail";
import { writeAuditLog } from "../src/services/supabase";
import { storeGmailRefreshToken } from "../src/services/vault";

const exchangeCodeMock = exchangeCode as Mock;
const usersGetProfileMock = usersGetProfile as Mock;
const usersWatchMock = usersWatch as Mock;
const storeGmailRefreshTokenMock = storeGmailRefreshToken as Mock;
const writeAuditLogMock = writeAuditLog as Mock;

const env: WorkerBindings = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-key-1234567890abcdef",
  ANTHROPIC_API_KEY: "sk-ant-api03-test-key-1234567890",
  GMAIL_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com",
  GMAIL_OAUTH_CLIENT_SECRET: "GOCSPX-test",
  GOOGLE_PUBSUB_AUDIENCE: "https://worker.example/webhook/gmail/",
  GOOGLE_PUBSUB_SERVICE_ACCOUNT: "pub@example.iam.gserviceaccount.com",
  WEBHOOK_BASE_URL: "https://pm-assistant.example.workers.dev",
  OAUTH_STATE_SECRET: "test-oauth-state-secret-min-32-chars-12345",
  PUBSUB_TOPIC: "projects/test-project/topics/pm-assistant-gmail",
  JWKS_CACHE: {} as KVNamespace,
};

const VALID_AGENCY = "00000000-0000-0000-0000-0000000000aa";

function makeApp() {
  const app = new Hono<{ Bindings: WorkerBindings; Variables: { requestId: string } }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "test-request-id");
    await next();
  });
  app.route("/", oauthGmail);
  return app;
}

beforeEach(() => {
  upsertCalls.length = 0;
  exchangeCodeMock.mockReset();
  usersGetProfileMock.mockReset();
  usersWatchMock.mockReset();
  storeGmailRefreshTokenMock.mockReset();
  writeAuditLogMock.mockReset();

  exchangeCodeMock.mockResolvedValue({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    scope: "x",
    token_type: "Bearer",
  });
  usersGetProfileMock.mockResolvedValue({
    emailAddress: "agency@example.com",
    historyId: "1",
  });
  usersWatchMock.mockResolvedValue({
    historyId: "100",
    expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
});

describe("GET /oauth/gmail/start", () => {
  it("rejects requests without an agency_id", async () => {
    const res = await makeApp().request("/oauth/gmail/start", {}, env);
    expect(res.status).toBe(400);
  });

  it("rejects requests with a malformed agency_id", async () => {
    const res = await makeApp().request("/oauth/gmail/start?agency_id=not-uuid", {}, env);
    expect(res.status).toBe(400);
  });

  it("redirects to Google's consent screen with the right query params", async () => {
    const res = await makeApp().request(`/oauth/gmail/start?agency_id=${VALID_AGENCY}`, {}, env);
    expect(res.status).toBe(302);
    const loc = res.headers.get("Location");
    expect(loc).toBeTruthy();
    const url = new URL(loc as string);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(env.GMAIL_OAUTH_CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${env.WEBHOOK_BASE_URL}/oauth/gmail/callback/`,
    );
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("gmail.modify");
    expect(scope).toContain("userinfo.email");
    expect(url.searchParams.get("state")).toBeTruthy();
  });
});

describe("GET /oauth/gmail/callback", () => {
  async function startThenGetState(): Promise<string> {
    const res = await makeApp().request(`/oauth/gmail/start?agency_id=${VALID_AGENCY}`, {}, env);
    const url = new URL(res.headers.get("Location") as string);
    return url.searchParams.get("state") as string;
  }

  it("returns 400 when Google redirects with an error param", async () => {
    const res = await makeApp().request(
      "/oauth/gmail/callback?error=access_denied&state=ignored",
      {},
      env,
    );
    expect(res.status).toBe(400);
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when code or state is missing", async () => {
    const res = await makeApp().request("/oauth/gmail/callback", {}, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 when the state JWT is unverifiable", async () => {
    const res = await makeApp().request("/oauth/gmail/callback?code=abc&state=garbage", {}, env);
    expect(res.status).toBe(400);
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when Google returns no refresh_token (re-consent path)", async () => {
    exchangeCodeMock.mockResolvedValueOnce({
      access_token: "at",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    const state = await startThenGetState();
    const res = await makeApp().request(
      `/oauth/gmail/callback?code=abc&state=${encodeURIComponent(state)}`,
      {},
      env,
    );
    expect(res.status).toBe(400);
    expect(storeGmailRefreshTokenMock).not.toHaveBeenCalled();
  });

  it("on success: stores the refresh token, calls users.watch, upserts state, writes audit log, renders confirmation HTML", async () => {
    const state = await startThenGetState();
    const res = await makeApp().request(
      `/oauth/gmail/callback?code=abc&state=${encodeURIComponent(state)}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("agency@example.com");
    expect(html).toContain("Mailbox connected");

    expect(exchangeCodeMock).toHaveBeenCalledTimes(1);
    expect(usersGetProfileMock).toHaveBeenCalledTimes(1);
    expect(usersWatchMock).toHaveBeenCalledTimes(1);

    expect(storeGmailRefreshTokenMock).toHaveBeenCalledWith(expect.anything(), VALID_AGENCY, "rt");

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]?.row).toMatchObject({
      agency_id: VALID_AGENCY,
      mailbox_address: "agency@example.com",
      last_history_id: 100,
      pubsub_subscription: env.PUBSUB_TOPIC,
    });
    expect(upsertCalls[0]?.row.watch_expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
    const entry = writeAuditLogMock.mock.calls[0]?.[1];
    expect(entry).toMatchObject({
      action: "gmail.oauth.completed",
      actor_type: "system",
      agency_id: VALID_AGENCY,
    });
  });
});
