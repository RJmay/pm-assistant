import { error } from "@sveltejs/kit";
import { fetchDocuments, fetchTenancyOptions } from "$lib/server/documents";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");
  const [documents, tenancies] = await Promise.all([
    fetchDocuments(locals.supabase, agencyId),
    fetchTenancyOptions(locals.supabase, agencyId),
  ]);
  return { documents, tenancies };
};
