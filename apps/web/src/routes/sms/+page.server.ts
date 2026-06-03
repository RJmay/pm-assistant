import { error } from "@sveltejs/kit";
import { fetchSmsForReview } from "$lib/server/sms";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");
  const messages = await fetchSmsForReview(locals.supabase, agencyId);
  return { messages };
};
