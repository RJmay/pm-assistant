import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/lib/env";

function validRaw(): Record<string, string> {
  return {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_long-enough-test-key-1234567890",
    ANTHROPIC_API_KEY: "sk-ant-api03-test-key-long-enough-12345",
    GMAIL_OAUTH_CLIENT_ID: "1234567890-test.apps.googleusercontent.com",
    GMAIL_OAUTH_CLIENT_SECRET: "GOCSPX-secret-value-test",
    GOOGLE_PUBSUB_AUDIENCE: "https://worker.example/webhook/gmail/",
    GOOGLE_PUBSUB_SERVICE_ACCOUNT: "pubsub-worker-pusher@example-project.iam.gserviceaccount.com",
    WEBHOOK_BASE_URL: "https://pm-assistant.example.workers.dev",
    OAUTH_STATE_SECRET: "test-oauth-state-secret-min-32-chars-12345",
    PUBSUB_TOPIC: "projects/test-project/topics/pm-assistant-gmail",
    TWILIO_ACCOUNT_SID: "AC0000000000000000000000000000test",
    TWILIO_AUTH_TOKEN: "00000000000000000000000000000test",
    TWILIO_FROM_NUMBER: "+61400000000",
    RESEND_API_KEY: "re_0000000000000000000000000000test",
    RESEND_FROM_EMAIL: "noreply@scta-test.example",
    SUPABASE_JWT_SECRET: "test-supabase-jwt-secret-0123456789",
  };
}

describe("envSchema / parseEnv", () => {
  it("accepts a complete, valid env object", () => {
    const parsed = parseEnv(validRaw());
    expect(parsed.SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(parsed.GOOGLE_PUBSUB_SERVICE_ACCOUNT).toContain("@");
  });

  it("rejects a missing SUPABASE_URL", () => {
    const raw = validRaw();
    delete (raw as Partial<typeof raw>).SUPABASE_URL;
    expect(() => parseEnv(raw)).toThrow();
  });

  it("rejects a malformed SUPABASE_URL", () => {
    expect(() => parseEnv({ ...validRaw(), SUPABASE_URL: "not-a-url" })).toThrow();
  });

  it("rejects a too-short ANTHROPIC_API_KEY", () => {
    expect(() => parseEnv({ ...validRaw(), ANTHROPIC_API_KEY: "short" })).toThrow();
  });

  it("rejects a non-email GOOGLE_PUBSUB_SERVICE_ACCOUNT", () => {
    expect(() =>
      parseEnv({ ...validRaw(), GOOGLE_PUBSUB_SERVICE_ACCOUNT: "not-an-email" }),
    ).toThrow();
  });

  it("rejects a non-URL GOOGLE_PUBSUB_AUDIENCE", () => {
    expect(() => parseEnv({ ...validRaw(), GOOGLE_PUBSUB_AUDIENCE: "missing-scheme" })).toThrow();
  });

  it("rejects a missing WEBHOOK_BASE_URL", () => {
    const raw = validRaw();
    delete (raw as Partial<typeof raw>).WEBHOOK_BASE_URL;
    expect(() => parseEnv(raw)).toThrow();
  });

  it("rejects an OAUTH_STATE_SECRET shorter than 32 chars", () => {
    expect(() => parseEnv({ ...validRaw(), OAUTH_STATE_SECRET: "too-short" })).toThrow();
  });

  it("rejects a malformed PUBSUB_TOPIC (missing projects/.../topics/...)", () => {
    expect(() => parseEnv({ ...validRaw(), PUBSUB_TOPIC: "pm-assistant-gmail" })).toThrow();
  });

  it("rejects a too-short TWILIO_ACCOUNT_SID", () => {
    expect(() => parseEnv({ ...validRaw(), TWILIO_ACCOUNT_SID: "AC123" })).toThrow();
  });

  it("rejects a non-E.164 TWILIO_FROM_NUMBER", () => {
    expect(() => parseEnv({ ...validRaw(), TWILIO_FROM_NUMBER: "0400 000 000" })).toThrow();
  });

  it("rejects a too-short RESEND_API_KEY", () => {
    expect(() => parseEnv({ ...validRaw(), RESEND_API_KEY: "re_short" })).toThrow();
  });
});
