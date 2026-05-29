import { error } from "@sveltejs/kit";
import { parseAuditFilters } from "$lib/audit-filters";
import { fetchAuditLog } from "$lib/server/audit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");

  const filter = parseAuditFilters(url.searchParams);
  const result = await fetchAuditLog(locals.supabase, agencyId, filter);
  return { ...result, filter };
};
