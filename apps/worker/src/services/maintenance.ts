import type { Client, Json } from "@pm/db";
import { buildOwnerApprovalRequest, buildTradieQuoteRequest } from "@pm/prompts";
import { RuleNotConfiguredError, RuleNotFoundError, triageEmergencyRepair } from "@pm/rules";
import type {
  MaintenanceClassification,
  MaintenanceOwnerApproval,
  MaintenanceQuote,
} from "@pm/shared";
import type { Logger } from "../lib/log";
import { resolvePmName, resolvePropertyAddress } from "./sequences/resolve";
import { writeAuditLog } from "./supabase";

// ============================================================================
// Maintenance coordination service (Phase 3, spec §9)
// ============================================================================
// PM-initiated: from a MAINTENANCE draft the PM creates a job (triaged
// EMERGENCY vs routine via the rules-engine s214 list), then we draft tradie
// quote requests to the agency's approved tradies for the trade. Every outbound
// message is an ai_drafts row (draft_source='maintenance', linked via
// maintenance_job_id) queued for the PM to review and send — never auto-sent.
// All queries are agency-scoped (service-role bypasses RLS).
// ============================================================================

const PG_UNIQUE_VIOLATION = "23505";
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

interface ConfigTradie {
  trade: string;
  name: string;
  email?: string;
  business_hours_contact?: string;
  after_hours_contact?: string;
}

/** First email-looking contact for a tradie, or null. */
function tradieEmail(t: ConfigTradie): string | null {
  for (const c of [t.email, t.business_hours_contact, t.after_hours_contact]) {
    if (c?.includes("@")) return c.trim();
  }
  return null;
}

