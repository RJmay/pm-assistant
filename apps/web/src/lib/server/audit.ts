import type { Client } from "@pm/db";
import { AUDIT_PAGE_SIZE, type AuditFilter } from "$lib/audit-filters";

export interface AuditRow {
  id: string;
  actor_type: "user" | "system" | "ai";
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: unknown;
  created_at: string;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Agency-scoped, filtered, paginated audit_log read (newest first). */
export async function fetchAuditLog(
  client: Client,
  agencyId: string,
  filter: AuditFilter,
): Promise<AuditPage> {
  let query = client
    .from("audit_log")
    .select("id, actor_type, actor_id, action, entity_type, entity_id, metadata, created_at", {
      count: "exact",
    })
    .eq("agency_id", agencyId);

  // `filter.action` is a bound parameter via PostgREST (not raw SQL) — safe.
  if (filter.action) query = query.ilike("action", `%${filter.action}%`);
  if (filter.actorType) query = query.eq("actor_type", filter.actorType);
  if (filter.from) query = query.gte("created_at", filter.from);

  const start = (filter.page - 1) * AUDIT_PAGE_SIZE;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(start, start + AUDIT_PAGE_SIZE - 1);
  if (error) throw new Error(`audit_log fetch failed: ${error.message}`);

  return {
    rows: (data ?? []) as AuditRow[],
    total: count ?? 0,
    page: filter.page,
    pageSize: AUDIT_PAGE_SIZE,
  };
}
