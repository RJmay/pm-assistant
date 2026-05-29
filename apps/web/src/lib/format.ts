import type {
  ConfidenceLevel,
  DraftCategory,
  DraftPriority,
  EscalationFlag,
  MatchConfidence,
} from "./types";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diffMs = now.getTime() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(day / 365)}y ago`;
}

const PRIORITY_LABELS: Record<DraftPriority, string> = {
  EMERGENCY_ALERT: "Emergency",
  PRIORITY: "Priority",
  STANDARD: "Standard",
};
const PRIORITY_VARIANTS: Record<DraftPriority, BadgeVariant> = {
  EMERGENCY_ALERT: "destructive",
  PRIORITY: "default",
  STANDARD: "secondary",
};

export function priorityLabel(p: DraftPriority): string {
  return PRIORITY_LABELS[p];
}
export function priorityVariant(p: DraftPriority): BadgeVariant {
  return PRIORITY_VARIANTS[p];
}

const CATEGORY_LABELS: Record<DraftCategory, string> = {
  MAINTENANCE: "Maintenance",
  RENT: "Rent",
  LEASE: "Lease",
  COMPLAINT: "Complaint",
  ADMIN: "Admin",
  OTHER: "Other",
};
export function categoryLabel(c: DraftCategory): string {
  return CATEGORY_LABELS[c];
}

const ESCALATION_LABELS: Record<EscalationFlag, string> = {
  NONE: "None",
  WELFARE: "Welfare",
  LEGAL: "Legal",
  REPUTATIONAL: "Reputational",
  INCIDENT: "Incident",
};
export function escalationLabel(e: EscalationFlag): string {
  return ESCALATION_LABELS[e];
}
export function escalationVariant(e: EscalationFlag): BadgeVariant {
  return e === "NONE" ? "secondary" : "destructive";
}

const MATCH_LABELS: Record<MatchConfidence, string> = {
  high: "Matched",
  medium: "Likely match",
  low: "Weak match",
  none: "No match",
};
export function matchLabel(m: MatchConfidence): string {
  return MATCH_LABELS[m];
}
export function matchVariant(m: MatchConfidence): BadgeVariant {
  if (m === "high") return "secondary";
  if (m === "none") return "destructive";
  return "outline";
}

export function confidenceLabel(c: ConfidenceLevel): string {
  return c.charAt(0) + c.slice(1).toLowerCase();
}

/** Best display name for an email sender. */
export function senderName(fromName: string | null, fromAddress: string): string {
  return fromName?.trim() || fromAddress;
}
