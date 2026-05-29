import type { Client } from "@pm/db";
import type { QueueItem } from "$lib/types";

const DRAFT_COLUMNS =
  "id, email_message_id, category, priority, escalation_flag, emergency_landlord_alert, safety_critical, do_not_send, draft_confidence, match_confidence, status, assigned_pm_id, bounced_at, draft_subject, created_at";

interface DraftRow {
  id: string;
  email_message_id: string;
  category: QueueItem["category"];
  priority: QueueItem["priority"];
  escalation_flag: QueueItem["escalation_flag"];
  emergency_landlord_alert: boolean;
  safety_critical: boolean;
  do_not_send: boolean;
  draft_confidence: QueueItem["draft_confidence"];
  match_confidence: QueueItem["match_confidence"];
  status: QueueItem["status"];
  assigned_pm_id: string | null;
  bounced_at: string | null;
  draft_subject: string | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  from_name: string | null;
  from_address: string;
  subject: string | null;
  received_at: string | null;
}

/** Join draft rows to their inbound email_messages and flatten to QueueItem. */
async function project(client: Client, agencyId: string, drafts: DraftRow[]): Promise<QueueItem[]> {
  if (drafts.length === 0) return [];
  const messageIds = drafts.map((d) => d.email_message_id);
  const { data: messages, error } = await client
    .from("email_messages")
    .select("id, from_name, from_address, subject, received_at")
    .eq("agency_id", agencyId)
    .in("id", messageIds);
  if (error) throw new Error(`email_messages fetch failed: ${error.message}`);

  const byId = new Map<string, MessageRow>((messages ?? []).map((m) => [m.id, m as MessageRow]));
  return drafts.map((d) => {
    const m = byId.get(d.email_message_id);
    return {
      id: d.id,
      category: d.category,
      priority: d.priority,
      escalation_flag: d.escalation_flag,
      emergency_landlord_alert: d.emergency_landlord_alert,
      safety_critical: d.safety_critical,
      do_not_send: d.do_not_send,
      draft_confidence: d.draft_confidence,
      match_confidence: d.match_confidence,
      status: d.status,
      assigned_pm_id: d.assigned_pm_id,
      bounced_at: d.bounced_at,
      draft_subject: d.draft_subject,
      created_at: d.created_at,
      from_name: m?.from_name ?? null,
      from_address: m?.from_address ?? "(unknown sender)",
      subject: m?.subject ?? null,
      received_at: m?.received_at ?? null,
    } satisfies QueueItem;
  });
}

/** Pending drafts for the daily review queue. */
export async function fetchQueueItems(client: Client, agencyId: string): Promise<QueueItem[]> {
  const { data, error } = await client
    .from("ai_drafts")
    .select(DRAFT_COLUMNS)
    .eq("agency_id", agencyId)
    .eq("status", "pending");
  if (error) throw new Error(`ai_drafts fetch failed: ${error.message}`);
  return project(client, agencyId, (data ?? []) as DraftRow[]);
}

/** Drafts that belong on the alerts stream (escalation / emergency / safety / DNS). */
export async function fetchAlertItems(client: Client, agencyId: string): Promise<QueueItem[]> {
  const { data, error } = await client
    .from("ai_drafts")
    .select(DRAFT_COLUMNS)
    .eq("agency_id", agencyId)
    .or(
      "escalation_flag.neq.NONE,emergency_landlord_alert.eq.true,safety_critical.eq.true,do_not_send.eq.true,bounced_at.not.is.null",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(`ai_drafts alerts fetch failed: ${error.message}`);
  return project(client, agencyId, (data ?? []) as DraftRow[]);
}

export interface PmOption {
  id: string;
  name: string;
}

/** Active PMs for the queue filter dropdown. */
export async function fetchPms(client: Client, agencyId: string): Promise<PmOption[]> {
  const { data, error } = await client
    .from("agency_users")
    .select("id, full_name")
    .eq("agency_id", agencyId)
    .eq("role", "pm")
    .eq("active", true);
  if (error) throw new Error(`agency_users fetch failed: ${error.message}`);
  return (data ?? []).map((u) => ({ id: u.id, name: u.full_name }));
}
