import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// ---- Mocks must come BEFORE importing the module under test ----

interface StateRow {
  agency_id: string;
  mailbox_address: string;
  watch_expires_at: string | null;
}

let stateRows: StateRow[] = [];
const updateCalls: Array<{ agencyId: string; watchExpiresAt: string | null }> = [];

function makeSupabaseMock() {
  return {
    from(table: string) {
      if (table === "agency_email_state") {
        return {
          select: () => ({
            or: async () => ({ data: stateRows, error: null }),
          }),
          update: (row: { watch_expires_at: string | null }) => ({
            eq: async (_col: string, agencyId: string) => {
              updateCalls.push({ agencyId, watchExpiresAt: row.watch_expires_at });
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table} in cron supabase mock`);
    },
  };
}

vi.mock("../src/services/supabase", () => ({
  createServiceClient: () => makeSupabaseMock(),
}));

vi.mock("../src/services/vault", () => ({
  getGmailRefreshToken: vi.fn(),
}));

vi.mock("../src/services/gmail", () => ({
  refreshAccessToken: vi.fn(),
  usersWatch: vi.fn(),
}));

import { refreshExpiringWatches } from "../src/cron/refresh-watches";
import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { refreshAccessToken, usersWatch } from "../src/services/gmail";
import { getGmailRefreshToken } from "../src/services/vault";

const refreshAccessTokenMock = refreshAccessToken as Mock;
const usersWatchMock = usersWatch as Mock;
const getGmailRefreshTokenMock = getGmailRefreshToken as Mock;

const env = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-key-1234567890abcdef",
  ANTHROPIC_API_KEY: "sk-ant-api03-test-key-1234567890",
  GMAIL_OAUTH_CLIENT_ID: "cid",
  GMAIL_OAUTH_CLIENT_SECRET: "csecret",
  GOOGLE_PUBSUB_AUDIENCE: "https://worker.example/webhook/gmail/",
  GOOGLE_PUBSUB_SERVICE_ACCOUNT: "pub@example.iam.gserviceaccount.com",
  WEBHOOK_BASE_URL: "https://pm-assistant.example.workers.dev",
  OAUTH_STATE_SECRET: "test-oauth-state-secret-min-32-chars-12345",
  PUBSUB_TOPIC: "projects/test-project/topics/pm-assistant-gmail",
  TWILIO_ACCOUNT_SID: "AC0000000000000000000000000000test",
  TWILIO_AUTH_TOKEN: "00000000000000000000000000000test",
  TWILIO_FROM_NUMBER: "+61400000000",
  RESEND_API_KEY: "re_0000000000000000000000000000test",
  RESEND_FROM_EMAIL: "noreply@scta-test.example",
  JWKS_CACHE: {} as KVNamespace,
} satisfies WorkerBindings;

const silentLog = createLogger({ level: "error" });

beforeEach(() => {
  stateRows = [];
  updateCalls.length = 0;
  refreshAccessTokenMock.mockReset();
  usersWatchMock.mockReset();
  getGmailRefreshTokenMock.mockReset();

  refreshAccessTokenMock.mockResolvedValue({
    access_token: "at",
    expires_in: 3600,
    scope: "x",
    token_type: "Bearer",
  });
  // Expiration ~7 days from now in epoch ms
  usersWatchMock.mockImplementation(async () => ({
    historyId: "1",
    expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }));
  getGmailRefreshTokenMock.mockResolvedValue("refresh-tok");
});

describe("refreshExpiringWatches", () => {
  it("returns zero counts when no rows match the cutoff", async () => {
    stateRows = [];
    const result = await refreshExpiringWatches(env, silentLog);
    expect(result).toEqual({ inspected: 0, refreshed: 0, failed: 0 });
    expect(usersWatchMock).not.toHaveBeenCalled();
  });

  it("refreshes each row and writes back the new expiration", async () => {
    stateRows = [
      { agency_id: "a-1", mailbox_address: "a1@x.com", watch_expires_at: null },
      {
        agency_id: "a-2",
        mailbox_address: "a2@x.com",
        watch_expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      },
    ];

    const result = await refreshExpiringWatches(env, silentLog);
    expect(result.inspected).toBe(2);
    expect(result.refreshed).toBe(2);
    expect(result.failed).toBe(0);
    expect(usersWatchMock).toHaveBeenCalledTimes(2);
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls.map((c) => c.agencyId).sort()).toEqual(["a-1", "a-2"]);
    for (const c of updateCalls) {
      expect(c.watchExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("counts a row as failed when no vault token is present, but continues", async () => {
    stateRows = [
      { agency_id: "a-no-tok", mailbox_address: "x@x.com", watch_expires_at: null },
      { agency_id: "a-ok", mailbox_address: "y@x.com", watch_expires_at: null },
    ];
    getGmailRefreshTokenMock.mockImplementation(async (_client, agencyId: string) =>
      agencyId === "a-no-tok" ? null : "refresh-tok",
    );

    const result = await refreshExpiringWatches(env, silentLog);
    expect(result).toEqual({ inspected: 2, refreshed: 1, failed: 1 });
    expect(usersWatchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers from per-agency exceptions so the batch keeps going", async () => {
    stateRows = [
      { agency_id: "a-bad", mailbox_address: "x@x.com", watch_expires_at: null },
      { agency_id: "a-good", mailbox_address: "y@x.com", watch_expires_at: null },
    ];
    usersWatchMock.mockImplementationOnce(async () => {
      throw new Error("gmail upstream 503");
    });

    const result = await refreshExpiringWatches(env, silentLog);
    expect(result).toEqual({ inspected: 2, refreshed: 1, failed: 1 });
  });
});
