import type { Json } from "@pm/db";
import { OAuthStateError } from "@pm/shared";
import { type Context, Hono } from "hono";
import { jwtVerify, SignJWT } from "jose";
import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import { exchangeCode, usersGetProfile, usersWatch } from "../services/gmail";
import { createServiceClient, writeAuditLog } from "../services/supabase";
import { storeGmailRefreshToken } from "../services/vault";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

type Vars = { requestId: string };
export const oauthGmail = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

function redirectUri(env: WorkerBindings): string {
  return `${env.WEBHOOK_BASE_URL}/oauth/gmail/callback/`;
}

async function signState(agencyId: string, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ agencyId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(crypto.randomUUID())
    .sign(key);
}

async function verifyState(token: string, secret: string): Promise<{ agencyId: string }> {
  const key = new TextEncoder().encode(secret);
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    const agencyId = payload.agencyId;
    if (typeof agencyId !== "string" || !UUID_REGEX.test(agencyId)) {
      throw new OAuthStateError("agencyId claim missing or malformed");
    }
    return { agencyId };
  } catch (cause) {
    if (cause instanceof OAuthStateError) throw cause;
    throw new OAuthStateError(
      cause instanceof Error ? cause.message : "state verification failed",
      { cause },
    );
  }
}

// ----------------------------------------------------------------------------
// GET /oauth/gmail/start?agency_id=... → redirect to Google consent
// ----------------------------------------------------------------------------

oauthGmail.get("/oauth/gmail/start", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });

  const agencyId = c.req.query("agency_id");
  if (!agencyId || !UUID_REGEX.test(agencyId)) {
    log.warn("oauth start missing or invalid agency_id");
    return c.json({ error: "missing or invalid agency_id" }, 400);
  }

  const state = await signState(agencyId, c.env.OAUTH_STATE_SECRET);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", c.env.GMAIL_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri(c.env));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  log.info("oauth start", { agency_id: agencyId });
  return c.redirect(url.toString(), 302);
});

// ----------------------------------------------------------------------------
// GET /oauth/gmail/callback/ → finalise OAuth, store token, start watch
// ----------------------------------------------------------------------------

type CallbackContext = Context<{ Bindings: WorkerBindings; Variables: Vars }>;

async function handleCallback(c: CallbackContext) {
  const log = createLogger({ base: { request_id: c.get("requestId") } });

  const code = c.req.query("code");
  const state = c.req.query("state");
  const errorParam = c.req.query("error");
  if (errorParam) {
    log.warn("oauth callback returned an error from Google", { error: errorParam });
    return c.json({ error: `google returned: ${errorParam}` }, 400);
  }
  if (!code || !state) {
    log.warn("oauth callback missing code or state");
    return c.json({ error: "missing code or state" }, 400);
  }

  let agencyId: string;
  try {
    const verified = await verifyState(state, c.env.OAUTH_STATE_SECRET);
    agencyId = verified.agencyId;
  } catch (err) {
    if (err instanceof OAuthStateError) {
      log.warn("oauth callback state verification failed", { reason: err.reason });
      return c.json({ error: "invalid state" }, 400);
    }
    throw err;
  }

  // Exchange the auth code for tokens (access + refresh).
  const tokens = await exchangeCode({
    code,
    redirectUri: redirectUri(c.env),
    clientId: c.env.GMAIL_OAUTH_CLIENT_ID,
    clientSecret: c.env.GMAIL_OAUTH_CLIENT_SECRET,
  });
  if (!tokens.refresh_token) {
    log.error("oauth callback did not get a refresh_token (consent not freshly granted?)", {
      agency_id: agencyId,
    });
    return c.json({ error: "no refresh_token returned; re-run with prompt=consent" }, 400);
  }

  // Look up the connected mailbox + initial historyId via Gmail profile.
  const profile = await usersGetProfile("me", { accessToken: tokens.access_token });
  const mailboxAddress = profile.emailAddress;

  // Subscribe the mailbox to our Pub/Sub topic.
  const watch = await usersWatch({
    accessToken: tokens.access_token,
    mailbox: "me",
    topicName: c.env.PUBSUB_TOPIC,
  });

  // Persist: refresh token → Vault; mailbox state → agency_email_state.
  const supabase = createServiceClient(c.env);
  await storeGmailRefreshToken(supabase, agencyId, tokens.refresh_token);

  const expiresAtMs = Number.parseInt(watch.expiration, 10);
  const watchExpiresAt = Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null;

  const { error: upsertErr } = await supabase.from("agency_email_state").upsert(
    {
      agency_id: agencyId,
      mailbox_address: mailboxAddress,
      last_history_id: Number(watch.historyId),
      watch_expires_at: watchExpiresAt,
      pubsub_subscription: c.env.PUBSUB_TOPIC,
    },
    { onConflict: "agency_id" },
  );
  if (upsertErr) {
    log.error("agency_email_state upsert failed", {
      agency_id: agencyId,
      error: upsertErr.message,
    });
    return c.json({ error: "internal" }, 500);
  }

  await writeAuditLog(supabase, {
    agency_id: agencyId,
    actor_type: "system",
    action: "gmail.oauth.completed",
    metadata: {
      mailbox_address: mailboxAddress,
      history_id: watch.historyId,
      watch_expiration: watch.expiration,
    } as unknown as Record<string, Json>,
  });

  log.info("oauth callback complete", {
    agency_id: agencyId,
    mailbox_address: mailboxAddress,
  });

  return c.html(
    `<!doctype html><html><body style="font-family:system-ui;max-width:480px;margin:5rem auto;">
      <h2>Mailbox connected</h2>
      <p>${escapeHtml(mailboxAddress)} is now connected to PM Assistant.</p>
      <p>You can close this window. Inbound emails will start appearing in the daily review queue.</p>
    </body></html>`,
  );
}

// Register the handler under both with-slash and without-slash forms — Google
// preserves whatever's configured in the OAuth client's redirect URI, and we
// want to be forgiving.
oauthGmail.get("/oauth/gmail/callback", handleCallback);
oauthGmail.get("/oauth/gmail/callback/", handleCallback);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
