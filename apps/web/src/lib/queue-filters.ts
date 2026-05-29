import type { DraftCategory, DraftPriority, EscalationFlag, QueueItem } from "./types";

const CATEGORIES: DraftCategory[] = ["MAINTENANCE", "RENT", "LEASE", "COMPLAINT", "ADMIN", "OTHER"];
const ESCALATIONS: EscalationFlag[] = ["WELFARE", "LEGAL", "REPUTATIONAL", "INCIDENT"];

export interface QueueFilter {
  categories: DraftCategory[];
  escalations: EscalationFlag[];
  pmId: string | null;
}

export const EMPTY_FILTER: QueueFilter = { categories: [], escalations: [], pmId: null };

/** Parse the queue filter from URL search params (`cat`, `esc`, `pm`). */
export function parseFilters(params: URLSearchParams): QueueFilter {
  const cat = (params.get("cat") ?? "")
    .split(",")
    .filter((v): v is DraftCategory => (CATEGORIES as string[]).includes(v));
  const esc = (params.get("esc") ?? "")
    .split(",")
    .filter((v): v is EscalationFlag => (ESCALATIONS as string[]).includes(v));
  const pm = params.get("pm");
  return {
    categories: cat,
    escalations: esc,
    pmId: pm && pm.length > 0 ? pm : null,
  };
}

/** Serialise a filter back to a query string (omitting empty parts). */
export function filtersToQuery(filter: QueueFilter): string {
  const params = new URLSearchParams();
  if (filter.categories.length > 0) params.set("cat", filter.categories.join(","));
  if (filter.escalations.length > 0) params.set("esc", filter.escalations.join(","));
  if (filter.pmId) params.set("pm", filter.pmId);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilter(filter: QueueFilter): boolean {
  return filter.categories.length > 0 || filter.escalations.length > 0 || filter.pmId !== null;
}

/** Apply a filter to a list of queue items (AND across dimensions, OR within). */
export function applyFilters<T extends QueueItem>(items: T[], filter: QueueFilter): T[] {
  return items.filter((it) => {
    if (filter.categories.length > 0 && !filter.categories.includes(it.category)) return false;
    if (filter.escalations.length > 0 && !filter.escalations.includes(it.escalation_flag)) {
      return false;
    }
    if (filter.pmId && it.assigned_pm_id !== filter.pmId) return false;
    return true;
  });
}

const PRIORITY_RANK: Record<DraftPriority, number> = {
  EMERGENCY_ALERT: 0,
  PRIORITY: 1,
  STANDARD: 2,
};

/**
 * Queue order: priority descending (Emergency first), then received_at
 * ascending (oldest first — the daily-review convention). Returns a new array.
 */
export function sortQueue<T extends QueueItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    const at = a.received_at ? Date.parse(a.received_at) : Number.POSITIVE_INFINITY;
    const bt = b.received_at ? Date.parse(b.received_at) : Number.POSITIVE_INFINITY;
    return at - bt;
  });
}

/** Whether a draft belongs on the alerts stream (vs the routine queue). */
export function isAlert(it: QueueItem): boolean {
  return (
    it.escalation_flag !== "NONE" ||
    it.emergency_landlord_alert ||
    it.safety_critical ||
    it.do_not_send
  );
}
