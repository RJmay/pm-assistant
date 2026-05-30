import { Hono } from "hono";
import { z } from "zod";
import { AuthError, verifyDashboardJwt } from "../lib/auth";
import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import { type AuditLogEntry, createServiceClient, writeAuditLog } from "../services/supabase";

// ============================================================================
// POST /api/regulatory-alerts/:id/review  — operator approve/dismiss (§12)
// ============================================================================
// regulatory_alerts is a GLOBAL (no-agency) reference table, so its writes are
// NOT exposed via a dashboard RLS update policy. Instead this Worker route
// performs the privileged write with the service-role client after verifying
// the caller's dashboard JWT and confirming they're an agency admin/principal.
// Reads stay on the RLS'd dashboard client (authenticated-read policy).
// Nothing here applies a change to live regulatory_rules — that stays a manual,
// versioned step; this only records the operator's review verdict.
// ============================================================================

const bodySchema = z.object({ action: z.enum(["approve", "dismiss"]) });
const ADMIN_ROLES = ["admin", "principal"];

type Vars = { requestId: string };
export const regulatoryReview = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

regulatoryReview.post("/api/regulatory-alerts/:id/review", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  const alertId = c.req.param("id");

  try {
    // ---- Auth ----
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
        log.warn("regulatory review auth failed", { reason: err.reason });
        return c.json({ error: err.reason }, err.status);
      }
      throw err;
    }

    // ---- Body ----
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "action must be 'approve' or 'dismiss'" }, 400);
    }

    const supabase = createServiceClient(c.env);

    // ---- Resolve caller + admin/principal gate ----
    const { data: pm, error: pmErr } = await supabase
      .from("agency_users")
      .select("id, role, active")
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
    if (!ADMIN_ROLES.includes(pm.role)) {
      return c.json({ error: "regulatory review is restricted to agency admins" }, 403);
    }

    // ---- Update the alert (global table; auth already gated to admins) ----
    const nowIso = new Date().toISOString();
    const newState = parsed.data.action === "approve" ? "approved" : "dismissed";
    const { data: updated, error: updErr } = await supabase
      .from("regulatory_alerts")
      .update({ operator_review_state: newState, reviewed_by: pm.id, reviewed_at: nowIso })
      .eq("id", alertId)
      .select("id");
    if (updErr) {
      log.error("regulatory_alerts update failed", { error: updErr.message });
      return c.json({ error: "internal" }, 500);
    }
    if (!updated || updated.length === 0) {
      return c.json({ error: "alert not found" }, 404);
    }

    await writeAuditLog(supabase, {
      agency_id: agencyId,
      actor_type: "user",
      actor_id: pm.id,
      action: `regulatory_alert.${newState}`,
      entity_type: "regulatory_alerts",
      entity_id: alertId,
      metadata: {},
    } satisfies AuditLogEntry);

    log.info("regulatory alert reviewed", { alert_id: alertId, state: newState });
    return c.json({ id: alertId, state: newState }, 200);
  } catch (err) {
    log.error("regulatory review unhandled error", {
      alert_id: alertId,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});
