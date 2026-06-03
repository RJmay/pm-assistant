import { error } from "@sveltejs/kit";
import { fetchDocument } from "$lib/server/documents";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");
  const document = await fetchDocument(locals.supabase, agencyId, params.id);
  if (!document) error(404, "Document not found");
  return { document };
};
