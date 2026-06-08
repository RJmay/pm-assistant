import type { Client, Json } from "@pm/db";
import {
  type AssembleInput,
  assemble,
  type DrafterModel,
  type DraftSubmission,
  type InboundEmail,
  type LeanNote,
  MissingNominatedRepairerError,
  type Pm,
  draft as runDrafter,
} from "@pm/prompts";
import type { WorkerBindings } from "../lib/env";
import type { Logger } from "../lib/log";
import { applyComplianceFloor } from "./compliance-floor";
import { type MatchConfidence, type MatcherInput, type MatchSource, matchEmail } from "./matcher";
import { dispatchOwnerNotification, type NotifyResult } from "./notifier";
import { writeAuditLog } from "./supabase";

/**
 * Single-message orchestrator: matcher → assemble → drafter → persist →
 * (optional) owner notification.
 *
 * Called from the Gmail webhook for each newly-persisted inbound message.
 * Per-message failures are surfaced via the returned discriminated union so
 * the caller can log + continue without crashing the whole batch.
 *
 * Side effects (in order):
 *   1. May update `email_threads.property_id` + `.property_match_confidence`
 *      when the matcher's confidence is ≥ medium and the thread doesn't
 *      already have a stronger link.
 *   2. Inserts one `ai_drafts` row (unique on `email_message_id`).
 *   3. Inserts one `model_calls` row capturing the Anthropic exchange.
 *   4. Writes one `audit_log` row with action `draft.created`.
 *   5. When `submission.emergency_landlord_alert` is true, dispatches owner
 *      notifications via `services/notifier`. Failures are logged but
 *      swallowed — the draft is already persisted, alerts being late is
 *      better than the draft being lost.
 */

export const DEFAULT_DRAFTER_MODEL: DrafterModel = "claude-sonnet-4-6";

export interface DraftPipelineInput {
  agencyId: string;
  emailMessageId: string;
  threadId: string;
  gmailThreadId: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  subject: string | null;
  bodyPlain: string | null;
  bodyHtml: string | null;
  receivedAt: string;
}

export interface DraftPipelineDeps {
  /** Anthropic API key — passed to the drafter; not stored. */
  anthropicApiKey: string;
  /** Full Worker env — required so the notifier can read Twilio/Resend creds. */
  env: WorkerBindings;
  /** Override for the model — defaults to claude-sonnet-4-6 (see ARCHITECTURE). */
  model?: DrafterModel;
  logger: Logger;
  /** Test seam — defaults to runDrafter from @pm/prompts. */
  drafter?: typeof runDrafter;
  /** Test seam — defaults to matchEmail. */
  matcher?: typeof matchEmail;
  /** Test seam — defaults to dispatchOwnerNotification. */
  notifier?: typeof dispatchOwnerNotification;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export type DraftPipelineResult =
  | {
      kind: "ok";
      draftId: string;
      matchConfidence: MatchConfidence;
      matchedVia: MatchSource;
      notifier?: NotifyResult;
    }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; error: Error };

