import type { Json } from "@pm/db";
import { Hono } from "hono";
import { z } from "zod";
import { AuthError, verifyDashboardJwt, verifyDashboardJwtForProvisioning } from "../lib/auth";
import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import { runDraftPipeline } from "../services/draft-pipeline";
import { type AuditLogEntry, createServiceClient, writeAuditLog } from "../services/supabase";

// ============================================================================
// Onboarding wizard endpoints (real agencies, zero-IT signup path).
// ============================================================================
// POST /api/onboarding/provision — the only endpoint that accepts a JWT with
//   NO agency claim: a fresh magic-link signup calls it to create their agency
//   (agencies + agency_config + active prompt + agency_users[principal] +
//   onboarding_progress) and stamp app_metadata.agency_id via the admin API.
//   Idempotent: a caller that already has an agency gets it back unchanged.
// POST /api/onboarding/first-draft — the "first draft moment": creates a
//   clearly-marked sample tenancy (idempotent) and fires a hot-water sample
//   email through the REAL pipeline so a new agency sees a live AI draft in
//   their own queue within minutes of signup. Requires the nominated repairer
//   to be set (drafting refuses to run without it — RTRA s218 pathway).
// ============================================================================

const provisionBodySchema = z.object({
  agencyName: z.string().trim().min(2).max(120),
  suburb: z.string().trim().max(80).optional(),
  fullName: z.string().trim().max(120).optional(),
});

const SAMPLE_ADDRESS = "Sample: 1 Example Street";
const SAMPLE_TENANT_EMAIL = "sam.sample@example.com";

type Vars = { requestId: string };
export const onboardingRoute = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

function bearerToken(c: { req: { header: (n: string) => string | undefined } }): string {
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  return authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : "";
}

// ----------------------------------------------------------------------------
// POST /api/onboarding/provision
// ----------------------------------------------------------------------------