function aestToday(now: Date): string {
  return new Date(now.getTime() + AEST_OFFSET_MS).toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
// Create a job from a MAINTENANCE draft
// ----------------------------------------------------------------------------

export interface CreateJobInput {
  agencyId: string;
  /** The inbound MAINTENANCE ai_drafts row the PM is acting on. */
  draftId: string;
  createdByPmId: string;
  /** Optional issue override; otherwise derived from the inbound email. */
  issue?: string;
  /** Optional trade override the PM picked. */
  trade?: string;
}

export interface CreateJobResult {
  jobId: string;
  classification: MaintenanceClassification;
  propertyId: string | null;
  alreadyExisted: boolean;
}

export async function createMaintenanceJob(
  client: Client,
  input: CreateJobInput,
  deps: { logger: Logger; now?: () => Date },
): Promise<CreateJobResult> {
  const now = deps.now ?? (() => new Date());

  const { data: draft, error: draftErr } = await client
    .from("ai_drafts")
    .select("id, email_message_id, draft_subject, category")
    .eq("agency_id", input.agencyId)
    .eq("id", input.draftId)
    .maybeSingle();
  if (draftErr) throw new Error(`ai_drafts lookup failed: ${draftErr.message}`);
  if (!draft) throw new MaintenanceError("draft_not_found", "draft not found");
  if (!draft.email_message_id) {
    throw new MaintenanceError("not_inbound", "a job can only be created from an inbound draft");
  }

  // Inbound message → text for triage + the thread's property.
  const { data: inbound } = await client
    .from("email_messages")
    .select("subject, body_plain, body_html, thread_id")
    .eq("agency_id", input.agencyId)
    .eq("id", draft.email_message_id)
    .maybeSingle();
  let propertyId: string | null = null;
  if (inbound?.thread_id) {
    const { data: thread } = await client
      .from("email_threads")
      .select("property_id")
      .eq("agency_id", input.agencyId)
      .eq("id", inbound.thread_id)
      .maybeSingle();
    propertyId = thread?.property_id ?? null;
  }

  const issue =
    input.issue?.trim() ||
    inbound?.subject?.trim() ||
    draft.draft_subject?.trim() ||
    "Maintenance request";
  const inboundText = `${inbound?.subject ?? ""}\n${inbound?.body_plain ?? inbound?.body_html ?? ""}`;
  const classification = classify(inboundText, aestToday(now()), deps.logger);

  // Insert the job; the unique index on source_draft_id makes this idempotent —
  // a second click on the same draft returns the existing job.
  const { data: created, error: insErr } = await client
    .from("maintenance_jobs")
    .insert({
      agency_id: input.agencyId,
      property_id: propertyId,
      source_draft_id: input.draftId,
      source_email_message_id: draft.email_message_id,
      issue,
      classification,
      trade: input.trade ?? null,
      state: "new",
      created_by: input.createdByPmId,
    })
    .select("id")
    .single();

  if (insErr) {
    if (insErr.code === PG_UNIQUE_VIOLATION) {
      const { data: existing } = await client
        .from("maintenance_jobs")
        .select("id, classification, property_id")
        .eq("agency_id", input.agencyId)
        .eq("source_draft_id", input.draftId)
        .maybeSingle();
      if (existing) {
        return {
          jobId: existing.id,
          classification: existing.classification,
          propertyId: existing.property_id,
          alreadyExisted: true,
        };
      }
    }
    throw new Error(`maintenance_jobs insert failed: ${insErr.message}`);
  }

  await writeAuditLog(client, {
    agency_id: input.agencyId,
    actor_type: "user",
    actor_id: input.createdByPmId,
    action: "maintenance.job_created",
    entity_type: "maintenance_jobs",
    entity_id: created.id,
    metadata: { source_draft_id: input.draftId, classification, property_id: propertyId, issue },
  });

  deps.logger.info("maintenance job created", {
    job_id: created.id,
    classification,
    property_id: propertyId,
  });
  return { jobId: created.id, classification, propertyId, alreadyExisted: false };
}

function classify(text: string, asOf: string, log: Logger): MaintenanceClassification {
  try {
    return triageEmergencyRepair(text, asOf).isEmergency ? "emergency" : "routine";
  } catch (err) {
    if (err instanceof RuleNotConfiguredError || err instanceof RuleNotFoundError) {
      log.warn("maintenance: s214 triage unavailable; defaulting to routine", {
        error: err.message,
      });
      return "routine";
    }
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Draft tradie quote requests for a job's trade
// ----------------------------------------------------------------------------

export interface QuoteRequestInput {
  agencyId: string;
  jobId: string;
  /** Trade to source quotes for (matches agency_config.approved_tradies.trade). */
  trade: string;
  createdByPmId: string;
}

export interface QuoteRequestResult {
  tradiesMatched: number;
  drafted: number;
  skippedNoEmail: number;
}

export async function draftTradieQuoteRequests(
  client: Client,
  input: QuoteRequestInput,
  deps: { logger: Logger; now?: () => Date },
): Promise<QuoteRequestResult> {
  const now = deps.now ?? (() => new Date());

  const { data: job, error: jobErr } = await client
    .from("maintenance_jobs")
    .select("id, property_id, issue, classification, quotes, trade")
    .eq("agency_id", input.agencyId)
    .eq("id", input.jobId)
    .maybeSingle();
  if (jobErr) throw new Error(`maintenance_jobs lookup failed: ${jobErr.message}`);
  if (!job) throw new MaintenanceError("job_not_found", "job not found");

  const [{ data: config }, { data: agency }] = await Promise.all([
    client
      .from("agency_config")
      .select("approved_tradies, pm_signoff_default")
      .eq("agency_id", input.agencyId)
      .maybeSingle(),
    client.from("agencies").select("name").eq("id", input.agencyId).maybeSingle(),
  ]);

  const tradies = ((config?.approved_tradies ?? []) as unknown as ConfigTradie[]).filter(
    (t) => t.trade?.toLowerCase() === input.trade.toLowerCase(),
  );
  const propertyAddress = await resolvePropertyAddress(client, input.agencyId, job.property_id);
  const pmName = await resolvePmName(client, input.agencyId, job.property_id);
  const agencyName = agency?.name ?? "";
  const pmSignoff = config?.pm_signoff_default ?? undefined;
  const isEmergency = job.classification === "emergency";

  const existingQuotes = (job.quotes ?? []) as unknown as MaintenanceQuote[];
  const newQuotes: MaintenanceQuote[] = [];
  let drafted = 0;
  let skippedNoEmail = 0;

  for (const tradie of tradies) {
    const email = tradieEmail(tradie);
    if (!email) {
      skippedNoEmail += 1;
      deps.logger.warn("maintenance: tradie has no email; skipping quote request", {
        tradie: tradie.name,
      });
      continue;
    }
    const built = buildTradieQuoteRequest({
      tradieName: tradie.name,
      trade: input.trade,
      propertyAddress,
      issueSummary: job.issue,
      isEmergency,
      agencyName,
      pmName,
      pmSignoff,
    });

    const { data: draft, error: draftErr } = await client
      .from("ai_drafts")
      .insert({
        agency_id: input.agencyId,
        draft_source: "maintenance",
        maintenance_job_id: input.jobId,
        property_id: job.property_id,
        recipient_email: email,
        recipient_name: tradie.name,
        category: "MAINTENANCE",
        category_confidence: "HIGH",
        priority: isEmergency ? "PRIORITY" : "STANDARD",
        escalation_flag: "NONE",
        emergency_landlord_alert: false,
        safety_critical: false,
        do_not_send: false,
        draft_confidence: "HIGH",
        draft_subject: built.subject,
        draft_body: built.body,
        pm_review_notes: built.reviewNotes as unknown as Json,
        model_used: "template:tradie_quote_request_v1",
        match_confidence: "high",
        status: "pending",
      })
      .select("id")
      .single();
    if (draftErr || !draft) {
      throw new Error(`quote-request ai_drafts insert failed: ${draftErr?.message ?? "no row"}`);
    }

    newQuotes.push({
      id: crypto.randomUUID(),
      tradie_name: tradie.name,
      trade: input.trade,
      status: "requested",
      requested_at: now().toISOString(),
      draft_id: draft.id,
    });
    drafted += 1;

    await writeAuditLog(client, {
      agency_id: input.agencyId,
      actor_type: "user",
      actor_id: input.createdByPmId,
      action: "maintenance.quote_requested",
      entity_type: "maintenance_jobs",
      entity_id: input.jobId,
      metadata: { tradie: tradie.name, draft_id: draft.id, recipient: email },
    });
  }

  if (drafted > 0) {
    const { error: updErr } = await client
      .from("maintenance_jobs")
      .update({
        quotes: [...existingQuotes, ...newQuotes] as unknown as Json,
        state: "quoting",
        trade: job.trade ?? input.trade,
      })
      .eq("agency_id", input.agencyId)
      .eq("id", input.jobId);
    if (updErr) throw new Error(`maintenance_jobs update failed: ${updErr.message}`);
  }

  deps.logger.info("maintenance quote requests drafted", {
    job_id: input.jobId,
    tradies_matched: tradies.length,
    drafted,
    skipped_no_email: skippedNoEmail,
  });
  return { tradiesMatched: tradies.length, drafted, skippedNoEmail };
}

/** Typed error so the route can map a known cause to the right HTTP status. */
export class MaintenanceError extends Error {
  override readonly name = "MaintenanceError";
  readonly code:
    | "draft_not_found"
    | "not_inbound"
    | "job_not_found"
    | "quote_not_found"
    | "no_owner_email";
  constructor(code: MaintenanceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

// ----------------------------------------------------------------------------
// M3.2 — record a returned quote
// ----------------------------------------------------------------------------

export interface RecordQuoteInput {
  agencyId: string;
  jobId: string;
  quoteId: string;
  amountCents?: number;
  status?: MaintenanceQuote["status"];
  createdByPmId: string;
}

/** Record a tradie's returned quote (amount + status) on a job's quote entry. */
export async function recordQuote(
  client: Client,
  input: RecordQuoteInput,
  deps: { logger: Logger },
): Promise<void> {
  const { data: job, error } = await client
    .from("maintenance_jobs")
    .select("id, quotes")
    .eq("agency_id", input.agencyId)
    .eq("id", input.jobId)
    .maybeSingle();
  if (error) throw new Error(`maintenance_jobs lookup failed: ${error.message}`);
  if (!job) throw new MaintenanceError("job_not_found", "job not found");

  const quotes = (job.quotes ?? []) as unknown as MaintenanceQuote[];
  const idx = quotes.findIndex((q) => q.id === input.quoteId);
  if (idx === -1) throw new MaintenanceError("quote_not_found", "quote not found");

  const existing = quotes[idx];
  if (!existing) throw new MaintenanceError("quote_not_found", "quote not found");
  const updated: MaintenanceQuote = {
    ...existing,
    status: input.status ?? (input.amountCents != null ? "received" : existing.status),
  };
  if (input.amountCents != null) updated.amount_cents = input.amountCents;
  const nextQuotes = quotes.map((q, i) => (i === idx ? updated : q));

  const { error: updErr } = await client
    .from("maintenance_jobs")
    .update({ quotes: nextQuotes as unknown as Json })
    .eq("agency_id", input.agencyId)
    .eq("id", input.jobId);
  if (updErr) throw new Error(`maintenance_jobs update failed: ${updErr.message}`);

  await writeAuditLog(client, {
    agency_id: input.agencyId,
    actor_type: "user",
    actor_id: input.createdByPmId,
    action: "maintenance.quote_recorded",
    entity_type: "maintenance_jobs",
    entity_id: input.jobId,
    metadata: {
      quote_id: input.quoteId,
      tradie: existing.tradie_name,
      amount_cents: updated.amount_cents ?? null,
      status: updated.status,
    },
  });
  deps.logger.info("maintenance quote recorded", {
    job_id: input.jobId,
    quote_id: input.quoteId,
    amount_cents: updated.amount_cents ?? null,
  });
}

// ----------------------------------------------------------------------------
// M3.2 — owner-approval request (spending-authority gated)
// ----------------------------------------------------------------------------

interface ResolvedOwner {
  ownerId: string;
  name: string;
  email: string;
}

async function resolveOwner(
  client: Client,
  agencyId: string,
  propertyId: string | null,
): Promise<ResolvedOwner | null> {
  if (!propertyId) return null;
  const { data: property } = await client
    .from("properties")
    .select("owner_id")
    .eq("agency_id", agencyId)
    .eq("id", propertyId)
    .maybeSingle();
  if (!property?.owner_id) return null;
  const { data: owner } = await client
    .from("owners")
    .select("id, full_name, email")
    .eq("agency_id", agencyId)
    .eq("id", property.owner_id)
    .maybeSingle();
  if (!owner?.email || owner.email.trim() === "") return null;
  return { ownerId: owner.id, name: owner.full_name, email: owner.email };
}

interface OwnerException {
  owner_id: string;
  threshold_cents: number;
}

/** Effective routine-approval threshold for the property's owner, in cents. */
async function resolveThreshold(
  client: Client,
  agencyId: string,
  ownerId: string | null,
): Promise<number> {
  const { data: config } = await client
    .from("agency_config")
    .select("routine_approval_threshold_cents, per_owner_quote_exceptions")
    .eq("agency_id", agencyId)
    .maybeSingle();
  const routine = config?.routine_approval_threshold_cents ?? 25000;
  if (!ownerId) return routine;
  const exceptions = (config?.per_owner_quote_exceptions ?? []) as unknown as OwnerException[];
  const match = exceptions.find((e) => e.owner_id === ownerId);
  return typeof match?.threshold_cents === "number" ? match.threshold_cents : routine;
}

export interface OwnerApprovalInput {
  agencyId: string;
  jobId: string;
  /** Estimate in cents; defaults to the lowest received quote. */
  estimateCents?: number;
  createdByPmId: string;
}

export interface OwnerApprovalResult {
  draftId: string;
  thresholdCents: number;
  estimateCents: number | null;
}

/**
 * Draft an owner-approval request for a job (outbound to the owner) and move the
 * job to awaiting_owner_approval. Resolves the spending-authority threshold
 * (per-owner exception, else the agency routine threshold) and uses the lowest
 * received quote as the estimate when one isn't supplied. Never authorises spend.
 */
export async function draftOwnerApprovalRequest(
  client: Client,
  input: OwnerApprovalInput,
  deps: { logger: Logger },
): Promise<OwnerApprovalResult> {
  const { data: job, error } = await client
    .from("maintenance_jobs")
    .select("id, property_id, issue, quotes")
    .eq("agency_id", input.agencyId)
    .eq("id", input.jobId)
    .maybeSingle();
  if (error) throw new Error(`maintenance_jobs lookup failed: ${error.message}`);
  if (!job) throw new MaintenanceError("job_not_found", "job not found");

  const owner = await resolveOwner(client, input.agencyId, job.property_id);
  if (!owner) {
    throw new MaintenanceError("no_owner_email", "the property's owner has no email on file");
  }
  const thresholdCents = await resolveThreshold(client, input.agencyId, owner.ownerId);

  const quotes = (job.quotes ?? []) as unknown as MaintenanceQuote[];
  const lowestReceived = quotes
    .map((q) => q.amount_cents)
    .filter((c): c is number => typeof c === "number")
    .sort((a, b) => a - b)[0];
  const estimateCents = input.estimateCents ?? lowestReceived ?? null;

  const [{ data: agency }, { data: config }] = await Promise.all([
    client.from("agencies").select("name").eq("id", input.agencyId).maybeSingle(),
    client
      .from("agency_config")
      .select("pm_signoff_default")
      .eq("agency_id", input.agencyId)
      .maybeSingle(),
  ]);
  const propertyAddress = await resolvePropertyAddress(client, input.agencyId, job.property_id);
  const pmName = await resolvePmName(client, input.agencyId, job.property_id);

  const built = buildOwnerApprovalRequest({
    ownerName: owner.name,
    propertyAddress,
    issueSummary: job.issue,
    estimateCents: estimateCents ?? undefined,
    thresholdCents,
    agencyName: agency?.name ?? "",
    pmName,
    pmSignoff: config?.pm_signoff_default ?? undefined,
  });

  const { data: draft, error: draftErr } = await client
    .from("ai_drafts")
    .insert({
      agency_id: input.agencyId,
      draft_source: "maintenance",
      maintenance_job_id: input.jobId,
      property_id: job.property_id,
      recipient_email: owner.email,
      recipient_name: owner.name,
      category: "MAINTENANCE",
      category_confidence: "HIGH",
      priority: "STANDARD",
      escalation_flag: "NONE",
      emergency_landlord_alert: false,
      safety_critical: false,
      do_not_send: false,
      draft_confidence: "HIGH",
      draft_subject: built.subject,
      draft_body: built.body,
      pm_review_notes: built.reviewNotes as unknown as Json,
      model_used: "template:owner_approval_request_v1",
      match_confidence: "high",
      status: "pending",
    })
    .select("id")
    .single();
  if (draftErr || !draft) {
    throw new Error(`owner-approval ai_drafts insert failed: ${draftErr?.message ?? "no row"}`);
  }

  const { error: updErr } = await client
    .from("maintenance_jobs")
    .update({ owner_approval_state: "pending", state: "awaiting_owner_approval" })
    .eq("agency_id", input.agencyId)
    .eq("id", input.jobId);
  if (updErr) throw new Error(`maintenance_jobs update failed: ${updErr.message}`);

  await writeAuditLog(client, {
    agency_id: input.agencyId,
    actor_type: "user",
    actor_id: input.createdByPmId,
    action: "maintenance.owner_approval_requested",
    entity_type: "maintenance_jobs",
    entity_id: input.jobId,
    metadata: {
      draft_id: draft.id,
      recipient: owner.email,
      threshold_cents: thresholdCents,
      estimate_cents: estimateCents,
    },
  });
  deps.logger.info("maintenance owner-approval requested", {
    job_id: input.jobId,
    draft_id: draft.id,
    threshold_cents: thresholdCents,
    estimate_cents: estimateCents,
  });
  return { draftId: draft.id, thresholdCents, estimateCents };
}

// ----------------------------------------------------------------------------
// M3.2 — record the owner's decision
// ----------------------------------------------------------------------------

export interface DecisionInput {
  agencyId: string;
  jobId: string;
  decision: "approved" | "declined";
  approvedSpendCents?: number;
  createdByPmId: string;
}

/** Record the owner's approval decision and advance the job state. */
export async function recordOwnerDecision(
  client: Client,
  input: DecisionInput,
  deps: { logger: Logger },
): Promise<void> {
  const { data: job, error } = await client
    .from("maintenance_jobs")
    .select("id, state")
    .eq("agency_id", input.agencyId)
    .eq("id", input.jobId)
    .maybeSingle();
  if (error) throw new Error(`maintenance_jobs lookup failed: ${error.message}`);
  if (!job) throw new MaintenanceError("job_not_found", "job not found");

  const ownerApproval: MaintenanceOwnerApproval = input.decision;
  const update: {
    owner_approval_state: MaintenanceOwnerApproval;
    state?: "approved";
    approved_spend_cents?: number;
  } = { owner_approval_state: ownerApproval };
  if (input.decision === "approved") {
    update.state = "approved";
    if (input.approvedSpendCents != null) update.approved_spend_cents = input.approvedSpendCents;
  }

  const { error: updErr } = await client
    .from("maintenance_jobs")
    .update(update)
    .eq("agency_id", input.agencyId)
    .eq("id", input.jobId);
  if (updErr) throw new Error(`maintenance_jobs update failed: ${updErr.message}`);

  await writeAuditLog(client, {
    agency_id: input.agencyId,
    actor_type: "user",
    actor_id: input.createdByPmId,
    action: "maintenance.owner_decision_recorded",
    entity_type: "maintenance_jobs",
    entity_id: input.jobId,
    metadata: { decision: input.decision, approved_spend_cents: input.approvedSpendCents ?? null },
  });
  deps.logger.info("maintenance owner decision recorded", {
    job_id: input.jobId,
    decision: input.decision,
  });
}
