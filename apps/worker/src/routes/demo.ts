import type { Json } from "@pm/db";
import { DEMO_ARREARS_DAYS, DEMO_ARREARS_TENANCY_ID } from "@pm/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AuthError, verifyDashboardJwt } from "../lib/auth";
import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import { runDraftPipeline } from "../services/draft-pipeline";
import { type AuditLogEntry, createServiceClient, writeAuditLog } from "../services/supabase";

// ============================================================================
// Demo-tenant controls: scenario injection + one-click reset.
// ============================================================================
// POST /api/demo/inject { scenarioKey } — fires a seeded scenario email through
//   the REAL ingestion + drafting pipeline (same email_threads/email_messages
//   shapes the Gmail webhook persists, then the same runDraftPipeline call —
//   real prompt, real matcher, real Claude call). Not a mocked render: the
//   prospect watches an actual draft materialise in the queue.
// POST /api/demo/reset — clears all demo-tenant ACTIVITY (drafts, emails,
//   threads, jobs, documents, notifications, audit), restores scenario
//   availability, and re-pins relative dates (arrears back to 9 days ago) so
//   the demo is pristine again in seconds. Structural changes to seeded
//   entities are restored by the CLI (`pnpm reset:demo`), not this endpoint.
// Both routes hard-require agencies.is_demo — they 403 on real tenants.
// ============================================================================

const injectBodySchema = z.object({ scenarioKey: z.string().min(1) });

type Vars = { requestId: string };
export const demoRoute = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

type DemoContext =
  | { ok: true; agencyId: string; supabase: ReturnType<typeof createServiceClient> }
  | { ok: false; response: Response };

/** Shared prologue: verify the dashboard JWT and assert the tenant is a demo. */
async function demoContext(
  c: Context<{ Bindings: WorkerBindings; Variables: Vars }>,
  log: ReturnType<typeof createLogger>,
): Promise<DemoContext> {
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  const token = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : "";
  let agencyId: string;
  try {
    const identity = await verifyDashboardJwt(token, {
      jwtSecret: c.env.SUPABASE_JWT_SECRET,
      supabaseUrl: c.env.SUPABASE_URL,
    });
    agencyId = identity.agencyId;
  } catch (err) {
    if (err instanceof AuthError) {
      log.warn("demo route auth failed", { reason: err.reason });
      return { ok: false, response: c.json({ error: err.reason }, err.status) };
    }
    throw err;
  }

  const supabase = createServiceClient(c.env);
  const { data: agency, error } = await supabase
    .from("agencies")
    .select("is_demo")
    .eq("id", agencyId)
    .maybeSingle();
  if (error) {
    log.error("demo route agency lookup failed", { error: error.message });
    return { ok: false, response: c.json({ error: "internal" }, 500) };
  }
  if (!agency?.is_demo) {
    return {
      ok: false,
      response: c.json({ error: "demo controls are only available on demo tenants" }, 403),
    };
  }
  return { ok: true, agencyId, supabase };
}

// ----------------------------------------------------------------------------
// POST /api/demo/inject
// ----------------------------------------------------------------------------

