import type { Json } from "@pm/db";
import { PubSubVerificationError } from "@pm/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { WorkerBindings } from "../lib/env";
import { createLogger, type Logger } from "../lib/log";
import { runDraftPipeline } from "../services/draft-pipeline";
import { type ParsedEmail, parseGmailMessage } from "../services/email-parser";
import {
  refreshAccessToken,
  type UsersHistoryListOpts,
  usersHistoryList,
  usersMessagesGet,
} from "../services/gmail";
import { getGoogleJwks, type PubSubClaims, verifyPubSubJwt } from "../services/pubsub";
import { type AuditLogEntry, createServiceClient, writeAuditLog } from "../services/supabase";
import { getGmailRefreshToken } from "../services/vault";

// Pub/Sub push envelope shape.
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

type Vars = { requestId: string };
export const gmailWebhook = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

gmailWebhook.post("/webhook/gmail", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });

  // ---- 1. Bearer token ----
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    log.warn("webhook missing bearer token");
    return c.json({ error: "missing or malformed Authorization header" }, 401);
  }
  const token = authHeader.slice("bearer ".length).trim();

  // ---- 2. Verify the JWT ----
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

  // ---- 3. Parse envelope + Gmail payload ----
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

  let decoded: string;
  try {
    decoded = atob(envelope.data.message.data);
  } catch (cause) {
    log.warn("message.data is not valid base64", { error: String(cause) });
    return c.json({ error: "message.data is not valid base64" }, 400);
  }
  let payloadObj: unknown;
  try {
    payloadObj = JSON.parse(decoded);
  } catch (cause) {
    log.warn("decoded data is not JSON", { error: String(cause) });
    return c.json({ error: "decoded data is not JSON" }, 400);
  }
  const payload = gmailPayloadSchema.safeParse(payloadObj);
  if (!payload.success) {
    log.warn("Gmail payload failed validation", { issues: payload.error.issues });
    return c.json({ error: "malformed Gmail payload" }, 400);
  }

  const mailboxAddress = payload.data.emailAddress;
  const supabase = createServiceClient(c.env);

  // ---- 4. Resolve agency from mailbox_address ----
  const { data: stateRow, error: stateLookupErr } = await supabase
    .from("agency_email_state")
    .select("agency_id, last_history_id")
    .eq("mailbox_address", mailboxAddress)
    .maybeSingle();
  if (stateLookupErr) {
    log.error("agency_email_state lookup failed", { error: stateLookupErr.message });
    return c.json({ error: "internal" }, 500);
  }
  if (!stateRow) {
    // Unknown mailbox — return 200 so Pub/Sub doesn't retry forever.
    log.warn("no agency_email_state for mailbox", { mailbox_address: mailboxAddress });
    return c.json({ ok: false, reason: "no agency for mailbox" }, 200);
  }
  const agencyId = stateRow.agency_id;
  const startHistoryId = String(stateRow.last_history_id);

  // ---- 5. Refresh access token via Vault-stored refresh token ----
  const refreshToken = await getGmailRefreshToken(supabase, agencyId);
  if (!refreshToken) {
    log.error("no refresh token for agency", { agency_id: agencyId });
    return c.json({ error: "internal" }, 500);
  }
  const tokens = await refreshAccessToken({
    refreshToken,
    clientId: c.env.GMAIL_OAUTH_CLIENT_ID,
    clientSecret: c.env.GMAIL_OAUTH_CLIENT_SECRET,
  });

  // ---- 6. Pull all new INBOX messages since last_history_id ----
  const newRefs: Array<{ id: string; threadId: string }> = [];
  let finalHistoryId = startHistoryId;
  let pageToken: string | undefined;
  do {
    const opts: UsersHistoryListOpts = {
      accessToken: tokens.access_token,
      mailbox: "me",
      startHistoryId,
      historyTypes: ["messageAdded"],
    };
    if (pageToken) opts.pageToken = pageToken;
    const page = await usersHistoryList(opts);
    finalHistoryId = page.historyId;
    for (const entry of page.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        if (added.message.labelIds?.includes("INBOX")) {
          newRefs.push({ id: added.message.id, threadId: added.message.threadId });
        }
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  // ---- 7. Fetch + persist each new message ----
  const { persisted, bounceDetected, bounceMatched } = await persistMessages(
    supabase,
    agencyId,
    newRefs,
    tokens.access_token,
    log,
  );

  // ---- 8. Advance last_history_id ----
  const finalHistoryNum = Number.parseInt(finalHistoryId, 10);
  if (Number.isFinite(finalHistoryNum) && String(finalHistoryNum) === finalHistoryId) {
    const { error: stateUpdErr } = await supabase
      .from("agency_email_state")
      .update({ last_history_id: finalHistoryNum })
      .eq("agency_id", agencyId);
    if (stateUpdErr) {
      log.warn("agency_email_state update failed", { error: stateUpdErr.message });
    }
  }

  // ---- 9 + 10. Draft pipeline + audit — run AFTER acking Pub/Sub ----
  // Drafting calls the LLM (multi-second). Doing it before we respond risks
  // blowing the Pub/Sub push acknowledgement deadline: Pub/Sub gives up and the
  // request is canceled mid-draft — and since last_history_id has already
  // advanced (step 8), the redelivery finds nothing and the draft is lost.
  // So: ACK Pub/Sub immediately, finish the work in the background.
  c.executionCtx.waitUntil(
    (async () => {
      let draftsOk = 0;
      let draftsSkipped = 0;
      let draftsFailed = 0;
      let selfSkipped = 0;
      // The notifier sends owner alerts from RESEND_FROM_EMAIL. If one ever lands
      // back in the monitored mailbox (e.g. an owner's address equals the agency
      // inbox), we must NOT draft a reply to our own outbound — that's a feedback
      // loop. Skip anything from our own alert sender.
      const selfSender = extractSenderEmail(c.env.RESEND_FROM_EMAIL);
      try {
        for (const row of persisted) {
          if (selfSender && row.parsed.from.trim().toLowerCase() === selfSender) {
            selfSkipped += 1;
            log.info("skipping draft for our own alert email", { from: row.parsed.from });
            continue;
          }
          const result = await runDraftPipeline(
            supabase,
            {
              agencyId,
              emailMessageId: row.emailMessageId,
              threadId: row.threadId,
              gmailThreadId: row.gmailThreadId,
              fromAddress: row.parsed.from,
              fromName: row.parsed.fromName ?? null,
              toAddresses: row.parsed.to,
              subject: row.parsed.subject,
              bodyPlain: row.parsed.bodyPlain,
              bodyHtml: row.parsed.bodyHtml,
              receivedAt: row.parsed.receivedAt.toISOString(),
            },
            { anthropicApiKey: c.env.ANTHROPIC_API_KEY, env: c.env, logger: log },
          );
          if (result.kind === "ok") draftsOk += 1;
          else if (result.kind === "skipped") draftsSkipped += 1;
          else draftsFailed += 1;
        }

        await writeAuditLog(supabase, {
          agency_id: agencyId,
          actor_type: "system",
          action: "gmail.pubsub.processed",
          metadata: {
            emailAddress: mailboxAddress,
            historyId: payload.data.historyId,
            messageId: envelope.data.message.messageId,
            verified_email: claims.email,
            messages_processed: persisted.length,
            drafts_ok: draftsOk,
            drafts_skipped: draftsSkipped,
            drafts_failed: draftsFailed,
            self_skipped: selfSkipped,
            bounces_detected: bounceDetected,
            bounces_matched: bounceMatched,
          },
        } satisfies AuditLogEntry);

        log.info("gmail pubsub processed", {
          agency_id: agencyId,
          messages_processed: persisted.length,
          drafts_ok: draftsOk,
          drafts_skipped: draftsSkipped,
          drafts_failed: draftsFailed,
          self_skipped: selfSkipped,
          bounces_detected: bounceDetected,
          bounces_matched: bounceMatched,
        });
      } catch (err) {
        // The response is already sent; a background failure must not throw.
        log.error("background draft processing failed", {
          agency_id: agencyId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })(),
  );

  // ACK Pub/Sub right away; drafting continues in the background (above).
  return c.json({ ok: true, messages: persisted.length, bounces: bounceDetected }, 200);
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Extract the bare, lower-cased email from a `Name <addr>` or bare-address value. */
function extractSenderEmail(value: string): string {
  const m = value.match(/<([^>]+)>/);
  return (m?.[1] ?? value).trim().toLowerCase();
}

export interface PersistedMessage {
  emailMessageId: string;
  threadId: string;
  gmailThreadId: string;
  parsed: ParsedEmail;
}

async function persistMessages(
  supabase: ServiceClient,
  agencyId: string,
  refs: Array<{ id: string; threadId: string }>,
  accessToken: string,
  log: Logger,
): Promise<{ persisted: PersistedMessage[]; bounceDetected: number; bounceMatched: number }> {
  const out: PersistedMessage[] = [];
  let bounceDetected = 0;
  let bounceMatched = 0;
  for (const ref of refs) {
    try {
      const full = await usersMessagesGet({ accessToken, mailbox: "me", messageId: ref.id });
      const parsed = parseGmailMessage(full);

      // A bounce / DSN is recorded + linked to its originating draft, and is
      // NOT handed to the draft pipeline (we don't reply to a bounce).
      if (parsed.isBounce) {
        bounceDetected += 1;
        if (await handleBounce(supabase, agencyId, ref, parsed, log)) bounceMatched += 1;
        continue;
      }

      // Upsert thread → get id
      const { data: thread, error: threadErr } = await supabase
        .from("email_threads")
        .upsert(
          {
            agency_id: agencyId,
            gmail_thread_id: ref.threadId,
            subject: parsed.subject,
            last_message_at: parsed.receivedAt.toISOString(),
          },
          { onConflict: "agency_id,gmail_thread_id" },
        )
        .select("id")
        .single();
      if (threadErr || !thread) {
        log.error("email_threads upsert failed", {
          gmail_thread_id: ref.threadId,
          error: threadErr?.message,
        });
        continue;
      }

      // Upsert message — idempotent on (agency_id, gmail_message_id). We let
      // ON CONFLICT DO UPDATE run rather than ignore, so a redelivered Pub/Sub
      // push returns the existing row's id. email_messages has no updated_at
      // trigger, so the re-write is effectively a no-op.
      const insertRow = {
        agency_id: agencyId,
        thread_id: thread.id,
        gmail_message_id: ref.id,
        direction: "inbound" as const,
        from_address: parsed.from,
        from_name: parsed.fromName ?? null,
        to_addresses: parsed.to as unknown as Json,
        cc_addresses: parsed.cc as unknown as Json,
        bcc_addresses: parsed.bcc as unknown as Json,
        subject: parsed.subject,
        body_plain: parsed.bodyPlain,
        body_html: parsed.bodyHtml,
        message_id_header: parsed.messageIdHeader,
        in_reply_to: parsed.inReplyTo,
        references_headers: parsed.references,
        attachments: parsed.attachments as unknown as Json,
        received_at: parsed.receivedAt.toISOString(),
      };
      const { data: msgRow, error: msgErr } = await supabase
        .from("email_messages")
        .upsert(insertRow, { onConflict: "agency_id,gmail_message_id" })
        .select("id")
        .single();
      if (msgErr || !msgRow) {
        log.error("email_messages upsert failed", {
          gmail_message_id: ref.id,
          error: msgErr?.message,
        });
        continue;
      }
      out.push({
        emailMessageId: msgRow.id,
        threadId: thread.id,
        gmailThreadId: ref.threadId,
        parsed,
      });
    } catch (err) {
      // Log + continue so one bad message doesn't tank the whole batch.
      log.error("failed to fetch/persist message", {
        gmail_message_id: ref.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { persisted: out, bounceDetected, bounceMatched };
}

/**
 * Record a bounce/DSN and link it to the draft that was sent. The DSN names the
 * failed message's Message-ID (`parsed.failedMessageId`), which matches the
 * outbound `email_messages.message_id_header` we set on send; that outbound
 * row's gmail id matches `ai_drafts.sent_gmail_message_id`. Returns whether a
 * draft was matched + marked bounced. Failures are logged, never thrown.
 */
async function handleBounce(
  supabase: ServiceClient,
  agencyId: string,
  ref: { id: string; threadId: string },
  parsed: ParsedEmail,
  log: Logger,
): Promise<boolean> {
  const receivedIso = parsed.receivedAt.toISOString();

  // Thread for the bounce's own message (DSNs often arrive in a new thread).
  const { data: thread, error: threadErr } = await supabase
    .from("email_threads")
    .upsert(
      {
        agency_id: agencyId,
        gmail_thread_id: ref.threadId,
        subject: parsed.subject,
        last_message_at: receivedIso,
      },
      { onConflict: "agency_id,gmail_thread_id" },
    )
    .select("id")
    .single();
  if (threadErr || !thread) {
    log.error("bounce thread upsert failed", { error: threadErr?.message });
    return false;
  }

  // Find the outbound message that failed.
  let outbound: { id: string; gmail_message_id: string } | null = null;
  if (parsed.failedMessageId) {
    const { data } = await supabase
      .from("email_messages")
      .select("id, gmail_message_id")
      .eq("agency_id", agencyId)
      .eq("message_id_header", parsed.failedMessageId)
      .eq("direction", "outbound")
      .maybeSingle();
    outbound = data;
  }

  // Record the bounce itself (idempotent on (agency_id, gmail_message_id)).
  const { error: insErr } = await supabase.from("email_messages").upsert(
    {
      agency_id: agencyId,
      thread_id: thread.id,
      gmail_message_id: ref.id,
      direction: "inbound" as const,
      is_bounce: true,
      from_address: parsed.from,
      from_name: parsed.fromName ?? null,
      subject: parsed.subject,
      body_plain: parsed.bodyPlain,
      message_id_header: parsed.messageIdHeader,
      received_at: receivedIso,
      bounce_of_email_message_id: outbound?.id ?? null,
    },
    { onConflict: "agency_id,gmail_message_id" },
  );
  if (insErr) log.error("bounce email_messages upsert failed", { error: insErr.message });

  // Mark the originating draft bounced.
  let matched = false;
  if (outbound) {
    const detail = (parsed.subject ?? "Delivery failure").slice(0, 200);
    const { data: updated, error: updErr } = await supabase
      .from("ai_drafts")
      .update({ bounced_at: receivedIso, bounce_detail: detail })
      .eq("agency_id", agencyId)
      .eq("sent_gmail_message_id", outbound.gmail_message_id)
      .is("bounced_at", null) // idempotent: first bounce wins, redelivery won't overwrite
      .select("id");
    if (updErr) log.error("ai_drafts bounce update failed", { error: updErr.message });
    else matched = (updated?.length ?? 0) > 0;
  }

  await writeAuditLog(supabase, {
    agency_id: agencyId,
    actor_type: "system",
    action: "gmail.bounce.detected",
    metadata: {
      gmail_message_id: ref.id,
      failed_message_id: parsed.failedMessageId,
      matched,
    },
  } satisfies AuditLogEntry);

  log.info("bounce recorded", {
    agency_id: agencyId,
    failed_message_id: parsed.failedMessageId,
    matched,
  });
  return matched;
}
