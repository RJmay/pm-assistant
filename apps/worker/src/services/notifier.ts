import type { Client } from "@pm/db";
import { ResendApiError, TwilioApiError } from "@pm/shared";
import type { WorkerBindings } from "../lib/env";
import type { Logger } from "../lib/log";
import { sendEmail } from "./resend";
import { sendSms } from "./twilio";

/**
 * Owner notification dispatcher — called from the draft pipeline when the
 * draft is flagged emergency_landlord_alert. Resolves the owner, looks up
 * the applicable notification profile, and either dispatches now or queues
 * to the next owner-digest run. Writes a `notification_log` row for every
 * attempt (sent / failed / suppressed / queued) so PMs and audits can see
 * exactly what fired.
 *
 * Profile semantics come from ARCHITECTURE.md §"Owner notification routing".
 * Business hours are hard-coded to QLD AEST Mon-Fri 09:00-17:00 for v1;
 * per-agency hours land in M10 polish.
 */

const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

export type NotificationProfile =
  | "immediate"
  | "business_hours"
  | "safety_critical_only"
  | "email_only"
  | "pm_proxy";

export interface NotifyInput {
  draftId: string;
  agencyId: string;
  /**
   * propertyId is preferred — the notifier looks up the property to find the
   * owner + address. ownerId is used as a fallback when the matcher resolved
   * owner identity but not property (e.g. owner with multiple properties).
   */
  propertyId: string | null;
  ownerId: string | null;
  /** From submission.safety_critical — gates the safety_critical_only profile. */
  safetyCritical: boolean;
  /** Short description used in SMS/email body. */
  draftSummary: {
    category: string;
    issueLine: string;
  };
}

export interface NotifyDeps {
  env: WorkerBindings;
  logger: Logger;
  now?: () => Date;
  /** Test seam — defaults to twilio.sendSms. */
  sms?: typeof sendSms;
  /** Test seam — defaults to resend.sendEmail. */
  email?: typeof sendEmail;
}

export interface NotifyResult {
  dispatched: number;
  queued: number;
  suppressed: number;
  failed: number;
  /** Reason when we couldn't even attempt (e.g. no_owner_resolved). */
  abortReason?: string;
}

export async function dispatchOwnerNotification(
  client: Client,
  input: NotifyInput,
  deps: NotifyDeps,
): Promise<NotifyResult> {
  const log = deps.logger.child({
    agency_id: input.agencyId,
    draft_id: input.draftId,
    notifier: true,
  });
  const now = deps.now ?? (() => new Date());

  // ---- 1. Resolve owner + property + preferences ----
  const ctx = await loadContext(client, input);
  if (ctx.kind === "no_owner") {
    log.warn("notifier: no owner resolved", {
      property_id: input.propertyId,
      owner_id: input.ownerId,
    });
    return { dispatched: 0, queued: 0, suppressed: 0, failed: 0, abortReason: "no_owner_resolved" };
  }
  if (ctx.kind === "error") {
    return { dispatched: 0, queued: 0, suppressed: 0, failed: 0, abortReason: ctx.reason };
  }

  const profile = ctx.profile;
  log.info("notifier: profile resolved", {
    profile,
    owner_id: ctx.owner.id,
    has_phone: Boolean(ctx.owner.phone),
    has_email: Boolean(ctx.owner.email),
  });

  // ---- 2. Decide what to do based on profile ----
  const result: NotifyResult = { dispatched: 0, queued: 0, suppressed: 0, failed: 0 };
  const smsFn = deps.sms ?? sendSms;
  const emailFn = deps.email ?? sendEmail;
  const inBusinessHours = isBusinessHours(now());

  switch (profile) {
    case "immediate": {
      await tryDispatchSms(client, input, ctx, smsFn, deps.env, log, result);
      await tryDispatchEmail(client, input, ctx, emailFn, deps.env, log, result);
      break;
    }
    case "business_hours": {
      if (inBusinessHours) {
        await tryDispatchSms(client, input, ctx, smsFn, deps.env, log, result);
        await tryDispatchEmail(client, input, ctx, emailFn, deps.env, log, result);
      } else {
        await writeQueuedRow(client, input, ctx, "business_hours_outside_window", now(), result);
      }
      break;
    }
    case "safety_critical_only": {
      if (input.safetyCritical) {
        await tryDispatchSms(client, input, ctx, smsFn, deps.env, log, result);
        await tryDispatchEmail(client, input, ctx, emailFn, deps.env, log, result);
      } else {
        await writeSuppressedRow(
          client,
          input,
          ctx,
          "sms",
          "non_safety_critical_under_profile",
          result,
        );
        await writeSuppressedRow(
          client,
          input,
          ctx,
          "email",
          "non_safety_critical_under_profile",
          result,
        );
        await writeQueuedRow(client, input, ctx, "rolled_to_digest", now(), result);
      }
      break;
    }
    case "email_only": {
      await tryDispatchEmail(client, input, ctx, emailFn, deps.env, log, result);
      break;
    }
    case "pm_proxy": {
      await writeQueuedRow(client, input, ctx, "pm_proxy_profile", now(), result);
      break;
    }
  }

  log.info("notifier: dispatch complete", { ...result, profile });
  return result;
}