demoRoute.post("/api/demo/inject", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  try {
    const ctx = await demoContext(c, log);
    if (!ctx.ok) return ctx.response;
    const { agencyId, supabase } = ctx;

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const parsed = injectBodySchema.safeParse(rawBody);
    if (!parsed.success) return c.json({ error: "scenarioKey is required" }, 400);

    const { data: scenario, error: scErr } = await supabase
      .from("demo_scenarios")
      .select("id, key, title, from_name, from_address, subject, body")
      .eq("agency_id", agencyId)
      .eq("key", parsed.data.scenarioKey)
      .maybeSingle();
    if (scErr) {
      log.error("demo scenario lookup failed", { error: scErr.message });
      return c.json({ error: "internal" }, 500);
    }
    if (!scenario) return c.json({ error: "unknown scenario" }, 404);

    // ---- Persist the synthetic inbound (same shapes the Gmail webhook writes).
    // Every injection is a fresh thread so repeat runs don't pile into one.
    const nowIso = new Date().toISOString();
    const injectId = crypto.randomUUID();
    const { data: thread, error: threadErr } = await supabase
      .from("email_threads")
      .upsert(
        {
          agency_id: agencyId,
          gmail_thread_id: `demo-thread-${injectId}`,
          subject: scenario.subject,
          last_message_at: nowIso,
        },
        { onConflict: "agency_id,gmail_thread_id" },
      )
      .select("id")
      .maybeSingle();
    if (threadErr || !thread) {
      log.error("demo thread upsert failed", { error: threadErr?.message });
      return c.json({ error: "internal" }, 500);
    }

    const toAddress = "inbox@coastline-demo.example.com";
    const { data: message, error: msgErr } = await supabase
      .from("email_messages")
      .insert({
        agency_id: agencyId,
        thread_id: thread.id,
        gmail_message_id: `demo-inject-${injectId}`,
        direction: "inbound",
        from_address: scenario.from_address,
        from_name: scenario.from_name,
        to_addresses: [toAddress] as unknown as Json,
        subject: scenario.subject,
        body_plain: scenario.body,
        message_id_header: `<demo-inject-${injectId}@demo.sandbox>`,
        received_at: nowIso,
      })
      .select("id")
      .maybeSingle();
    if (msgErr || !message) {
      log.error("demo email_messages insert failed", { error: msgErr?.message });
      return c.json({ error: "internal" }, 500);
    }

    // ---- The REAL pipeline: prompt assembly, matching, Claude, compliance
    // floor, ai_drafts write, (sandboxed) owner alerts.
    const result = await runDraftPipeline(
      supabase,
      {
        agencyId,
        emailMessageId: message.id,
        threadId: thread.id,
        gmailThreadId: `demo-thread-${injectId}`,
        fromAddress: scenario.from_address,
        fromName: scenario.from_name,
        toAddresses: [toAddress],
        subject: scenario.subject,
        bodyPlain: scenario.body,
        bodyHtml: null,
        receivedAt: nowIso,
      },
      { anthropicApiKey: c.env.ANTHROPIC_API_KEY, env: c.env, logger: log },
    );

    if (result.kind !== "ok") {
      const detail = result.kind === "skipped" ? result.reason : result.error.message;
      log.error("demo inject pipeline did not produce a draft", { kind: result.kind, detail });
      return c.json({ error: `draft pipeline ${result.kind}: ${detail}` }, 502);
    }

    await supabase
      .from("demo_scenarios")
      .update({
        used_at: nowIso,
        last_email_message_id: message.id,
        last_draft_id: result.draftId,
      })
      .eq("agency_id", agencyId)
      .eq("id", scenario.id);

    await writeAuditLog(supabase, {
      agency_id: agencyId,
      actor_type: "system",
      action: "demo.scenario_injected",
      entity_type: "demo_scenarios",
      entity_id: scenario.id,
      metadata: { key: scenario.key, draft_id: result.draftId, email_message_id: message.id },
    } satisfies AuditLogEntry);

    log.info("demo scenario injected", { key: scenario.key, draft_id: result.draftId });
    return c.json(
      {
        ok: true,
        scenarioKey: scenario.key,
        emailMessageId: message.id,
        draftId: result.draftId,
        matchConfidence: result.matchConfidence,
      },
      200,
    );
  } catch (err) {
    log.error("demo inject unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});

// ----------------------------------------------------------------------------
// POST /api/demo/reset
// ----------------------------------------------------------------------------

demoRoute.post("/api/demo/reset", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  try {
    const ctx = await demoContext(c, log);
    if (!ctx.ok) return ctx.response;
    const { agencyId, supabase } = ctx;

    // Order respects FKs: notification_log references ai_drafts with NO
    // ACTION, so it must go first; model_calls likewise references drafts.
    // Everything else cascades or set-nulls (demo_scenarios' message/draft
    // refs are set-null by the deletes).
    const activityTables = [
      "notification_log",
      "model_calls",
      "maintenance_jobs",
      "draft_edits",
      "ai_drafts",
      "email_messages",
      "email_threads",
      "documents",
      "sms_messages",
      "sequence_runs",
      "weekly_digests",
      "audit_log",
    ] as const;
    for (const table of activityTables) {
      const { error } = await supabase.from(table).delete().eq("agency_id", agencyId);
      if (error) {
        log.error("demo reset delete failed", { table, error: error.message });
        return c.json({ error: `reset failed clearing ${table}` }, 500);
      }
    }

    // Scenario library back to unused.
    const { error: scErr } = await supabase
      .from("demo_scenarios")
      .update({ used_at: null, last_email_message_id: null, last_draft_id: null })
      .eq("agency_id", agencyId);
    if (scErr) {
      log.error("demo reset scenario restore failed", { error: scErr.message });
      return c.json({ error: "reset failed restoring scenarios" }, 500);
    }

    // Re-pin the arrears scenario's relative date: always 9 days behind today,
    // so the breach-notice timing in the drafted reply stays live-accurate.
    const arrearsSince = new Date(Date.now() + 10 * 3600_000 - DEMO_ARREARS_DAYS * 86400_000)
      .toISOString()
      .slice(0, 10);
    await supabase
      .from("tenancies")
      .update({ arrears_since: arrearsSince })
      .eq("agency_id", agencyId)
      .eq("id", DEMO_ARREARS_TENANCY_ID);

    await writeAuditLog(supabase, {
      agency_id: agencyId,
      actor_type: "system",
      action: "demo.reset",
      metadata: { tables_cleared: activityTables.length },
    } satisfies AuditLogEntry);

    log.info("demo tenant reset", { agency_id: agencyId });
    return c.json({ ok: true }, 200);
  } catch (err) {
    log.error("demo reset unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});
