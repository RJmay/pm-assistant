import type { Client } from "@pm/db";
import type { WorkerBindings } from "../lib/env";
import type { Logger } from "../lib/log";
import {
  buildGeneralAck,
  buildStatusReply,
  classifyInboundSms,
  type SmsClassification,
} from "./sms-classify";
import { writeAuditLog } from "./supabase";
import { sendSms } from "./twilio";

// ============================================================================
// SMS front-door processing (Phase 5, spec §11)
// ============================================================================
// Inbound SMS → classify → resolve tenant/property/job → draft a reply (or flag
// an escalation for a human) → persist. Nothing is auto-sent: the PM reviews
// and sends, which records an outbound row. Agency-scoped (service-role).
// ============================================================================

const TERMINAL_JOB_STATES = ["completed", "cancelled"];

function stripDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

interface ResolvedTenant {
  id: string;
  firstName: string;
  tenancyId: string | null;
}

/** Match an inbound number to a tenant by the trailing digits of their phone. */
async function resolveTenantByPhone(
  client: Client,
  agencyId: string,
  fromNumber: string,
): Promise<ResolvedTenant | null> {
  const { data } = await client
    .from("tenants")
    .select("id, full_name, phone, tenancy_id")
    .eq("agency_id", agencyId)
    .not("phone", "is", null);
  const target = stripDigits(fromNumber);
  if (target.length < 6) return null;
  const suffix = target.slice(-8);
  const match = (data ?? []).find((t) => t.phone && stripDigits(t.phone).endsWith(suffix));
  if (!match) return null;
  return {
    id: match.id,
    firstName: match.full_name.split(/\s+/)[0] ?? match.full_name,
    tenancyId: match.tenancy_id,
  };
}

export interface ProcessInboundSmsInput {
  agencyId: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  providerSid?: string;
}

export interface ProcessInboundSmsResult {
  smsId: string;
  classification: SmsClassification;
  status: "drafted" | "escalated";
}

export async function processInboundSms(
  client: Client,
  input: ProcessInboundSmsInput,
  deps: { logger: Logger },
): Promise<ProcessInboundSmsResult> {
  const classification = classifyInboundSms(input.body);

  const { data: agency } = await client
    .from("agencies")
    .select("name")
    .eq("id", input.agencyId)
    .maybeSingle();
  const agencyName = agency?.name ?? "your property manager";

  const tenant = await resolveTenantByPhone(client, input.agencyId, input.fromNumber);

  // Property + open job (only needed for a status reply).
  let propertyId: string | null = null;
  let job: { trade: string | null; state: string; scheduledFor: string | null } | null = null;
  let maintenanceJobId: string | null = null;
  if (tenant?.tenancyId) {
    const { data: tenancy } = await client
      .from("tenancies")
      .select("property_id")
      .eq("agency_id", input.agencyId)
      .eq("id", tenant.tenancyId)
      .maybeSingle();
    propertyId = tenancy?.property_id ?? null;
  }
  if (classification.intent === "status_query" && propertyId) {
    const { data: jobs } = await client
      .from("maintenance_jobs")
      .select("id, trade, state, scheduled_for")
      .eq("agency_id", input.agencyId)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false });
    const open = (jobs ?? []).find((j) => !TERMINAL_JOB_STATES.includes(j.state));
    if (open) {
      maintenanceJobId = open.id;
      job = { trade: open.trade, state: open.state, scheduledFor: open.scheduled_for };
    }
  }

  // Escalations are flagged for a human, never auto-drafted (§13).
  const isEscalation = classification.intent === "escalation";
  const draftReply = isEscalation
    ? null
    : classification.intent === "status_query"
      ? buildStatusReply({ firstName: tenant?.firstName ?? null, agencyName, job })
      : buildGeneralAck(tenant?.firstName ?? null, agencyName);
  const status = isEscalation ? "escalated" : "drafted";

  const { data: row, error } = await client
    .from("sms_messages")
    .insert({
      agency_id: input.agencyId,
      direction: "inbound",
      from_number: input.fromNumber,
      to_number: input.toNumber,
      body: input.body,
      provider_sid: input.providerSid ?? null,
      intent: classification.intent,
      escalation_flag: classification.escalationFlag,
      tenant_id: tenant?.id ?? null,
      property_id: propertyId,
      maintenance_job_id: maintenanceJobId,
      draft_reply: draftReply,
      status,
    })
    .select("id")
    .single();
  if (error || !row) {
    throw new Error(`sms_messages insert failed: ${error?.message ?? "no row"}`);
  }

  await writeAuditLog(client, {
    agency_id: input.agencyId,
    actor_type: "system",
    action: "sms.received",
    entity_type: "sms_messages",
    entity_id: row.id,
    metadata: {
      intent: classification.intent,
      escalation_flag: classification.escalationFlag,
      tenant_id: tenant?.id ?? null,
      status,
    },
  });

  deps.logger.info("inbound sms processed", {
    sms_id: row.id,
    intent: classification.intent,
    status,
  });
  return { smsId: row.id, classification, status };
}

