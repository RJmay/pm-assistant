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
vi.mock("../src/services/supabase", () => ({
  createServiceClient: () => ({}),
  writeAuditLog: vi.fn(),
}));

vi.mock("../src/services/pubsub", async () => {
  const actual =
    await vi.importActual<typeof import("../src/services/pubsub")>("../src/services/pubsub");
  return { ...actual, getGoogleJwks: vi.fn() };
});

import { Hono } from "hono";
import type { WorkerBindings } from "../src/lib/env";
import { gmailWebhook } from "../src/routes/gmail-webhook";
import { getGoogleJwks } from "../src/services/pubsub";
import { writeAuditLog } from "../src/services/supabase";

const writeAuditLogMock = writeAuditLog as Mock;
const getGoogleJwksMock = getGoogleJwks as Mock;

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
  getGoogleJwksMock.mockResolvedValue(jwks);
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
  JWKS_CACHE: {} as KVNamespace,
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
  it("returns 200 and writes audit_log on a valid request", async () => {
    const token = await makeToken();
    const envelope = makeEnvelope({ emailAddress: "agency@example.com", historyId: "12345" });
    const res = await post(envelope, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
    const entry = writeAuditLogMock.mock.calls[0]?.[1];
    expect(entry).toMatchObject({
      action: "gmail.pubsub.received",
      actor_type: "system",
      metadata: {
        emailAddress: "agency@example.com",
        historyId: "12345",
        messageId: "test-message-id-1",
        verified_email: SERVICE_ACCOUNT,
      },
    });
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
