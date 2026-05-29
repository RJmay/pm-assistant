export type AuditActorType = "user" | "system" | "ai";

export interface AuditFilter {
  /** substring match on the action (e.g. "draft", "gmail") */
  action: string | null;
  actorType: AuditActorType | null;
  /** ISO date (YYYY-MM-DD); created_at >= this */
  from: string | null;
  page: number;
}

export const AUDIT_PAGE_SIZE = 50;

const ACTOR_TYPES: AuditActorType[] = ["user", "system", "ai"];

/** Parse audit filters from URL search params (`action`, `actor`, `from`, `page`). */
export function parseAuditFilters(params: URLSearchParams): AuditFilter {
  const action = params.get("action");
  const actorRaw = params.get("actor");
  const actorType = (ACTOR_TYPES as string[]).includes(actorRaw ?? "")
    ? (actorRaw as AuditActorType)
    : null;
  const fromRaw = params.get("from");
  const from =
    fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) && !Number.isNaN(Date.parse(fromRaw))
      ? fromRaw
      : null;
  const pageRaw = Number(params.get("page"));
  // Clamp to a sane upper bound so a giant ?page= can't push an absurd offset.
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 100_000) : 1;
  return { action: action && action.length > 0 ? action : null, actorType, from, page };
}

/** Serialise a filter back to a query string (omitting empty parts + page 1). */
export function auditFiltersToQuery(filter: AuditFilter): string {
  const params = new URLSearchParams();
  if (filter.action) params.set("action", filter.action);
  if (filter.actorType) params.set("actor", filter.actorType);
  if (filter.from) params.set("from", filter.from);
  if (filter.page > 1) params.set("page", String(filter.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function hasActiveAuditFilter(filter: AuditFilter): boolean {
  return filter.action !== null || filter.actorType !== null || filter.from !== null;
}