// ----------------------------------------------------------------------------
// Context loading
// ----------------------------------------------------------------------------

interface LoadedOwner {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
}

interface LoadedContext {
  kind: "ok";
  owner: LoadedOwner;
  property: { id: string; address_line1: string; suburb: string | null } | null;
  profile: NotificationProfile;
  agencyName: string;
}

type ContextResult = LoadedContext | { kind: "no_owner" } | { kind: "error"; reason: string };

async function loadContext(client: Client, input: NotifyInput): Promise<ContextResult> {
  // Step a: resolve property + owner_id ------------------------------------
  let property: LoadedContext["property"] = null;
  let ownerId: string | null = input.ownerId;
  if (input.propertyId) {
    const { data, error } = await client
      .from("properties")
      .select("id, owner_id, address_line1, suburb")
      .eq("agency_id", input.agencyId)
      .eq("id", input.propertyId)
      .maybeSingle();
    if (error) {
      return { kind: "error", reason: "properties_lookup_failed" };
    }
    if (data) {
      property = { id: data.id, address_line1: data.address_line1, suburb: data.suburb };
      ownerId = ownerId ?? data.owner_id;
    }
  }
  if (!ownerId) return { kind: "no_owner" };

  // Step b: load owner -----------------------------------------------------
  const { data: ownerRow, error: ownerErr } = await client
    .from("owners")
    .select("id, full_name, email, phone")
    .eq("agency_id", input.agencyId)
    .eq("id", ownerId)
    .maybeSingle();
  if (ownerErr) return { kind: "error", reason: "owners_lookup_failed" };
  if (!ownerRow) return { kind: "no_owner" };

  // Step c: load notification preferences (property-scoped beats owner-scoped)
  let profile: NotificationProfile = "immediate";
  if (property) {
    const { data: propPref } = await client
      .from("owner_notification_preferences")
      .select("profile")
      .eq("agency_id", input.agencyId)
      .eq("property_id", property.id)
      .maybeSingle();
    if (propPref) profile = propPref.profile as NotificationProfile;
  }
  if (profile === "immediate") {
    // No property-level override — fall back to owner-level
    const { data: ownerPref } = await client
      .from("owner_notification_preferences")
      .select("profile")
      .eq("agency_id", input.agencyId)
      .eq("owner_id", ownerRow.id)
      .is("property_id", null)
      .maybeSingle();
    if (ownerPref) profile = ownerPref.profile as NotificationProfile;
  }

  // Step d: agency name (for content templates) ---------------------------
  const { data: agencyRow } = await client
    .from("agencies")
    .select("name")
    .eq("id", input.agencyId)
    .maybeSingle();
  const agencyName = agencyRow?.name ?? "Property manager";

  return {
    kind: "ok",
    owner: ownerRow,
    property,
    profile,
    agencyName,
  };
}

// ----------------------------------------------------------------------------
// Dispatch helpers — each writes exactly one notification_log row
// ----------------------------------------------------------------------------

async function tryDispatchSms(
  client: Client,
  input: NotifyInput,
  ctx: LoadedContext,
  smsFn: typeof sendSms,
  env: WorkerBindings,
  log: Logger,
  result: NotifyResult,
): Promise<void> {
  if (!ctx.owner.phone) {
    await writeSuppressedRow(client, input, ctx, "sms", "owner_has_no_phone", result);
    return;
  }
  const body = smsBody(ctx, input);
  try {
    const sent = await smsFn(
      { to: ctx.owner.phone, from: env.TWILIO_FROM_NUMBER, body },
      { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN },
    );
    await insertLog(client, input, ctx, {
      channel: "sms",
      status: "sent",
      recipient: ctx.owner.phone,
      body,
      provider_message_id: sent.sid,
    });
    result.dispatched += 1;
  } catch (err) {
    log.error("notifier: sms send failed", {
      owner_id: ctx.owner.id,
      error: err instanceof Error ? err.message : String(err),
      twilio_status: err instanceof TwilioApiError ? err.statusCode : undefined,
    });
    await insertLog(client, input, ctx, {
      channel: "sms",
      status: "failed",
      recipient: ctx.owner.phone,
      body,
      suppression_reason: err instanceof Error ? err.message : "unknown",
    });
    result.failed += 1;
  }
}

async function tryDispatchEmail(
  client: Client,
  input: NotifyInput,
  ctx: LoadedContext,
  emailFn: typeof sendEmail,
  env: WorkerBindings,
  log: Logger,
  result: NotifyResult,
): Promise<void> {
  if (!ctx.owner.email) {
    await writeSuppressedRow(client, input, ctx, "email", "owner_has_no_email", result);
    return;
  }
  const subject = emailSubject(ctx, input);
  const text = emailText(ctx, input);
  try {
    const sent = await emailFn(
      { from: env.RESEND_FROM_EMAIL, to: ctx.owner.email, subject, text },
      { apiKey: env.RESEND_API_KEY },
    );
    await insertLog(client, input, ctx, {
      channel: "email",
      status: "sent",
      recipient: ctx.owner.email,
      body: text,
      provider_message_id: sent.id,
    });
    result.dispatched += 1;
  } catch (err) {
    log.error("notifier: email send failed", {
      owner_id: ctx.owner.id,
      error: err instanceof Error ? err.message : String(err),
      resend_status: err instanceof ResendApiError ? err.statusCode : undefined,
    });
    await insertLog(client, input, ctx, {
      channel: "email",
      status: "failed",
      recipient: ctx.owner.email,
      body: text,
      suppression_reason: err instanceof Error ? err.message : "unknown",
    });
    result.failed += 1;
  }
}

