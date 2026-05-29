import type { Json } from "@pm/db";
import { GmailApiError } from "@pm/shared";
import { Hono } from "hono";
import { z } from "zod";
import { AuthError, verifyDashboardJwt } from "../lib/auth";
import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import { usersMessagesSend } from "../services/gmail";
import { buildRawMessage } from "../services/mime";
import { resolveSendIdentity } from "../services/send-identity";
import { type AuditLogEntry, createServiceClient, writeAuditLog } from "../services/supabase";

// ============================================================================
// POST /api/drafts/:id/send  — approve & send a draft reply (M9)
// ============================================================================
// The dashboard's "Approve & Send" calls this with the user's Supabase access
// token (Bearer) and the (possibly edited) { subject, body }. We:
//   1. verify the JWT -> { authUserId, agencyId }
//   2. resolve the caller to an active agency_users row
//   3. load the draft (agency-scoped); 404 if missing
//   4. authorise: assigned PM, or unassigned
//   5. guard state: only pending/edited can be sent
//   6. capture a draft_edits row if the body/subject changed on send
//   7. send in-thread via the AGENCY mailbox (see services/send-identity.ts)
//   8. persist the outbound email_messages row BEFORE flipping status (so a
//      bounce can always link back), then mark the draft sent + audit-log.
// Every query is explicitly scoped by agencyId because the service-role client
// bypasses RLS.
// ============================================================================

const sendBodySchema = z.object({
  subject: z.string(),
  body: z.string(),
});

type Vars = { requestId: string };
export const sendRoute = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

