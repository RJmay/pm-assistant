import { Hono } from "hono";
import { z } from "zod";
import { AuthError, verifyDashboardJwt } from "../lib/auth";
import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import { DocumentError, generateDocument } from "../services/documents";
import { createServiceClient } from "../services/supabase";

// ============================================================================
// POST /api/documents — generate a statutory document (Phase 4, spec §10)
// ============================================================================
// The dashboard calls this with the user's Supabase access token (Bearer) and
// the document type + tenancy + any commercial inputs (e.g. the new rent). The
// content is built deterministically from data + @pm/rules; we refuse with a
// 409 rather than emit a non-compliant document. Agency-scoped.
// ============================================================================

const bodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("entry_notice"),
    tenancyId: z.string().min(1),
    entryDate: z.string().optional(),
    entryWindow: z.string().optional(),
  }),
  z.object({
    type: z.literal("rent_increase_notice"),
    tenancyId: z.string().min(1),
    newRentCents: z.number().int().positive(),
    effectiveDate: z.string().optional(),
  }),
  z.object({
    type: z.literal("notice_to_remedy_breach"),
    tenancyId: z.string().min(1),
    amountOwedCents: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("notice_to_leave"),
    tenancyId: z.string().min(1),
    ground: z.enum(["unremedied_breach", "end_of_fixed_term"]),
  }),
]);

type Vars = { requestId: string };
export const documentsRoute = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

documentsRoute.post("/api/documents", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
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
        log.warn("documents auth failed", { reason: err.reason });
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
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "invalid document request" }, 400);
    }

    const supabase = createServiceClient(c.env);

    // ---- 3. Resolve caller -> active agency_users row ----
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
    if (!pm?.active) {
      return c.json({ error: "no active agency user for caller" }, 403);
    }

    // ---- 4. Generate ----
    try {
      const result = await generateDocument(
        supabase,
        { agencyId, createdByPmId: pm.id, ...parsed.data },
        { logger: log },
      );
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof DocumentError) {
        const status = err.code === "tenancy_not_found" ? 404 : 409;
        return c.json({ error: err.message, code: err.code }, status);
      }
      throw err;
    }
  } catch (err) {
    log.error("documents route unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});
