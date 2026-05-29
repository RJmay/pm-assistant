import { z } from "zod";

/**
 * Stringly-typed env bindings the Worker requires. Validated once per request
 * via Hono middleware; missing/malformed fields fail loud with a 500 + log
 * (rather than misbehaving silently downstream).
 */
export const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  ANTHROPIC_API_KEY: z.string().min(20),
  GMAIL_OAUTH_CLIENT_ID: z.string().min(10),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().min(10),
  GOOGLE_PUBSUB_AUDIENCE: z.string().url(),
  GOOGLE_PUBSUB_SERVICE_ACCOUNT: z.string().email(),
  /** Base URL of the deployed Worker, no trailing slash. Used to build the
   * OAuth redirect URI (`${base}/oauth/gmail/callback/`). */
  WEBHOOK_BASE_URL: z.string().url(),
  /** HMAC key for OAuth state tokens. At least 32 chars of entropy. */
  OAUTH_STATE_SECRET: z.string().min(32),
  /** Full Pub/Sub topic path used by Gmail's users.watch:
   *  `projects/<gcp-project>/topics/pm-assistant-gmail` */
  PUBSUB_TOPIC: z.string().regex(/^projects\/[^/]+\/topics\/[^/]+$/),
  // ---- Notifier (M7) -----------------------------------------------------
  // Twilio + Resend secrets backing services/twilio.ts and services/resend.ts.
  // Twilio account SIDs are 34 chars (`AC` + 32 hex); the auth token is 32
  // hex. Resend keys begin with `re_` and are ~40 chars. We use length-only
  // floors so test fixtures don't need real-looking values.
  TWILIO_ACCOUNT_SID: z.string().min(20),
  TWILIO_AUTH_TOKEN: z.string().min(20),
  /** E.164 phone number Twilio sends from, e.g. `+61400000000`. */
  TWILIO_FROM_NUMBER: z.string().regex(/^\+[1-9]\d{6,15}$/),
  RESEND_API_KEY: z.string().min(20),
  /** Verified Resend sender; either bare email or `Name <addr>` form. */
  RESEND_FROM_EMAIL: z.string().min(3),
  // ---- Send path (M9) ----------------------------------------------------
  /**
   * The Supabase project JWT secret (HS256). Used by lib/auth.ts to verify the
   * dashboard-issued access token on the send route, so the Worker can trust
   * the caller's `sub` + `app_metadata.agency_id`. Supabase JWT secrets are
   * 40+ chars; floor at 20 so test fixtures don't need a real value. (If the
   * project later moves to asymmetric signing keys, swap to JWKS verification.)
   */
  SUPABASE_JWT_SECRET: z.string().min(20),
});

export type WorkerEnv = z.infer<typeof envSchema>;

/**
 * Full Worker bindings = parsed env + non-string bindings (KV namespaces, etc.).
 * Hono's `c.env` resolves to this type.
 */
export interface WorkerBindings extends WorkerEnv {
  JWKS_CACHE: KVNamespace;
}

export function parseEnv(raw: unknown): WorkerEnv {
  return envSchema.parse(raw);
}
