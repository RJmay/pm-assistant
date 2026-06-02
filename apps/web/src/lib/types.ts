import type { Database } from "@pm/db";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

export type Agency = Row<"agencies">;
export type AgencyConfig = Row<"agency_config">;
export type AgencyUser = Row<"agency_users">;
export type AiDraft = Row<"ai_drafts">;
export type DraftEdit = Row<"draft_edits">;
export type EmailMessage = Row<"email_messages">;
export type EmailThread = Row<"email_threads">;
export type NotificationLog = Row<"notification_log">;
export type Owner = Row<"owners">;
export type Property = Row<"properties">;

export type DraftCategory = Database["public"]["Enums"]["draft_category"];
export type DraftPriority = Database["public"]["Enums"]["draft_priority"];
export type DraftStatus = Database["public"]["Enums"]["draft_status"];
export type EscalationFlag = Database["public"]["Enums"]["escalation_flag"];
export type ConfidenceLevel = Database["public"]["Enums"]["confidence_level"];
export type MatchConfidence = Database["public"]["Enums"]["match_confidence"];
export type DraftSource = Database["public"]["Enums"]["draft_source"];

// --- agency_config jsonb shapes (mirrors @pm/prompts render types) ----------

export interface Tradie {
  trade: string;
  name: string;
  business_hours_contact?: string;
  after_hours_contact?: string;
}
export interface VoiceSample {
  label: string;
  body: string;
}
export interface LeanNote {
  topic: string;
  lean: string;
  expires_at: string;
}
export interface QuoteException {
  note: string;
}

/**
 * Flattened draft + inbound-email projection used by the queue + alerts lists.
 * The server load joins `ai_drafts` to its `email_messages` row so the UI can
 * show sender + subject + received time without a second round-trip.
 */
export interface QueueItem {
  id: string;
  /** Whether this is a reply to an inbound email or an outbound sequence draft. */
  draft_source: DraftSource;
  category: DraftCategory;
  priority: DraftPriority;
  escalation_flag: EscalationFlag;
  emergency_landlord_alert: boolean;
  safety_critical: boolean;
  do_not_send: boolean;
  draft_confidence: ConfidenceLevel;
  match_confidence: MatchConfidence;
  status: DraftStatus;
  assigned_pm_id: string | null;
  bounced_at: string | null;
  draft_subject: string | null;
  created_at: string;
  from_name: string | null;
  from_address: string;
  subject: string | null;
  received_at: string | null;
}
