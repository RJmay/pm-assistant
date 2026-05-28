import { PubSubVerificationError } from "@pm/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import { getGoogleJwks, type PubSubClaims, verifyPubSubJwt } from "../services/pubsub";
import { createServiceClient, writeAuditLog } from "../services/supabase";

// Pub/Sub push envelope shape — see
// https://cloud.google.com/pubsub/docs/push#receive_push
const pubsubEnvelopeSchema = z.object({
  message: z.object({
    data: z.string(),
    messageId: z.string(),
    publishTime: z.string(),
    attributes: z.record(z.string(), z.string()).optional(),
  }),
  subscription: z.string(),
});

// Gmail's push payload — JSON in `message.data` after base64 decode.
const gmailPayloadSchema = z.object({
  emailAddress: z.string(),
  historyId: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

// Placeholder agency for M4. M5 will resolve agency_id from `emailAddress`
// via `agency_email_state.mailbox_address`.
const SUNSHINE_COAST_TEST_AGENCY = "11111111-1111-1111-1111-111111111111";

type Vars = { requestId: string };

export const gmailWebhook = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

gmailWebhook.post("/webhook/gmail", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });

  // ---- 1. Extract bearer token ----
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    log.warn("webhook missing bearer token");
    return c.json({ error: "missing or malformed Authorization header" }, 401);
  }
  const token = authHeader.slice("bearer ".length).trim();

  // ---- 2. Verify the JWT (Google's JWKS + service-account + audience) ----
  let claims: PubSubClaims;
  try {
    const jwks = await getGoogleJwks(c.env.JWKS_CACHE);
    claims = await verifyPubSubJwt(token, {
      audience: c.env.GOOGLE_PUBSUB_AUDIENCE,
      serviceAccount: c.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT,
      jwks,
    });
  } catch (err) {
    if (err instanceof PubSubVerificationError) {
      log.warn("webhook JWT verification failed", { reason: err.reason });
      return c.json({ error: "invalid token" }, 401);
    }
    throw err;
  }

  // ---- 3. Parse the Pub/Sub envelope ----
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch (cause) {
    log.warn("webhook body not JSON", { error: String(cause) });
    return c.json({ error: "body must be JSON" }, 400);
  }
  const envelope = pubsubEnvelopeSchema.safeParse(rawBody);
  if (!envelope.success) {
    log.warn("webhook envelope failed validation", { issues: envelope.error.issues });
    return c.json({ error: "malformed Pub/Sub envelope" }, 400);
  }

  // ---- 4. Decode + parse the Gmail payload ----
  let decoded: string;
  try {
    decoded = atob(envelope.data.message.data);
  } catch (cause) {
    log.warn("webhook message.data is not valid base64", { error: String(cause) });
    return c.json({ error: "message.data is not valid base64" }, 400);
  }
  let payloadObj: unknown;
  try {
    payloadObj = JSON.parse(decoded);
  } catch (cause) {
    log.warn("webhook decoded data is not JSON", { error: String(cause) });
    return c.json({ error: "decoded data is not JSON" }, 400);
  }
  const payload = gmailPayloadSchema.safeParse(payloadObj);
  if (!payload.success) {
    log.warn("webhook Gmail payload failed validation", { issues: payload.error.issues });
    return c.json({ error: "malformed Gmail payload" }, 400);
  }

  // ---- 5. Write audit_log (M4 stub; M5 will resolve real agency_id) ----
  const supabase = createServiceClient(c.env);
  try {
    await writeAuditLog(supabase, {
      agency_id: SUNSHINE_COAST_TEST_AGENCY,
      actor_type: "system",
      action: "gmail.pubsub.received",
      metadata: {
        emailAddress: payload.data.emailAddress,
        historyId: payload.data.historyId,
        messageId: envelope.data.message.messageId,
        publishTime: envelope.data.message.publishTime,
        subscription: envelope.data.subscription,
        verified_email: claims.email,
      },
    });
  } catch (err) {
    log.error("audit_log write failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal" }, 500);
  }

  log.info("gmail pubsub received", {
    emailAddress: payload.data.emailAddress,
    historyId: payload.data.historyId,
    messageId: envelope.data.message.messageId,
  });
  return c.json({ ok: true }, 200);
});