sendRoute.post("/api/drafts/:id/send", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  const draftId = c.req.param("id");

  try {
    // ---- 1. Verify the dashboard JWT ----
    const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
    const token = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice("bearer ".length).trim()
      : "";
    let authUserId: string;
    let agencyId: string;
    try {
      const identity = await verifyDashboardJwt(token, {
        jwtSecret: c.env.SUPABASE_JWT_SECRET,
        supabaseUrl: c.env.SUPABASE_URL,
      });
      authUserId = identity.authUserId;
      agencyId = identity.agencyId;
    } catch (err) {
      if (err instanceof AuthError) {
        log.warn("send auth failed", { reason: err.reason });
        return c.json({ error: err.reason }, err.status);
      }
      throw err;
    }

    // ---- 2. Parse body ----
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const parsedBody = sendBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json({ error: "subject and body are required" }, 400);
    }
    const finalSubject = parsedBody.data.subject;
    const finalBody = parsedBody.data.body;

    const supabase = createServiceClient(c.env);

    // ---- 3. Resolve caller -> active agency_users row ----
    const { data: pm, error: pmErr } = await supabase
      .from("agency_users")
      .select("id, full_name, active")
      .eq("agency_id", agencyId)
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (pmErr) {
      log.error("agency_users lookup failed", { error: pmErr.message });
      return c.json({ error: "internal" }, 500);
    }
    if (pm === null || !pm.active) {
      return c.json({ error: "no active agency user for caller" }, 403);
    }

    // ---- 4. Load draft (agency-scoped) ----
    const { data: draft, error: draftErr } = await supabase
      .from("ai_drafts")
      .select(
        "id, email_message_id, draft_subject, draft_body, status, assigned_pm_id, do_not_send",
      )
      .eq("agency_id", agencyId)
      .eq("id", draftId)
      .maybeSingle();
    if (draftErr) {
      log.error("ai_drafts lookup failed", { error: draftErr.message });
      return c.json({ error: "internal" }, 500);
    }
    if (!draft) {
      return c.json({ error: "draft not found" }, 404);
    }

    // ---- 5. Authorise: assigned PM, or unassigned ----
    if (draft.assigned_pm_id !== null && draft.assigned_pm_id !== pm.id) {
      return c.json({ error: "draft is assigned to another property manager" }, 403);
    }

    // ---- 6. State guard ----
    if (draft.status !== "pending" && draft.status !== "edited") {
      return c.json({ error: `draft cannot be sent from status '${draft.status}'` }, 409);
    }

    // ---- 6b. do_not_send enforcement (HARD GATE, before any send) ----
    // The drafter/compliance-floor sets do_not_send for unsafe/low-confidence
    // drafts (incl. welfare cases). This is read from the persisted row and
    // checked synchronously BEFORE the Gmail call, so a fast send can never
    // bypass it. The flag is cleared by editing the draft (see saveEdit).
    if (draft.do_not_send) {
      log.warn("send blocked: draft is flagged do_not_send", { draft_id: draft.id });
      return c.json(
        { error: "draft is flagged do-not-send; edit it (which clears the flag) before sending" },
        409,
      );
    }

    // ---- 7. Load inbound message (threading + recipient) ----
    const { data: inbound, error: inErr } = await supabase
      .from("email_messages")
      .select("thread_id, from_address, message_id_header, references_headers")
      .eq("agency_id", agencyId)
      .eq("id", draft.email_message_id)
      .maybeSingle();
    if (inErr) {
      log.error("inbound email_messages lookup failed", { error: inErr.message });
      return c.json({ error: "internal" }, 500);
    }
    if (!inbound) {
      return c.json({ error: "inbound message not found" }, 404);
    }

    // ---- 8. Sending mailbox + agency name + thread gmail id ----
    const [{ data: agency }, { data: state }, { data: thread }] = await Promise.all([
      supabase.from("agencies").select("name").eq("id", agencyId).maybeSingle(),
      supabase
        .from("agency_email_state")
        .select("mailbox_address")
        .eq("agency_id", agencyId)
        .maybeSingle(),
      supabase
        .from("email_threads")
        .select("gmail_thread_id")
        .eq("agency_id", agencyId)
        .eq("id", inbound.thread_id)
        .maybeSingle(),
    ]);
    if (!state?.mailbox_address) {
      return c.json({ error: "agency mailbox is not configured" }, 409);
    }

    // ---- 9. Capture a draft_edits row if the content changed on send ----
    if (finalSubject !== (draft.draft_subject ?? "") || finalBody !== (draft.draft_body ?? "")) {
      const { error: editErr } = await supabase.from("draft_edits").insert({
        agency_id: agencyId,
        draft_id: draft.id,
        edited_by: pm.id,
        previous_subject: draft.draft_subject,
        new_subject: finalSubject,
        previous_body: draft.draft_body,
        new_body: finalBody,
      });
      if (editErr) log.warn("draft_edits insert failed", { error: editErr.message });
    }

    // ---- 10. Resolve send identity (agency mailbox token) ----
    let identity: Awaited<ReturnType<typeof resolveSendIdentity>>;
    try {
      identity = await resolveSendIdentity(supabase, c.env, {
        agencyId,
        pmFullName: pm.full_name,
        agencyName: agency?.name ?? "",
        mailboxAddress: state.mailbox_address,
      });
    } catch (err) {
      log.error("resolveSendIdentity failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ error: "could not resolve the sending mailbox" }, 502);
    }

    // ---- 11. Build the raw RFC 5322 message ----
    const recipient = inbound.from_address;
    const references = [...(inbound.references_headers ?? [])];
    if (inbound.message_id_header && !references.includes(inbound.message_id_header)) {
      references.push(inbound.message_id_header);
    }
    const domain = state.mailbox_address.split("@")[1] ?? "pm-assistant.local";
    const built = buildRawMessage({
      fromAddress: identity.fromAddress,
      fromDisplayName: identity.fromDisplayName,
      to: [recipient],
      subject: finalSubject,
      bodyText: finalBody,
      inReplyTo: inbound.message_id_header,
      references,
      messageId: `<${crypto.randomUUID()}@${domain}>`,
      date: new Date(),
    });

    // ---- 12. Send via Gmail (in-thread) ----
    let sent: Awaited<ReturnType<typeof usersMessagesSend>>;
    try {
      const sendOpts: { accessToken: string; raw: string; threadId?: string } = {
        accessToken: identity.accessToken,
        raw: built.raw,
      };
      if (thread?.gmail_thread_id) sendOpts.threadId = thread.gmail_thread_id;
      sent = await usersMessagesSend(sendOpts);
    } catch (err) {
      // Send failed => the draft is NOT marked sent (fail-safe). The PM can retry.
      const status = err instanceof GmailApiError ? err.statusCode : undefined;
      log.error("gmail send failed", {
        draft_id: draft.id,
        status,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ error: "the email could not be sent" }, 502);
    }

    // ---- 13. Persist outbound message BEFORE flipping status (bounce linkage) ----
    const nowIso = new Date().toISOString();
    const { error: outErr } = await supabase.from("email_messages").insert({
      agency_id: agencyId,
      thread_id: inbound.thread_id,
      gmail_message_id: sent.id,
      direction: "outbound",
      from_address: identity.fromAddress,
      from_name: identity.fromDisplayName,
      to_addresses: [recipient] as unknown as Json,
      subject: finalSubject,
      body_plain: finalBody,
      message_id_header: built.messageId,
      in_reply_to: inbound.message_id_header,
      references_headers: references,
      sent_at: nowIso,
    });
    if (outErr) {
      // The message WAS sent; we just failed to record it. Log loudly and carry
      // on to mark the draft sent so the PM doesn't double-send.
      log.error("outbound email_messages insert failed (message already sent)", {
        draft_id: draft.id,
        gmail_message_id: sent.id,
        error: outErr.message,
      });
    }

    // ---- 14. Mark the draft sent (claim it if it was unassigned) ----
    const draftUpdate: {
      status: "sent";
      sent_at: string;
      sent_gmail_message_id: string;
      assigned_pm_id?: string;
    } = { status: "sent", sent_at: nowIso, sent_gmail_message_id: sent.id };
    if (draft.assigned_pm_id === null) draftUpdate.assigned_pm_id = pm.id;
    // Optimistic lock: only flip if the draft is still pending/edited, so a draft
    // concurrently discarded/sent between the state guard and here is not
    // resurrected as 'sent'.
    const { data: flipped, error: updErr } = await supabase
      .from("ai_drafts")
      .update(draftUpdate)
      .eq("agency_id", agencyId)
      .eq("id", draft.id)
      .in("status", ["pending", "edited"])
      .select("id");
    if (updErr) {
      log.error("ai_drafts status update failed (message already sent)", {
        draft_id: draft.id,
        error: updErr.message,
      });
    } else if ((flipped?.length ?? 0) === 0) {
      // The email already went out; we just couldn't claim the status because the
      // draft changed concurrently. Surface it rather than overwrite.
      log.warn("draft status not flipped: changed concurrently since the state guard", {
        draft_id: draft.id,
      });
    }

    // ---- 15. Audit ----
    await writeAuditLog(supabase, {
      agency_id: agencyId,
      actor_type: "user",
      actor_id: pm.id,
      action: "draft.sent",
      entity_type: "ai_drafts",
      entity_id: draft.id,
      metadata: {
        gmail_message_id: sent.id,
        gmail_thread_id: thread?.gmail_thread_id ?? null,
        message_id_header: built.messageId,
        to: recipient,
        from: identity.fromAddress,
      },
    } satisfies AuditLogEntry);

    log.info("draft sent", {
      draft_id: draft.id,
      agency_id: agencyId,
      gmail_message_id: sent.id,
    });
    return c.json({ id: draft.id, sentAt: nowIso, gmailMessageId: sent.id }, 200);
  } catch (err) {
    // Boundary guarantee (CLAUDE.md): never throw unhandled; return a typed 500
    // with a request id and never leak a stack trace to the caller.
    log.error("send route unhandled error", {
      draft_id: draftId,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});