/** Typed error so the send route maps a known cause to the right status. */
export class SmsError extends Error {
  override readonly name = "SmsError";
  readonly code: "not_found" | "not_sendable";
  constructor(code: SmsError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export interface SendSmsReplyInput {
  agencyId: string;
  smsId: string;
  body: string;
  sentByPmId: string;
}

export async function sendSmsReply(
  client: Client,
  env: WorkerBindings,
  input: SendSmsReplyInput,
  deps: { logger: Logger; now?: () => Date },
): Promise<{ outboundId: string; providerSid: string }> {
  const now = deps.now ?? (() => new Date());

  const { data: inbound, error } = await client
    .from("sms_messages")
    .select("id, direction, from_number, to_number, status")
    .eq("agency_id", input.agencyId)
    .eq("id", input.smsId)
    .maybeSingle();
  if (error) throw new Error(`sms_messages lookup failed: ${error.message}`);
  if (!inbound || inbound.direction !== "inbound") {
    throw new SmsError("not_found", "inbound message not found");
  }
  if (inbound.status === "sent") {
    throw new SmsError("not_sendable", "a reply has already been sent");
  }

  // DEMO SANDBOX — transport-layer seal at the dispatch chokepoint (parity
  // with routes/send.ts and services/notifier.ts). Twilio credentials are
  // GLOBAL worker env (unlike Gmail's per-agency Vault tokens), so without
  // this gate a demo PM's reply would send a real SMS. Demo replies resolve
  // into a sandboxed outbound row instead.
  const { data: agencyRow, error: agencyErr } = await client
    .from("agencies")
    .select("is_demo")
    .eq("id", input.agencyId)
    .maybeSingle();
  // Fail CLOSED: if we can't establish demo status, refuse to touch Twilio.
  if (agencyErr) throw new Error(`agency demo-status lookup failed: ${agencyErr.message}`);
  const isDemo = agencyRow?.is_demo === true;

  // Reply from the agency number the tenant texted, to the tenant's number.
  const sent = isDemo
    ? { sid: `demo-sms-${crypto.randomUUID()}` }
    : await sendSms(
        { to: inbound.from_number, from: inbound.to_number, body: input.body },
        { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN },
      );

  const nowIso = now().toISOString();
  const { data: outbound, error: outErr } = await client
    .from("sms_messages")
    .insert({
      agency_id: input.agencyId,
      direction: "outbound",
      from_number: inbound.to_number,
      to_number: inbound.from_number,
      body: input.body,
      provider_sid: sent.sid,
      status: "sent",
      reply_to_sms_id: inbound.id,
      sent_by: input.sentByPmId,
      sent_at: nowIso,
    })
    .select("id")
    .single();
  if (outErr || !outbound) {
    throw new Error(`outbound sms_messages insert failed: ${outErr?.message ?? "no row"}`);
  }

  await client
    .from("sms_messages")
    .update({ status: "sent", sent_at: nowIso, sent_by: input.sentByPmId })
    .eq("agency_id", input.agencyId)
    .eq("id", inbound.id);

  await writeAuditLog(client, {
    agency_id: input.agencyId,
    actor_type: "user",
    actor_id: input.sentByPmId,
    action: "sms.sent",
    entity_type: "sms_messages",
    entity_id: outbound.id,
    metadata: {
      reply_to_sms_id: inbound.id,
      provider_sid: sent.sid,
      to: inbound.from_number,
      ...(isDemo ? { sandbox: true, demo: true } : {}),
    },
  });

  deps.logger.info(
    isDemo ? "sms reply sent (demo sandbox — no real transport)" : "sms reply sent",
    {
      outbound_id: outbound.id,
      in_reply_to: inbound.id,
    },
  );
  return { outboundId: outbound.id, providerSid: sent.sid };
}
