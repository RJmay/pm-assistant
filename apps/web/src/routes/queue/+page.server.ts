import { fetchPms, fetchQueueItems } from "$lib/server/drafts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) return { items: [], pms: [] };
  const [items, pms] = await Promise.all([
    fetchQueueItems(locals.supabase, agencyId),
    fetchPms(locals.supabase, agencyId),
  ]);
  return { items, pms };
};