export async function runDraftPipeline(
  client: Client,
  input: DraftPipelineInput,
  deps: DraftPipelineDeps,
): Promise<DraftPipelineResult> {
  const log = deps.logger.child({
    agency_id: input.agencyId,
    email_message_id: input.emailMessageId,
  });
  const now = deps.now ?? (() => new Date());
  const drafterFn = deps.drafter ?? runDrafter;
  const matcherFn = deps.matcher ?? matchEmail;
  const notifierFn = deps.notifier ?? dispatchOwnerNotification;
  const model = deps.model ?? DEFAULT_DRAFTER_MODEL;

  try {
    // ---- 1. Matcher ------------------------------------------------------
    const matcherInput: MatcherInput = {
      agencyId: input.agencyId,
      fromAddress: input.fromAddress,
      subject: input.subject,
      bodyPreview: input.bodyPlain,
      gmailThreadId: input.gmailThreadId,
    };
    const match = await matcherFn(client, matcherInput);
    log.info("matcher result", {
      match_confidence: match.confidence,
      matched_via: match.source,
      property_id: match.propertyId,
    });

    // Update email_threads with the matcher's verdict when it improves on
    // what's already there (don't laundering down a high-confidence link).
    await maybeUpdateThreadProperty(client, input, match);

    // ---- 2. Load agency + config + active prompt + PMs -------------------
    const ctx = await loadAgencyContext(client, input.agencyId);
    if (ctx.kind === "skipped") {
      log.warn("draft pipeline skipped", { reason: ctx.reason });
      return { kind: "skipped", reason: ctx.reason };
    }

    // ---- 3. Assemble system prompt ---------------------------------------
    let systemPrompt: string;
    try {
      // Single-PM agencies: pre-fill the signoff name so the draft is send-ready.
      // Multi-PM (or none): leave [PM_NAME] literal for the reviewing PM to set.
      const solePm = ctx.pms.length === 1 ? ctx.pms[0] : undefined;
      systemPrompt = assemble({
        basePrompt: ctx.promptContent,
        now: now(),
        agency: ctx.agency,
        agencyConfig: ctx.agencyConfig,
        pms: ctx.pms,
        runtimeContext: solePm ? { pmName: solePm.name } : undefined,
      } satisfies AssembleInput);
    } catch (err) {
      if (err instanceof MissingNominatedRepairerError) {
        log.error("draft pipeline aborted: nominated repairer missing", {
          agency_id: input.agencyId,
        });
        return { kind: "skipped", reason: "missing_nominated_repairer" };
      }
      throw err;
    }

    // ---- 4. Drafter ------------------------------------------------------
    const inboundEmail: InboundEmail = {
      from: input.fromName ? `${input.fromName} <${input.fromAddress}>` : input.fromAddress,
      to: input.toAddresses.join(", "),
      subject: input.subject ?? "(no subject)",
      body: input.bodyPlain ?? input.bodyHtml ?? "(empty body)",
      receivedAt: input.receivedAt,
    };
    const startedAt = Date.now();
    const submission = await drafterFn(
      { systemPrompt, inboundEmail, model },
      { apiKey: deps.anthropicApiKey },
    );
    const durationMs = Date.now() - startedAt;

    // ---- 4b. Deterministic compliance floor (escalation safety-net + s214) --
    // Raises a floor under the LLM output; never downgrades it. The ORIGINAL
    // submission is still recorded raw in model_calls + ai_drafts.raw_response.
    const inboundText = `${input.subject ?? ""}\n\n${input.bodyPlain ?? input.bodyHtml ?? ""}`;
    const { submission: finalSubmission, adjustments: floorAdjustments } = applyComplianceFloor(
      submission,
      inboundText,
      input.receivedAt.slice(0, 10),
    );
    if (floorAdjustments.length > 0) {
      log.info("compliance floor applied", { adjustments: floorAdjustments });
    }

    // ---- 5. Persist ai_drafts -------------------------------------------
    const draftId = await insertDraft(
      client,
      input,
      match,
      finalSubmission,
      ctx.promptVersionId,
      model,
      submission,
    );

    // ---- 6. Persist model_calls -----------------------------------------
    await insertModelCall(
      client,
      input,
      draftId,
      ctx.promptVersionId,
      model,
      inboundEmail,
      submission,
      durationMs,
    );

    // ---- 7. Owner notification (only on emergency_landlord_alert) -------
    let notifierResult: NotifyResult | undefined;
    if (finalSubmission.emergency_landlord_alert) {
      try {
        notifierResult = await notifierFn(
          client,
          {
            draftId,
            agencyId: input.agencyId,
            propertyId: match.propertyId,
            ownerId: match.ownerId,
            safetyCritical: finalSubmission.safety_critical,
            draftSummary: {
              category: finalSubmission.category,
              issueLine: input.subject ?? `${finalSubmission.category} issue`,
            },
          },
          { env: deps.env, logger: log, now: deps.now },
        );
      } catch (err) {
        // Don't fail the pipeline — the draft is already persisted. Alerts
        // can be re-fired from the dashboard later.
        log.error("notifier dispatch failed (swallowed)", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ---- 8. Audit -------------------------------------------------------
    await writeAuditLog(client, {
      agency_id: input.agencyId,
      actor_type: "ai",
      action: "draft.created",
      entity_type: "ai_drafts",
      entity_id: draftId,
      metadata: {
        email_message_id: input.emailMessageId,
        match_confidence: match.confidence,
        matched_via: match.source,
        category: finalSubmission.category,
        priority: finalSubmission.priority,
        escalation_flag: finalSubmission.escalation_flag,
        do_not_send: finalSubmission.do_not_send,
        safety_critical: finalSubmission.safety_critical,
        floor_adjustments: floorAdjustments,
        model,
        duration_ms: durationMs,
        notifications_dispatched: notifierResult?.dispatched ?? 0,
        notifications_queued: notifierResult?.queued ?? 0,
        notifications_suppressed: notifierResult?.suppressed ?? 0,
        notifications_failed: notifierResult?.failed ?? 0,
      },
    });

    log.info("draft created", {
      draft_id: draftId,
      category: finalSubmission.category,
      priority: finalSubmission.priority,
      escalation_flag: finalSubmission.escalation_flag,
      duration_ms: durationMs,
      notifier: notifierResult,
    });
    return {
      kind: "ok",
      draftId,
      matchConfidence: match.confidence,
      matchedVia: match.source,
      notifier: notifierResult,
    };
  } catch (err) {
    const wrapped = err instanceof Error ? err : new Error(String(err));
    log.error("draft pipeline failed", { error: wrapped.message });
    return { kind: "error", error: wrapped };
  }
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

const CONFIDENCE_ORDER: Record<MatchConfidence, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

async function maybeUpdateThreadProperty(
  client: Client,
  input: DraftPipelineInput,
  match: { propertyId: string | null; confidence: MatchConfidence },
): Promise<void> {
  if (!match.propertyId || CONFIDENCE_ORDER[match.confidence] < CONFIDENCE_ORDER.medium) {
    return;
  }
  // Read current thread state so we don't overwrite a stronger link.
  const { data: thread } = await client
    .from("email_threads")
    .select("property_id, property_match_confidence")
    .eq("agency_id", input.agencyId)
    .eq("id", input.threadId)
    .maybeSingle();
  if (!thread) return;
  const existing = thread.property_match_confidence ?? "none";
  if (
    thread.property_id &&
    CONFIDENCE_ORDER[existing as MatchConfidence] >= CONFIDENCE_ORDER[match.confidence]
  ) {
    return; // keep the stronger or equal existing link
  }
  await client
    .from("email_threads")
    .update({
      property_id: match.propertyId,
      property_match_confidence: match.confidence,
    })
    .eq("agency_id", input.agencyId)
    .eq("id", input.threadId);
}

interface LoadedContext {
  kind: "ok";
  agency: AssembleInput["agency"];
  agencyConfig: AssembleInput["agencyConfig"];
  pms: Pm[];
  promptContent: string;
  promptVersionId: string;
}

async function loadAgencyContext(
  client: Client,
  agencyId: string,
): Promise<LoadedContext | { kind: "skipped"; reason: string }> {
  const [agencyRes, configRes, promptRes, pmsRes] = await Promise.all([
    client
      .from("agencies")
      .select("id, name, suburb, business_hours, after_hours_emergency_line, principal_email")
      .eq("id", agencyId)
      .maybeSingle(),
    client.from("agency_config").select("*").eq("agency_id", agencyId).maybeSingle(),
    client
      .from("prompt_versions")
      .select("id, content")
      .eq("agency_id", agencyId)
      .is("active_to", null)
      .maybeSingle(),
    client
      .from("agency_users")
      .select("full_name, email, signature_block")
      .eq("agency_id", agencyId)
      .eq("role", "pm")
      .eq("active", true),
  ]);

  if (agencyRes.error || !agencyRes.data) {
    return { kind: "skipped", reason: "agency_not_found" };
  }
  if (configRes.error || !configRes.data) {
    return { kind: "skipped", reason: "agency_config_not_found" };
  }
  if (promptRes.error || !promptRes.data) {
    return { kind: "skipped", reason: "no_active_prompt_version" };
  }
  if (pmsRes.error) {
    return { kind: "skipped", reason: "pms_lookup_failed" };
  }

  return {
    kind: "ok",
    agency: {
      id: agencyRes.data.id,
      name: agencyRes.data.name,
      suburb: agencyRes.data.suburb,
      businessHours: agencyRes.data.business_hours,
      afterHoursLine: agencyRes.data.after_hours_emergency_line,
      principal: agencyRes.data.principal_email,
    },
    agencyConfig: {
      // jsonb columns come back as the generated `Json` type — cast through
      // unknown to the structured shape; trust the seed/dashboard to have
      // written conformant data. A zod boundary parser is a future
      // hardening step (out of scope for M6).
      voiceSamples: (configRes.data.voice_samples ??
        []) as unknown as AssembleInput["agencyConfig"]["voiceSamples"],
      approvedTradies: (configRes.data.approved_tradies ??
        []) as unknown as AssembleInput["agencyConfig"]["approvedTradies"],
      nominatedRepairer: configRes.data
        .nominated_repairer as unknown as AssembleInput["agencyConfig"]["nominatedRepairer"],
      routineApprovalThresholdCents: configRes.data.routine_approval_threshold_cents,
      writtenQuoteThresholdCents: configRes.data.written_quote_threshold_cents,
      perOwnerQuoteExceptions: (configRes.data.per_owner_quote_exceptions ??
        []) as unknown as AssembleInput["agencyConfig"]["perOwnerQuoteExceptions"],
      houseRules: configRes.data.house_rules,
      leanNotes: (configRes.data.lean_notes ?? []) as unknown as LeanNote[],
    },
    pms: (pmsRes.data ?? []).map((u) => ({
      name: u.full_name,
      email: u.email,
    })),
    promptContent: promptRes.data.content,
    promptVersionId: promptRes.data.id,
  };
}

async function insertDraft(
  client: Client,
  input: DraftPipelineInput,
  match: { confidence: MatchConfidence; source: MatchSource },
  submission: DraftSubmission, // floored values → ai_drafts structured columns
  promptVersionId: string,
  model: string,
  rawResponse: DraftSubmission, // ORIGINAL LLM output → raw_response (audit fidelity)
): Promise<string> {
  const { data, error } = await client
    .from("ai_drafts")
    .insert({
      agency_id: input.agencyId,
      email_message_id: input.emailMessageId,
      category: submission.category,
      category_confidence: submission.category_confidence,
      priority: submission.priority,
      escalation_flag: submission.escalation_flag,
      emergency_landlord_alert: submission.emergency_landlord_alert,
      safety_critical: submission.safety_critical,
      do_not_send: submission.do_not_send,
      draft_confidence: submission.draft_confidence,
      draft_subject: submission.draft_subject || null,
      draft_body: submission.draft_body || null,
      pm_review_notes: submission.pm_review_notes as unknown as Json,
      model_used: model,
      prompt_version_id: promptVersionId,
      raw_response: rawResponse as unknown as Json,
      match_confidence: match.confidence,
      matched_via: match.source,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`ai_drafts insert failed: ${error?.message ?? "no row returned"}`);
  }
  return data.id;
}

async function insertModelCall(
  client: Client,
  input: DraftPipelineInput,
  draftId: string,
  promptVersionId: string,
  model: string,
  inboundEmail: InboundEmail,
  submission: DraftSubmission,
  durationMs: number,
): Promise<void> {
  const request = {
    model,
    prompt_version_id: promptVersionId,
    email_message_id: input.emailMessageId,
    inbound_email: inboundEmail,
  };
  const response = { stop_reason: "tool_use" as const, submission };
  const { error } = await client.from("model_calls").insert({
    agency_id: input.agencyId,
    draft_id: draftId,
    model,
    prompt_version_id: promptVersionId,
    request: request as unknown as Json,
    response: response as unknown as Json,
    duration_ms: durationMs,
  });
  if (error) {
    // Don't fail the whole pipeline on a model_calls insert failure — the
    // draft itself is already persisted and the PM can act on it.
    throw new Error(`model_calls insert failed: ${error.message}`);
  }
}
