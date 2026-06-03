import type { Client } from "@pm/db";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AuthError, verifyDashboardJwt } from "../lib/auth";
import type { WorkerBindings } from "../lib/env";
import type { Logger } from "../lib/log";
import { createLogger } from "../lib/log";
import {
  createMaintenanceJob,
  draftOwnerApprovalRequest,
  draftTradieQuoteRequests,
  MaintenanceError,
  recordOwnerDecision,
  recordQuote,
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

// ============================================================================
// Per-job actions (M3.2): record a quote, request owner approval, record decision
// ============================================================================

type Ctx = Context<{ Bindings: WorkerBindings; Variables: Vars }>;

interface Caller {
  supabase: Client;
  agencyId: string;
  pmId: string;
}

/** JWT → active agency user, or a Response to return as-is. */
async function resolveCaller(c: Ctx, log: Logger): Promise<Caller | Response> {
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  const tok = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : "";
  let authUserId: string;
  let agencyId: string;
  try {
    const id = await verifyDashboardJwt(tok, {
      jwtSecret: c.env.SUPABASE_JWT_SECRET,
      supabaseUrl: c.env.SUPABASE_URL,
    });
    authUserId = id.authUserId;
    agencyId = id.agencyId;
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: err.reason }, err.status);
    throw err;
  }
  const supabase = createServiceClient(c.env);
  const { data: pm, error } = await supabase
    .from("agency_users")
    .select("id, active")
    .eq("agency_id", agencyId)
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) {
    log.error("agency_users lookup failed", { error: error.message });
    return c.json({ error: "internal" }, 500);
  }
  if (!pm?.active) return c.json({ error: "no active agency user for caller" }, 403);
  return { supabase, agencyId, pmId: pm.id };
}

/** Map a MaintenanceError to its HTTP status, or null if it's not one. */
function mapMaintenanceError(c: Ctx, err: unknown): Response | null {
  if (!(err instanceof MaintenanceError)) return null;
  const notFound =
    err.code === "draft_not_found" ||
    err.code === "job_not_found" ||
    err.code === "quote_not_found";
  return c.json({ error: err.message }, notFound ? 404 : 409);
}

async function jsonBody(c: Ctx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

const recordQuoteBody = z.object({
  amountCents: z.number().int().nonnegative().optional(),
  status: z.enum(["requested", "received", "declined", "accepted"]).optional(),
});

maintenanceRoute.post("/api/maintenance/jobs/:id/quotes/:quoteId", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  try {
    const caller = await resolveCaller(c, log);
    if (caller instanceof Response) return caller;
    const parsed = recordQuoteBody.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    try {
      await recordQuote(
        caller.supabase,
        {
          agencyId: caller.agencyId,
          jobId: c.req.param("id"),
          quoteId: c.req.param("quoteId"),
          amountCents: parsed.data.amountCents,
          status: parsed.data.status,
          createdByPmId: caller.pmId,
        },
        { logger: log },
      );
    } catch (err) {
      const mapped = mapMaintenanceError(c, err);
      if (mapped) return mapped;
      throw err;
    }
    return c.json({ ok: true }, 200);
  } catch (err) {
    log.error("maintenance record-quote error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});

const approvalBody = z.object({ estimateCents: z.number().int().nonnegative().optional() });

maintenanceRoute.post("/api/maintenance/jobs/:id/owner-approval", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  try {
    const caller = await resolveCaller(c, log);
    if (caller instanceof Response) return caller;
    const parsed = approvalBody.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    try {
      const result = await draftOwnerApprovalRequest(
        caller.supabase,
        {
          agencyId: caller.agencyId,
          jobId: c.req.param("id"),
          estimateCents: parsed.data.estimateCents,
          createdByPmId: caller.pmId,
        },
        { logger: log },
      );
      return c.json(result, 201);
    } catch (err) {
      const mapped = mapMaintenanceError(c, err);
      if (mapped) return mapped;
      throw err;
    }
  } catch (err) {
    log.error("maintenance owner-approval error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});

const decisionBody = z.object({
  decision: z.enum(["approved", "declined"]),
  approvedSpendCents: z.number().int().nonnegative().optional(),
});

maintenanceRoute.post("/api/maintenance/jobs/:id/decision", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  try {
    const caller = await resolveCaller(c, log);
    if (caller instanceof Response) return caller;
    const parsed = decisionBody.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json({ error: "decision must be approved or declined" }, 400);
    try {
      await recordOwnerDecision(
        caller.supabase,
        {
          agencyId: caller.agencyId,
          jobId: c.req.param("id"),
          decision: parsed.data.decision,
          approvedSpendCents: parsed.data.approvedSpendCents,
          createdByPmId: caller.pmId,
        },
        { logger: log },
      );
    } catch (err) {
      const mapped = mapMaintenanceError(c, err);
      if (mapped) return mapped;
      throw err;
    }
    return c.json({ ok: true }, 200);
  } catch (err) {
    log.error("maintenance decision error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});
