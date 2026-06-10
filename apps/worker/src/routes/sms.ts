import { Hono } from "hono";
import { z } from "zod";
import { AuthError, verifyDashboardJwt } from "../lib/auth";
import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import { processInboundSms, SmsError, sendSmsReply } from "../services/sms";
import { createServiceClient } from "../services/supabase";
import { SmsVerificationError, verifyTwilioSignature } from "../services/twilio-inbound";

// ============================================================================
// SMS routes (Phase 5, spec §11)
// ============================================================================
//  - POST /webhook/sms/:agencyId  — Twilio inbound (signature-verified). The
//    agency is in the path so each agency points its number's webhook at its
//    own URL; no auto-reply (returns empty TwiML). A reply is DRAFTED only.
//  - POST /api/sms/:id/send       — the PM approves + sends a drafted reply.
// ============================================================================

type Vars = { requestId: string };
export const smsRoute = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

smsRoute.post("/webhook/sms/:agencyId", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  const agencyId = c.req.param("agencyId");
  try {
    // Twilio sends application/x-www-form-urlencoded; collect every field for
    // signature verification.
    const form = await c.req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

    let valid = false;
    try {
      valid = await verifyTwilioSignature({
        authToken: c.env.TWILIO_AUTH_TOKEN,
        url: c.req.url,
        params,
        signature: c.req.header("X-Twilio-Signature") ?? "",
      });
    } catch (err) {
      if (err instanceof SmsVerificationError) {
        log.warn("sms webhook signature missing", { reason: err.reason });
        return c.json({ error: "forbidden" }, 403);
      }
      throw err;
    }
    if (!valid) {
      log.warn("sms webhook signature invalid", { agency_id: agencyId });
      return c.json({ error: "forbidden" }, 403);
    }

    const from = params.From ?? "";
    const to = params.To ?? "";
    const body = params.Body ?? "";
    if (!from || !to || !body) {
      return c.text(EMPTY_TWIML, 200, { "Content-Type": "text/xml" });
    }

    // DEMO SANDBOX — never accept real inbound SMS for a demo tenant (a
    // misconfigured Twilio webhook pointed at the well-known demo agency id
    // would otherwise fill the demo queue with real phone numbers).
    const { data: agencyRow } = await createServiceClient(c.env)
      .from("agencies")
      .select("is_demo")
      .eq("id", agencyId)
      .maybeSingle();
    if (agencyRow?.is_demo) {
      log.warn("sms webhook ignored: demo tenants accept no real inbound SMS", {
        agency_id: agencyId,
      });
      return c.text(EMPTY_TWIML, 200, { "Content-Type": "text/xml" });
    }

    try {
      const result = await processInboundSms(
        createServiceClient(c.env),
        { agencyId, fromNumber: from, toNumber: to, body, providerSid: params.MessageSid },
        { logger: log },
      );
      log.info("sms webhook handled", { sms_id: result.smsId, status: result.status });
    } catch (err) {
      // Don't make Twilio retry on our internal failure — log + 200 (empty).
      log.error("sms webhook processing failed", {
        agency_id: agencyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Empty TwiML → Twilio sends no automatic reply (the PM replies).
    return c.text(EMPTY_TWIML, 200, { "Content-Type": "text/xml" });
  } catch (err) {
    log.error("sms webhook unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.text(EMPTY_TWIML, 200, { "Content-Type": "text/xml" });
  }
});

const sendBody = z.object({ body: z.string().trim().min(1) });

smsRoute.post("/api/sms/:id/send", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  try {
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
      if (err instanceof AuthError) return c.json({ error: err.reason }, err.status);
      throw err;
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const parsed = sendBody.safeParse(rawBody);
    if (!parsed.success) return c.json({ error: "a non-empty body is required" }, 400);

    const supabase = createServiceClient(c.env);
    const { data: pm, error: pmErr } = await supabase
      .from("agency_users")
      .select("id, active")
      .eq("agency_id", agencyId)
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (pmErr) {
      log.error("agency_users lookup failed", { error: pmErr.message });
      return c.json({ error: "internal" }, 500);
    }
    if (!pm?.active) return c.json({ error: "no active agency user for caller" }, 403);

    try {
      const result = await sendSmsReply(
        supabase,
        c.env,
        { agencyId, smsId: c.req.param("id"), body: parsed.data.body, sentByPmId: pm.id },
        { logger: log },
      );
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof SmsError) {
        return c.json({ error: err.message }, err.code === "not_found" ? 404 : 409);
      }
      throw err;
    }
  } catch (err) {
    log.error("sms send route unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});
