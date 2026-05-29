import type { Client } from "@pm/db";

export interface PromptVersionRow {
  id: string;
  agency_id: string | null; // null = global base prompt
  version: string;
  content: string;
  active_from: string;
  active_to: string | null; // null = currently active
  created_by: string | null;
  notes: string | null;
  created_at: string;
}

const COLUMNS =
  "id, agency_id, version, content, active_from, active_to, created_by, notes, created_at";

/**
 * All prompt versions visible to an agency — its own plus the global base
 * (agency_id is null) — newest activation first. A row with `active_to === null`
 * is currently active.
 */
export async function fetchPromptVersions(
  client: Client,
  agencyId: string,
): Promise<PromptVersionRow[]> {
  const { data, error } = await client
    .from("prompt_versions")
    .select(COLUMNS)
    .or(`agency_id.eq.${agencyId},agency_id.is.null`)
    .order("active_from", { ascending: false });
  if (error) throw new Error(`prompt_versions fetch failed: ${error.message}`);
  return (data ?? []) as PromptVersionRow[];
}

/** The agency's currently-active version, if any (prefers an agency-specific row). */
export function activeVersion(rows: PromptVersionRow[], agencyId: string): PromptVersionRow | null {
  const active = rows.filter((r) => r.active_to === null);
  return (
    active.find((r) => r.agency_id === agencyId) ?? active.find((r) => r.agency_id === null) ?? null
  );
}
