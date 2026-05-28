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
});
