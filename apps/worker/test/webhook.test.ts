import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import { beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// ---- Mock the service modules BEFORE importing the route ----
//
// The webhook now does much more than the M4 stub: it looks up the agency
// from `agency_email_state`, pulls a refresh token from Vault, refreshes the
// access token, calls Gmail's history + messages APIs, and persists each new
// inbound message. We mock all of those collaborators so the test stays
// hermetic.

interface AgencyStateRow {
  agency_id: string;
  last_history_id: number;
}

let stateRowToReturn: AgencyStateRow | null = null;
let lastHistoryUpdateValue: number | null = null;
// Bounce path (handleBounce) collaborators
let outboundRowToReturn: { id: string; gmail_message_id: string } | null = null;
let bounceDraftUpdateRow: Record<string, unknown> | null = null;

function makeSupabaseMock() {
  return {
    from(table: string) {
      if (table === "agency_email_state") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: stateRowToReturn, error: null }),
            }),
          }),
          update: (row: { last_history_id: number }) => {
            lastHistoryUpdateValue = row.last_history_id;
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === "email_threads") {
        return {
          upsert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "thread-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "email_messages") {
        return {
          upsert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: `email-${messageInsertCounter++}` },
                error: null,
              }),
            }),
          }),
          // outbound lookup used by handleBounce
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: outboundRowToReturn, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "ai_drafts") {
        return {
          update: (row: Record<string, unknown>) => {
            bounceDraftUpdateRow = row;
            return {
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    select: async () => ({ data: [{ id: "draft-1" }], error: null }),
                  }),
                }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table} in supabase mock`);
    },
  };
}

let messageInsertCounter = 1;

vi.mock("../src/services/supabase", () => ({
  createServiceClient: () => makeSupabaseMock(),
  writeAuditLog: vi.fn(),
}));

vi.mock("../src/services/vault", () => ({
  getGmailRefreshToken: vi.fn(),
}));

vi.mock("../src/services/gmail", () => ({
  refreshAccessToken: vi.fn(),
  usersHistoryList: vi.fn(),
  usersMessagesGet: vi.fn(),
}));

vi.mock("../src/services/pubsub", async () => {
  const actual =
    await vi.importActual<typeof import("../src/services/pubsub")>("../src/services/pubsub");
  return { ...actual, getGoogleJwks: vi.fn() };
});

vi.mock("../src/services/draft-pipeline", () => ({
  runDraftPipeline: vi.fn(),
}));

import { Hono } from "hono";
import type { WorkerBindings } from "../src/lib/env";
import { gmailWebhook } from "../src/routes/gmail-webhook";
import { runDraftPipeline } from "../src/services/draft-pipeline";
import { refreshAccessToken, usersHistoryList, usersMessagesGet } from "../src/services/gmail";
import { getGoogleJwks } from "../src/services/pubsub";
import { writeAuditLog } from "../src/services/supabase";
import { getGmailRefreshToken } from "../src/services/vault";

const writeAuditLogMock = writeAuditLog as Mock;
const getGoogleJwksMock = getGoogleJwks as Mock;
const getGmailRefreshTokenMock = getGmailRefreshToken as Mock;
const refreshAccessTokenMock = refreshAccessToken as Mock;
const usersHistoryListMock = usersHistoryList as Mock;
const usersMessagesGetMock = usersMessagesGet as Mock;
const runDraftPipelineMock = runDraftPipeline as Mock;

const AUDIENCE = "https://worker.example/webhook/gmail/";
const SERVICE_ACCOUNT = "pubsub-worker-pusher@example-project.iam.gserviceaccount.com";

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const { privateKey: priv, publicKey } = await generateKeyPair("ES256", { extractable: true });
  privateKey = priv as CryptoKey;
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  publicJwk.kid = "test-key";
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

beforeEach(() => {
  writeAuditLogMock.mockReset();
  getGoogleJwksMock.mockReset();
  getGmailRefreshTokenMock.mockReset();
  refreshAccessTokenMock.mockReset();
  usersHistoryListMock.mockReset();
  usersMessagesGetMock.mockReset();
  runDraftPipelineMock.mockReset();
  runDraftPipelineMock.mockResolvedValue({
    kind: "ok",
    draftId: "draft-1",
    matchConfidence: "high",
    matchedVia: "exact_email",
  });
  messageInsertCounter = 1;

  getGoogleJwksMock.mockResolvedValue(jwks);
  getGmailRefreshTokenMock.mockResolvedValue("refresh-token-xyz");
  refreshAccessTokenMock.mockResolvedValue({
    access_token: "access-token-abc",
    expires_in: 3600,
    scope: "https://www.googleapis.com/auth/gmail.modify",
    token_type: "Bearer",
  });
  // Default: history list returns one new INBOX message
  usersHistoryListMock.mockResolvedValue({
    historyId: "67890",
    history: [
      {
        id: "h1",
        messagesAdded: [
          { message: { id: "msg-1", threadId: "thread-gmail-1", labelIds: ["INBOX"] } },
        ],
      },
    ],
  });
  usersMessagesGetMock.mockResolvedValue({
    id: "msg-1",
    threadId: "thread-gmail-1",
    internalDate: String(Date.parse("2026-05-28T09:00:00Z")),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Alice <alice@example.com>" },
        { name: "To", value: "agency@example.com" },
        { name: "Subject", value: "Repair request" },
      ],
      body: { data: btoa("Please fix the tap"), size: 18 },
    },
  });

  stateRowToReturn = { agency_id: "agency-aaa-bbb", last_history_id: 12345 };
  lastHistoryUpdateValue = null;
  outboundRowToReturn = null;
  bounceDraftUpdateRow = null;
});

interface TokenOpts {
  audience?: string;
  email?: string;
  signWith?: CryptoKey;
}

async function makeToken(opts: TokenOpts = {}): Promise<string> {
  return new SignJWT({
    email: opts.email ?? SERVICE_ACCOUNT,
    email_verified: true,
  })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer("https://accounts.google.com")
    .setAudience(opts.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(opts.signWith ?? privateKey);
}

function makeEnvelope(payload: { emailAddress: string; historyId: string | number }) {
  return {
    message: {
      data: btoa(JSON.stringify(payload)),
      messageId: "test-message-id-1",
      publishTime: "2026-05-28T10:00:00Z",
    },
    subscription: "projects/test-project/subscriptions/test-sub",
  };
}

const env = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-key-1234567890abcdef",
  ANTHROPIC_API_KEY: "sk-ant-api03-test-key-1234567890",
  GMAIL_OAUTH_CLIENT_ID: "test.apps.googleusercontent.com",
  GMAIL_OAUTH_CLIENT_SECRET: "GOCSPX-test-secret",
  GOOGLE_PUBSUB_AUDIENCE: AUDIENCE,
  GOOGLE_PUBSUB_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
  WEBHOOK_BASE_URL: "https://pm-assistant.example.workers.dev",
  OAUTH_STATE_SECRET: "test-oauth-state-secret-min-32-chars-12345",
  PUBSUB_TOPIC: "projects/test-project/topics/pm-assistant-gmail",
  TWILIO_ACCOUNT_SID: "AC0000000000000000000000000000test",
  TWILIO_AUTH_TOKEN: "00000000000000000000000000000test",
  TWILIO_FROM_NUMBER: "+61400000000",
  RESEND_API_KEY: "re_0000000000000000000000000000test",
  RESEND_FROM_EMAIL: "noreply@scta-test.example",
  SUPABASE_JWT_SECRET: "test-supabase-jwt-secret-0123456789",
  JWKS_CACHE: {} as KVNamespace,
  MONITORING_CACHE: {} as KVNamespace,
};

function makeApp() {
  const app = new Hono<{ Bindings: WorkerBindings; Variables: { requestId: string } }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "test-request-id");
    await next();
  });
  app.route("/", gmailWebhook);
  return app;
}

async function post(body: unknown, headers: Record<string, string>) {
  return makeApp().request(
    "/webhook/gmail",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("POST /webhook/gmail", () => {
  it("returns 200 and writes audit_log with gmail.pubsub.processed action", async () => {
    const token = await makeToken();
    const envelope = makeEnvelope({ emailAddress: "agency@example.com", historyId: "12345" });
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; messages: number };
    expect(body).toEqual({ ok: true, messages: 1, bounces: 0 });

    expect(getGmailRefreshTokenMock).toHaveBeenCalledTimes(1);
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(usersHistoryListMock).toHaveBeenCalledTimes(1);
    expect(usersMessagesGetMock).toHaveBeenCalledTimes(1);

    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
    const entry = writeAuditLogMock.mock.calls[0]?.[1];
    expect(entry).toMatchObject({
      action: "gmail.pubsub.processed",
      actor_type: "system",
      agency_id: "agency-aaa-bbb",
      metadata: {
        emailAddress: "agency@example.com",
        historyId: "12345",
        messageId: "test-message-id-1",
        verified_email: SERVICE_ACCOUNT,
        messages_processed: 1,
        drafts_ok: 1,
        drafts_skipped: 0,
        drafts_failed: 0,
      },
    });

    // last_history_id advanced to the page's terminal historyId
    expect(lastHistoryUpdateValue).toBe(67890);

    // Pipeline invoked once with the persisted email message's id + parsed payload
    expect(runDraftPipelineMock).toHaveBeenCalledTimes(1);
    const [, pipelineArg] = runDraftPipelineMock.mock.calls[0] ?? [];
    expect(pipelineArg).toMatchObject({
      agencyId: "agency-aaa-bbb",
      emailMessageId: "email-1",
      threadId: "thread-1",
      gmailThreadId: "thread-gmail-1",
      fromAddress: "alice@example.com",
      subject: "Repair request",
    });
  });

  it("still 200s and tallies drafts_failed when the pipeline returns an error", async () => {
    runDraftPipelineMock.mockReset();
    runDraftPipelineMock.mockResolvedValue({ kind: "error", error: new Error("anthropic 500") });
    const token = await makeToken();
    const envelope = makeEnvelope({ emailAddress: "agency@example.com", historyId: "12345" });
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; messages: number };
    expect(body).toEqual({ ok: true, messages: 1, bounces: 0 });
    const entry = writeAuditLogMock.mock.calls[0]?.[1];
    expect(entry?.metadata).toMatchObject({
      messages_processed: 1,
      drafts_ok: 0,
      drafts_skipped: 0,
      drafts_failed: 1,
    });
  });

  it("records a bounce, links the draft, and skips drafting", async () => {
    runDraftPipelineMock.mockReset();
    outboundRowToReturn = { id: "out-1", gmail_message_id: "gmid-1" };
    usersMessagesGetMock.mockReset();
    usersMessagesGetMock.mockResolvedValue({
      id: "msg-1",
      threadId: "thread-gmail-1",
      internalDate: String(Date.parse("2026-05-29T01:00:00Z")),
      payload: {
        mimeType: "multipart/report",
        headers: [
          { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
          { name: "To", value: "agency@example.com" },
          { name: "Subject", value: "Delivery Status Notification (Failure)" },
          {
            name: "Content-Type",
            value: 'multipart/report; report-type=delivery-status; boundary="b"',
          },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: btoa("Address not found"), size: 17 } },
          {
            mimeType: "message/rfc822",
            parts: [
              {
                mimeType: "text/rfc822-headers",
                headers: [{ name: "Message-ID", value: "<sent-original@agency.com.au>" }],
                body: { data: btoa("Message-ID: <sent-original@agency.com.au>"), size: 40 },
              },
            ],
          },
        ],
      },
    });

    const token = await makeToken();
    const res = await post(makeEnvelope({ emailAddress: "agency@example.com", historyId: "999" }), {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, messages: 0, bounces: 1 });

    // a DSN is never drafted
    expect(runDraftPipelineMock).not.toHaveBeenCalled();
    // the originating draft is marked bounced
    expect(bounceDraftUpdateRow?.bounced_at).toBeTruthy();
    expect(bounceDraftUpdateRow?.bounce_detail).toBeTruthy();
    // the processed-audit tallies the bounce
    const processed = writeAuditLogMock.mock.calls.find(
      (c) => c[1]?.action === "gmail.pubsub.processed",
    )?.[1];
    expect(processed?.metadata).toMatchObject({
      messages_processed: 0,
      bounces_detected: 1,
      bounces_matched: 1,
    });
  });

  it("counts skipped drafts in audit metadata (e.g. agency_config missing)", async () => {
    runDraftPipelineMock.mockReset();
    runDraftPipelineMock.mockResolvedValue({ kind: "skipped", reason: "agency_config_not_found" });
    const token = await makeToken();
    const envelope = makeEnvelope({ emailAddress: "agency@example.com", historyId: "12345" });
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const entry = writeAuditLogMock.mock.calls[0]?.[1];
    expect(entry?.metadata).toMatchObject({
      messages_processed: 1,
      drafts_ok: 0,
      drafts_skipped: 1,
      drafts_failed: 0,
    });
  });

  it("returns 200 with ok:false when no agency_email_state row matches the mailbox", async () => {
    stateRowToReturn = null;
    const token = await makeToken();
    const envelope = makeEnvelope({ emailAddress: "unknown@example.com", historyId: "1" });
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/no agency/i);
    // Should NOT have touched Vault, Gmail, or written audit log
    expect(getGmailRefreshTokenMock).not.toHaveBeenCalled();
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("paginates usersHistoryList until nextPageToken is undefined", async () => {
    usersHistoryListMock.mockReset();
    usersHistoryListMock
      .mockResolvedValueOnce({
        historyId: "100",
        history: [
          {
            id: "h1",
            messagesAdded: [{ message: { id: "m1", threadId: "t1", labelIds: ["INBOX"] } }],
          },
        ],
        nextPageToken: "page-2",
      })
      .mockResolvedValueOnce({
        historyId: "200",
        history: [
          {
            id: "h2",
            messagesAdded: [{ message: { id: "m2", threadId: "t2", labelIds: ["INBOX"] } }],
          },
        ],
      });

    usersMessagesGetMock.mockImplementation(async ({ messageId }) => ({
      id: messageId,
      threadId: messageId === "m1" ? "t1" : "t2",
      internalDate: String(Date.parse("2026-05-28T09:00:00Z")),
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "x@y.com" },
          { name: "Subject", value: "S" },
        ],
        body: { data: btoa("hi"), size: 2 },
      },
    }));

    const token = await makeToken();
    const envelope = makeEnvelope({ emailAddress: "agency@example.com", historyId: "1" });
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(usersHistoryListMock).toHaveBeenCalledTimes(2);
    expect(usersMessagesGetMock).toHaveBeenCalledTimes(2);
    expect(lastHistoryUpdateValue).toBe(200);
  });

  it("filters out non-INBOX messagesAdded entries", async () => {
    usersHistoryListMock.mockReset().mockResolvedValueOnce({
      historyId: "999",
      history: [
        {
          id: "h1",
          messagesAdded: [
            { message: { id: "m-inbox", threadId: "t1", labelIds: ["INBOX"] } },
            { message: { id: "m-sent", threadId: "t2", labelIds: ["SENT"] } },
            { message: { id: "m-no-labels", threadId: "t3" } },
          ],
        },
      ],
    });

    const token = await makeToken();
    const envelope = makeEnvelope({ emailAddress: "agency@example.com", historyId: "1" });
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    // Only m-inbox should have been fetched
    expect(usersMessagesGetMock).toHaveBeenCalledTimes(1);
    expect(usersMessagesGetMock.mock.calls[0]?.[0]).toMatchObject({ messageId: "m-inbox" });
  });

  it("returns 401 when Authorization header is missing", async () => {
    const envelope = makeEnvelope({ emailAddress: "x@y.com", historyId: 1 });
    const res = await post(envelope, {});
    expect(res.status).toBe(401);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("returns 401 when token is signed by an unknown key", async () => {
    const wrong = await generateKeyPair("ES256", { extractable: true });
    const token = await makeToken({ signWith: wrong.privateKey as CryptoKey });
    const envelope = makeEnvelope({ emailAddress: "x@y.com", historyId: 1 });
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("returns 401 when token email does not match the configured service account", async () => {
    const token = await makeToken({ email: "intruder@elsewhere.iam.gserviceaccount.com" });
    const envelope = makeEnvelope({ emailAddress: "x@y.com", historyId: 1 });
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("returns 401 when token audience is wrong", async () => {
    const token = await makeToken({ audience: "https://elsewhere.example/" });
    const envelope = makeEnvelope({ emailAddress: "x@y.com", historyId: 1 });
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });

  it("returns 400 when the envelope is malformed (zod rejects)", async () => {
    const token = await makeToken();
    const res = await post({ not: "an envelope" }, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(400);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the Gmail payload (decoded data) is malformed", async () => {
    const token = await makeToken();
    const envelope = {
      message: {
        data: btoa(JSON.stringify({ missingRequiredFields: true })),
        messageId: "test-id",
        publishTime: "2026-05-28T10:00:00Z",
      },
      subscription: "projects/test/subscriptions/test",
    };
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(400);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });
});