async function writeQueuedRow(
  client: Client,
  input: NotifyInput,
  ctx: LoadedContext,
  reason: string,
  now: Date,
  result: NotifyResult,
): Promise<void> {
  const scheduledFor = nextOwnerDigestFire(now);
  await insertLog(client, input, ctx, {
    channel: "digest",
    status: "queued",
    recipient: ctx.owner.email ?? ctx.owner.phone ?? ctx.owner.full_name,
    body: emailText(ctx, input),
    suppression_reason: reason,
    scheduled_for: scheduledFor.toISOString(),
  });
  result.queued += 1;
}

async function writeSuppressedRow(
  client: Client,
  input: NotifyInput,
  ctx: LoadedContext,
  channel: "sms" | "email",
  reason: string,
  result: NotifyResult,
): Promise<void> {
  await insertLog(client, input, ctx, {
    channel,
    status: "suppressed",
    recipient:
      channel === "sms" ? (ctx.owner.phone ?? "(no phone)") : (ctx.owner.email ?? "(no email)"),
    suppression_reason: reason,
  });
  result.suppressed += 1;
}

interface LogRow {
  channel: "sms" | "email" | "call" | "digest";
  status: "queued" | "sent" | "failed" | "suppressed";
  recipient: string;
  body?: string;
  provider_message_id?: string;
  suppression_reason?: string;
  scheduled_for?: string;
}

async function insertLog(
  client: Client,
  input: NotifyInput,
  ctx: LoadedContext,
  row: LogRow,
): Promise<void> {
  await client.from("notification_log").insert({
    agency_id: input.agencyId,
    owner_id: ctx.owner.id,
    property_id: ctx.property?.id ?? null,
    triggered_by_draft_id: input.draftId,
    channel: row.channel,
    recipient: row.recipient,
    body: row.body ?? null,
    status: row.status,
    suppression_reason: row.suppression_reason ?? null,
    profile_applied: ctx.profile,
    provider_message_id: row.provider_message_id ?? null,
    scheduled_for: row.scheduled_for ?? null,
    sent_at: row.status === "sent" ? new Date().toISOString() : null,
  });
}

// ----------------------------------------------------------------------------
// Content templates
// ----------------------------------------------------------------------------

function smsBody(ctx: LoadedContext, input: NotifyInput): string {
  const address = formatAddress(ctx.property) ?? "your property";
  return `${ctx.agencyName} EMERGENCY: ${input.draftSummary.issueLine} at ${address}. Check the dashboard for the full draft.`;
}

function emailSubject(ctx: LoadedContext, input: NotifyInput): string {
  const address = formatAddress(ctx.property) ?? "your property";
  return `URGENT: ${input.draftSummary.category} at ${address}`;
}

function emailText(ctx: LoadedContext, input: NotifyInput): string {
  const address = formatAddress(ctx.property) ?? "your property";
  return [
    `Hi ${ctx.owner.full_name.split(/\s+/)[0]},`,
    "",
    `${ctx.agencyName} has received an emergency notification at ${address}:`,
    "",
    input.draftSummary.issueLine,
    "",
    "A property manager is reviewing the draft response and will be in touch directly.",
    "",
    "This is an automated alert — please do not reply to this email.",
    "",
    `Kind regards,`,
    ctx.agencyName,
  ].join("\n");
}

function formatAddress(p: LoadedContext["property"]): string | null {
  if (!p) return null;
  return p.suburb ? `${p.address_line1}, ${p.suburb}` : p.address_line1;
}

// ----------------------------------------------------------------------------
// Business hours + next digest fire
// ----------------------------------------------------------------------------

export function isBusinessHours(now: Date): boolean {
  const aest = new Date(now.getTime() + AEST_OFFSET_MS);
  const dow = aest.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false;
  const hour = aest.getUTCHours();
  return hour >= 9 && hour < 17;
}

/**
 * Next owner-digest run is 07:00 AEST. If we're already past 07:00 AEST today
 * the next fire is tomorrow; otherwise it's today.
 */
export function nextOwnerDigestFire(now: Date): Date {
  const aest = new Date(now.getTime() + AEST_OFFSET_MS);
  const aestY = aest.getUTCFullYear();
  const aestM = aest.getUTCMonth();
  const aestD = aest.getUTCDate();
  const aestH = aest.getUTCHours();
  const targetAestDay = aestH >= 7 ? aestD + 1 : aestD;
  const target = new Date(Date.UTC(aestY, aestM, targetAestDay, 7, 0, 0));
  return new Date(target.getTime() - AEST_OFFSET_MS);
}
