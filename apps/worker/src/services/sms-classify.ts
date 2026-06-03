import { detectEscalations } from "@pm/rules";
import type { SmsIntent } from "@pm/shared";

// ============================================================================
// Inbound SMS classification + reply drafting (Phase 5, spec §11)
// ============================================================================
// Deterministic, recall-oriented. The escalation check (§13) runs FIRST and
// independently of intent: a sensitive message is flagged for a human and NOT
// auto-drafted. Otherwise we detect a routine status query (and draft an
// accurate status reply) or fall back to a general acknowledgement. Replies are
// short and drafted only — the PM reviews + sends (§13: never auto-send).
// ============================================================================

export type SmsEscalationFlag = "NONE" | "WELFARE" | "LEGAL" | "REPUTATIONAL";

export interface SmsClassification {
  intent: SmsIntent;
  escalationFlag: SmsEscalationFlag;
}

const STATUS_QUERY_PHRASES = [
  "status",
  "update",
  "what's happening",
  "whats happening",
  "any news",
  "any update",
  "when will",
  "when is",
  "when's",
  "how long",
  "still waiting",
  "follow up",
  "followup",
  "chasing",
  "my repair",
  "the repair",
  "my job",
  "fixed yet",
  "sorted yet",
  "eta",
  "booked in",
];

const MAINTENANCE_PHRASES = [
  "broken",
  "not working",
  "leak",
  "leaking",
  "repair",
  "fix",
  "blocked",
  "won't",
  "wont",
  "hot water",
  "aircon",
  "air con",
];

/** Classify an inbound SMS body. Escalation wins; then status query; etc. */
export function classifyInboundSms(body: string): SmsClassification {
  const escalation = detectEscalations(body);
  if (escalation.escalate) {
    return { intent: "escalation", escalationFlag: escalation.flags[0] ?? "WELFARE" };
  }
  const haystack = body.toLowerCase();
  if (STATUS_QUERY_PHRASES.some((p) => haystack.includes(p))) {
    return { intent: "status_query", escalationFlag: "NONE" };
  }
  if (MAINTENANCE_PHRASES.some((p) => haystack.includes(p))) {
    return { intent: "maintenance", escalationFlag: "NONE" };
  }
  return { intent: "general", escalationFlag: "NONE" };
}

// ----------------------------------------------------------------------------
// Reply drafting (short, SMS-length; drafted only, never auto-sent)
// ----------------------------------------------------------------------------

const JOB_STATE_LABEL: Record<string, string> = {
  new: "being set up",
  quoting: "out for quotes",
  awaiting_owner_approval: "awaiting the owner's approval",
  approved: "approved and being scheduled",
  scheduling: "being scheduled",
  scheduled: "scheduled",
  completed: "completed",
  cancelled: "cancelled",
};

export interface StatusReplyInput {
  firstName: string | null;
  agencyName: string;
  job: { trade: string | null; state: string; scheduledFor: string | null } | null;
}

function greeting(firstName: string | null): string {
  return firstName ? `Hi ${firstName}, ` : "Hi, ";
}

/** A status reply drawn from the tenant's open maintenance job (or a holding reply). */
export function buildStatusReply(input: StatusReplyInput): string {
  const g = greeting(input.firstName);
  const sign = ` — ${input.agencyName}`;
  if (!input.job) {
    return `${g}thanks for checking in. We don't have an open job on file for you right now — a property manager will confirm and get back to you shortly.${sign}`;
  }
  const trade = input.job.trade ? `${input.job.trade} ` : "";
  const state = JOB_STATE_LABEL[input.job.state] ?? input.job.state;
  const when =
    input.job.state === "scheduled" && input.job.scheduledFor
      ? ` (visit ${input.job.scheduledFor.slice(0, 10)})`
      : "";
  return `${g}your ${trade}job is currently ${state}${when}. We'll keep you posted.${sign}`;
}

/** A general acknowledgement for a non-status message. */
export function buildGeneralAck(firstName: string | null, agencyName: string): string {
  return `${greeting(firstName)}thanks for your message — a property manager will be in touch shortly.${` — ${agencyName}`}`;
}
