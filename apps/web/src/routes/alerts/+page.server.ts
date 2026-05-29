import { fetchAlertItems } from "$lib/server/drafts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) return { items: [] };
  return { items: await fetchAlertItems(locals.supabase, agencyId) };
};
