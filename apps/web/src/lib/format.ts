import type {
  ConfidenceLevel,
  DraftCategory,
  DraftPriority,
  DraftStatus,
  EscalationFlag,
  MaintenanceJobState,
  MaintenanceOwnerApproval,
  MatchConfidence,
  RentFrequency,
  TenancyStatus,
} from "./types";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** Compact relative time, past or future: "just now", "5m ago", "in 3d". */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diffMs = now.getTime() - then;
  const future = diffMs < 0;
  const sec = Math.round(Math.abs(diffMs) / 1000);
  if (sec < 45) return "just now";
  const unit = (n: number, u: string) => (future ? `in ${n}${u}` : `${n}${u} ago`);
  const min = Math.round(sec / 60);
  if (min < 60) return unit(min, "m");
  const hr = Math.round(min / 60);
  if (hr < 24) return unit(hr, "h");
  const day = Math.round(hr / 24);
  if (day < 7) return unit(day, "d");
  const wk = Math.round(day / 7);
  if (wk < 5) return unit(wk, "w");
  const mo = Math.round(day / 30);
  if (mo < 12) return unit(mo, "mo");
  return unit(Math.round(day / 365), "y");
}

// Hand-formatted (not Intl) so output is identical across ICU versions —
// newer CLDR data renders en-AU "short" June/July as the full month name.
const MONTH_ABBREV = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Absolute date, e.g. "8 Jun 2026". Date-only strings (YYYY-MM-DD — what the
 * DB `date` columns return) are formatted as written, immune to timezone.
 */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const month = MONTH_ABBREV[Number(dateOnly[2]) - 1];
    if (!month) return "—";
    return `${Number(dateOnly[3])} ${month} ${dateOnly[1]}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTH_ABBREV[d.getMonth()]} ${d.getFullYear()}`;
}

/** Absolute date + time, e.g. "8 Jun 2026, 9:30 am". For timestamptz values. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hours24 = d.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const meridiem = hours24 < 12 ? "am" : "pm";
  return `${d.getDate()} ${MONTH_ABBREV[d.getMonth()]} ${d.getFullYear()}, ${hours12}:${minutes} ${meridiem}`;
}

/** Cents → "$600" / "$612.50". Em-dash for null. */
export function formatMoney(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

const RENT_FREQUENCY_SUFFIX: Record<RentFrequency, string> = {
  weekly: "/wk",
  fortnightly: "/fn",
  monthly: "/mo",
};

/** "$600/wk" — rent amount with its frequency suffix. */
export function rentLabel(cents: number | null, frequency: RentFrequency | null): string {
  if (cents === null || !Number.isFinite(cents)) return "—";
  return `${formatMoney(cents)}${frequency ? RENT_FREQUENCY_SUFFIX[frequency] : ""}`;
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

const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  pending: "Pending",
  edited: "Edited",
  sent: "Sent",
  discarded: "Discarded",
  do_not_send: "Do not send",
};
export function draftStatusLabel(s: DraftStatus): string {
  return DRAFT_STATUS_LABELS[s];
}
export function draftStatusVariant(s: DraftStatus): BadgeVariant {
  if (s === "sent") return "secondary";
  if (s === "do_not_send") return "destructive";
  return "outline";
}

const TENANCY_STATUS_LABELS: Record<TenancyStatus, string> = {
  draft: "Draft",
  active: "Active",
  ending: "Ending",
  ended: "Ended",
};
export function tenancyStatusLabel(s: TenancyStatus): string {
  return TENANCY_STATUS_LABELS[s];
}
export function tenancyStatusVariant(s: TenancyStatus): BadgeVariant {
  if (s === "active") return "secondary";
  if (s === "ending") return "default";
  return "outline";
}

const JOB_STATE_LABELS: Record<MaintenanceJobState, string> = {
  new: "New",
  quoting: "Quoting",
  awaiting_owner_approval: "Awaiting owner approval",
  approved: "Approved",
  scheduling: "Scheduling",
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};
export function jobStateLabel(s: MaintenanceJobState): string {
  return JOB_STATE_LABELS[s];
}

const OWNER_APPROVAL_LABELS: Record<MaintenanceOwnerApproval, string> = {
  not_required: "Not required",
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};
export function ownerApprovalLabel(s: MaintenanceOwnerApproval): string {
  return OWNER_APPROVAL_LABELS[s];
}