onboardingRoute.post("/api/onboarding/provision", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  try {
    let identity: Awaited<ReturnType<typeof verifyDashboardJwtForProvisioning>>;
    try {
      identity = await verifyDashboardJwtForProvisioning(bearerToken(c), {
        jwtSecret: c.env.SUPABASE_JWT_SECRET,
        supabaseUrl: c.env.SUPABASE_URL,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        log.warn("provision auth failed", { reason: err.reason });
        return c.json({ error: err.reason }, err.status);
      }
      throw err;
    }

    // Idempotent: already linked to an agency → nothing to provision.
    if (identity.agencyId) {
      return c.json({ ok: true, agencyId: identity.agencyId, alreadyProvisioned: true }, 200);
    }

    // Self-heal a partial earlier run: provisioning is several sequential
    // writes ending with the app_metadata stamp. If a previous attempt created
    // the agency_users row but died before stamping (admin API failure), the
    // JWT has no claim but the unique agency_users.auth_user_id row exists —
    // a blind re-insert would brick signup forever. Re-stamp and finish.
    const supabaseProbe = createServiceClient(c.env);
    const { data: existingLink } = await supabaseProbe
      .from("agency_users")
      .select("agency_id")
      .eq("auth_user_id", identity.authUserId)
      .maybeSingle();
    if (existingLink) {
      const { error: restampErr } = await supabaseProbe.auth.admin.updateUserById(
        identity.authUserId,
        { app_metadata: { agency_id: existingLink.agency_id } },
      );
      if (restampErr) {
        log.error("provision re-stamp failed", { error: restampErr.message });
        return c.json({ error: "could not link your login to your agency" }, 500);
      }
      log.info("provision self-healed a partial earlier run", {
        agency_id: existingLink.agency_id,
      });
      return c.json({ ok: true, agencyId: existingLink.agency_id, alreadyProvisioned: true }, 200);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const parsed = provisionBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "agencyName (2–120 chars) is required" }, 400);
    }
    const { agencyName, suburb, fullName } = parsed.data;

    const supabase = createServiceClient(c.env);
    const agencyId = crypto.randomUUID();

    // The drafting prompt's runtime source of truth is prompt_versions (the
    // worker never reads the .md at runtime) — copy the newest v2.4 content.
    const { data: promptSource } = await supabase
      .from("prompt_versions")
      .select("content")
      .eq("version", "2.4")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!promptSource) {
      log.error("provision: no v2.4 prompt_versions row exists to copy");
      return c.json({ error: "platform prompt is not initialised — contact support" }, 503);
    }

    const { error: agencyErr } = await supabase.from("agencies").insert({
      id: agencyId,
      name: agencyName,
      suburb: suburb ?? null,
      is_demo: false,
    });
    if (agencyErr) {
      log.error("provision agencies insert failed", { error: agencyErr.message });
      return c.json({ error: "internal" }, 500);
    }

    const { data: promptRow, error: promptErr } = await supabase
      .from("prompt_versions")
      .insert({
        agency_id: agencyId,
        version: "2.4",
        content: promptSource.content,
        notes: "onboarding wizard: activated drafting prompt v2.4",
      })
      .select("id")
      .maybeSingle();
    if (promptErr || !promptRow) {
      log.error("provision prompt insert failed", { error: promptErr?.message });
      return c.json({ error: "internal" }, 500);
    }

    const { error: configErr } = await supabase.from("agency_config").insert({
      agency_id: agencyId,
      voice_samples: [] as unknown as Json,
      approved_tradies: [] as unknown as Json,
      nominated_repairer: null,
      active_prompt_version_id: promptRow.id,
    });
    if (configErr) {
      log.error("provision agency_config insert failed", { error: configErr.message });
      return c.json({ error: "internal" }, 500);
    }

    const email = identity.email ?? `${identity.authUserId}@signup.unknown`;
    const { error: userErr } = await supabase.from("agency_users").insert({
      agency_id: agencyId,
      auth_user_id: identity.authUserId,
      email,
      full_name: fullName?.trim() || email,
      role: "principal",
      active: true,
    });
    if (userErr) {
      log.error("provision agency_users insert failed", { error: userErr.message });
      return c.json({ error: "internal" }, 500);
    }

    const { error: progressErr } = await supabase.from("onboarding_progress").insert({
      agency_id: agencyId,
      current_step: "connect-email",
      completed_steps: ["account"] as unknown as Json,
    });
    if (progressErr) {
      log.warn("provision onboarding_progress insert failed", { error: progressErr.message });
    }

    // Stamp the tenant claim — the client refreshes its session to pick it up.
    const { error: adminErr } = await supabase.auth.admin.updateUserById(identity.authUserId, {
      app_metadata: { agency_id: agencyId },
    });
    if (adminErr) {
      log.error("provision app_metadata update failed", { error: adminErr.message });
      return c.json({ error: "could not link your login to the new agency" }, 500);
    }

    await writeAuditLog(supabase, {
      agency_id: agencyId,
      actor_type: "system",
      action: "onboarding.provisioned",
      metadata: { agency_name: agencyName, auth_user_id: identity.authUserId },
    } satisfies AuditLogEntry);

    log.info("agency provisioned via onboarding", { agency_id: agencyId });
    return c.json({ ok: true, agencyId }, 200);
  } catch (err) {
    log.error("provision unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});

// ----------------------------------------------------------------------------
// POST /api/onboarding/first-draft
// ----------------------------------------------------------------------------

onboardingRoute.post("/api/onboarding/first-draft", async (c) => {
  const log = createLogger({ base: { request_id: c.get("requestId") } });
  try {
    let agencyId: string;
    try {
      const identity = await verifyDashboardJwt(bearerToken(c), {
        jwtSecret: c.env.SUPABASE_JWT_SECRET,
        supabaseUrl: c.env.SUPABASE_URL,
      });
      agencyId = identity.agencyId;
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json({ error: err.reason }, err.status);
      }
      throw err;
    }

    const supabase = createServiceClient(c.env);

    // Drafting hard-requires a nominated repairer (s218); fail with guidance
    // rather than a cryptic pipeline error.
    const { data: config } = await supabase
      .from("agency_config")
      .select("nominated_repairer")
      .eq("agency_id", agencyId)
      .maybeSingle();
    if (!config?.nominated_repairer) {
      return c.json(
        { error: "set your nominated repairer in the Voice & guardrails step first" },
        409,
      );
    }

    // ---- Idempotent sample entities (clearly marked, easy to delete) ----
    let { data: property } = await supabase
      .from("properties")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("address_line1", SAMPLE_ADDRESS)
      .maybeSingle();
    if (!property) {
      const { data: owner, error: ownerErr } = await supabase
        .from("owners")
        .insert({
          agency_id: agencyId,
          full_name: "Sample Owner",
          email: "sample.owner@example.com",
          notes: "Created by the onboarding wizard — safe to delete.",
        })
        .select("id")
        .maybeSingle();
      if (ownerErr || !owner) {
        log.error("first-draft owner insert failed", { error: ownerErr?.message });
        return c.json({ error: "internal" }, 500);
      }
      const { data: created, error: propErr } = await supabase
        .from("properties")
        .insert({
          agency_id: agencyId,
          owner_id: owner.id,
          address_line1: SAMPLE_ADDRESS,
          suburb: "Maroochydore",
          postcode: "4558",
          state: "QLD",
          notes: "Created by the onboarding wizard — safe to delete.",
        })
        .select("id")
        .maybeSingle();
      if (propErr || !created) {
        log.error("first-draft property insert failed", { error: propErr?.message });
        return c.json({ error: "internal" }, 500);
      }
      property = created;
      const { data: tenancy, error: tenancyErr } = await supabase
        .from("tenancies")
        .insert({
          agency_id: agencyId,
          property_id: created.id,
          status: "active",
          rent_amount_cents: 65000,
          rent_frequency: "weekly",
          agreement_type: "periodic",
        })
        .select("id")
        .maybeSingle();
      if (tenancyErr || !tenancy) {
        log.error("first-draft tenancy insert failed", { error: tenancyErr?.message });
        return c.json({ error: "internal" }, 500);
      }
      const { error: tenantErr } = await supabase.from("tenants").insert({
        agency_id: agencyId,
        tenancy_id: tenancy.id,
        full_name: "Sam Sample",
        email: SAMPLE_TENANT_EMAIL,
        is_primary: true,
      });
      if (tenantErr) {
        log.error("first-draft tenant insert failed", { error: tenantErr.message });
        return c.json({ error: "internal" }, 500);
      }
    }

    // ---- Synthesize the sample inbound + run the REAL pipeline ----
    const nowIso = new Date().toISOString();
    const injectId = crypto.randomUUID();
    const subject = "No hot water at Sample: 1 Example Street";
    const body = `Hi,\n\nWe've got no hot water at all at ${SAMPLE_ADDRESS} — it stopped working last night and this morning it's still freezing cold. We've checked the fuse box and nothing's tripped.\n\nCould someone please come out as soon as possible?\n\nThanks,\nSam Sample\n\n(This is a sample email created by the onboarding wizard — nothing was really received.)`;

    const { data: thread, error: threadErr } = await supabase
      .from("email_threads")
      .upsert(
        {
          agency_id: agencyId,
          gmail_thread_id: `sample-thread-${injectId}`,
          subject,
          last_message_at: nowIso,
        },
        { onConflict: "agency_id,gmail_thread_id" },
      )
      .select("id")
      .maybeSingle();
    if (threadErr || !thread) {
      log.error("first-draft thread upsert failed", { error: threadErr?.message });
      return c.json({ error: "internal" }, 500);
    }
    const { data: message, error: msgErr } = await supabase
      .from("email_messages")
      .insert({
        agency_id: agencyId,
        thread_id: thread.id,
        gmail_message_id: `sample-inject-${injectId}`,
        direction: "inbound",
        from_address: SAMPLE_TENANT_EMAIL,
        from_name: "Sam Sample",
        to_addresses: ["onboarding@sample.invalid"] as unknown as Json,
        subject,
        body_plain: body,
        message_id_header: `<sample-inject-${injectId}@sample.invalid>`,
        received_at: nowIso,
      })
      .select("id")
      .maybeSingle();
    if (msgErr || !message) {
      log.error("first-draft email insert failed", { error: msgErr?.message });
      return c.json({ error: "internal" }, 500);
    }

    const result = await runDraftPipeline(
      supabase,
      {
        agencyId,
        emailMessageId: message.id,
        threadId: thread.id,
        gmailThreadId: `sample-thread-${injectId}`,
        fromAddress: SAMPLE_TENANT_EMAIL,
        fromName: "Sam Sample",
        toAddresses: ["onboarding@sample.invalid"],
        subject,
        bodyPlain: body,
        bodyHtml: null,
        receivedAt: nowIso,
      },
      { anthropicApiKey: c.env.ANTHROPIC_API_KEY, env: c.env, logger: log },
    );
    if (result.kind !== "ok") {
      const detail = result.kind === "skipped" ? result.reason : result.error.message;
      log.error("first-draft pipeline failed", { kind: result.kind, detail });
      return c.json({ error: `draft pipeline ${result.kind}: ${detail}` }, 502);
    }

    await writeAuditLog(supabase, {
      agency_id: agencyId,
      actor_type: "system",
      action: "onboarding.first_draft",
      entity_type: "ai_drafts",
      entity_id: result.draftId,
      metadata: { email_message_id: message.id },
    } satisfies AuditLogEntry);

    log.info("onboarding first draft created", { agency_id: agencyId, draft_id: result.draftId });
    return c.json({ ok: true, draftId: result.draftId }, 200);
  } catch (err) {
    log.error("first-draft unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal", request_id: c.get("requestId") }, 500);
  }
});
