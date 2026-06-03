import { Hono } from "hono";
import { z } from "zod";
import { AuthError, verifyDashboardJwt } from "../lib/auth";
import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import {
  createMaintenanceJob,
  draftTradieQuoteRequests,
  MaintenanceError,
} from "../services/maintenance";
import { createServiceClient } from "../services/supabase";

// ============================================================================
// POST /api/maintenance/jobs — PM-initiated maintenance job (Phase 3, spec §9)
// ============================================================================
// The dashboard's "Create maintenance job" calls this with the user's Supabase
// access token (Bearer) and the source MAINTENANCE draft id (+ optional trade).
// We create the job (triaged via the rules-engine s214 list) and, when a trade
// is supplied, draft tradie quote requests for the PM's review queue. Nothing
// auto-sends. Every query is agency-scoped (service-role bypasses RLS).
// ============================================================================

const bodySchema = z.object({
  sourceDraftId: z.string().min(1),
  trade: z.string().trim().min(1).optional(),
  issue: z.string().trim().min(1).optional(),
});

type Vars = { requestId: string };
export const maintenanceRoute = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

maintenanceRoute.post("/api/maintenance/jobs", async (c) => {
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
        log.warn("maintenance auth failed", { reason: err.reason });
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
      return c.json({ error: "sourceDraftId is required" }, 400);
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
    if (pm === null || !pm.active) {
      return c.json({ error: "no active agency user for caller" }, 403);
    }

    // ---- 4. Create the job ----
    let job: Awaited<ReturnType<typeof createMaintenanceJob>>;
    try {
      job = await createMaintenanceJob(
        supabase,
        {
          agencyId,
          draftId: parsed.data.sourceDraftId,
          createdByPmId: pm.id,
          issue: parsed.data.issue,
          trade: parsed.data.trade,
        },
        { logger: log },
      );
    } catch (err) {
      if (err instanceof MaintenanceError) {
        const status = err.code === "draft_not_found" ? 404 : 409;
        return c.json({ error: err.message }, status);
      }
      throw err;
    }

    // ---- 5. Draft tradie quote requests when a trade was supplied ----
    let quoteRequests: Awaited<ReturnType<typeof draftTradieQuoteRequests>> | undefined;
    if (parsed.data.trade) {
      try {
        quoteRequests = await draftTradieQuoteRequests(
          supabase,
          { agencyId, jobId: job.jobId, trade: parsed.data.trade, createdByPmId: pm.id },
          { logger: log },
        );
      } catch (err) {
        // The job is created; quote-drafting failing shouldn't lose the job.
        log.error("maintenance quote-request drafting failed (job kept)", {
          job_id: job.jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.info("maintenance job request handled", {
      job_id: job.jobId,
      classification: job.classification,
      already_existed: job.alreadyExisted,
      quote_requests_drafted: quoteRequests?.drafted ?? 0,
    });
    return c.json(
      {
        jobId: job.jobId,
        classification: job.classification,
        alreadyExisted: job.alreadyExisted,
        quoteRequests: quoteRequests ?? null,
      },
      job.alreadyExisted ? 200 : 201,
    );
  } catch (err) {
    log.error("maintenance route unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});
