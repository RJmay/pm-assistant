import type { Client } from "@pm/db";

// Server queries for the SMS review view. Agency-scoped via RLS (authed client).

export interface SmsReviewItem {
  id: string;
  from_number: string;
  body: string;
  intent: string | null;
  escalation_flag: string;
  status: string;
  draft_reply: string | null;
  tenant_name: string | null;
  created_at: string;
}

interface SmsRow {
  id: string;
  from_number: string;
  body: string;
  intent: string | null;
  escalation_flag: string;
  status: string;
  draft_reply: string | null;
  tenant_id: string | null;
  created_at: string;
}

/** Inbound SMS still needing the PM's attention, newest first. */
export async function fetchSmsForReview(
  client: Client,
  agencyId: string,
): Promise<SmsReviewItem[]> {
  const { data, error } = await client
    .from("sms_messages")
    .select(
      "id, from_number, body, intent, escalation_flag, status, draft_reply, tenant_id, created_at",
    )
    .eq("agency_id", agencyId)
    .eq("direction", "inbound")
    .in("status", ["received", "drafted", "escalated"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(`sms_messages fetch failed: ${error.message}`);
  const rows = (data ?? []) as SmsRow[];

  const tenantIds = [...new Set(rows.map((r) => r.tenant_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (tenantIds.length > 0) {
    const { data: tenants } = await client
      .from("tenants")
      .select("id, full_name")
      .eq("agency_id", agencyId)
      .in("id", tenantIds);
    for (const t of tenants ?? []) names.set(t.id, t.full_name);
  }

  return rows.map((r) => ({
    id: r.id,
    from_number: r.from_number,
    body: r.body,
    intent: r.intent,
    escalation_flag: r.escalation_flag,
    status: r.status,
    draft_reply: r.draft_reply,
    tenant_name: r.tenant_id ? (names.get(r.tenant_id) ?? null) : null,
    created_at: r.created_at,
  }));
}
