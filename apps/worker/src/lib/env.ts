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
