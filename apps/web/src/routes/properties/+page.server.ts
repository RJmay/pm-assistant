import { error } from "@sveltejs/kit";
import { aestToday } from "$lib/rent-roll";
import { fetchRentRoll } from "$lib/server/rent-roll";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");
  const items = await fetchRentRoll(locals.supabase, agencyId);
  // Queensland's calendar date (the server runs in UTC) for the
  // inspection-due / arrears indicators; computed server-side so the list
  // renders identically on server and client.
  const today = aestToday();
  return { items, today };
};
