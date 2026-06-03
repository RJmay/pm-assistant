import { error } from "@sveltejs/kit";
import { fetchMaintenanceJobs } from "$lib/server/maintenance";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");
  const jobs = await fetchMaintenanceJobs(locals.supabase, agencyId);
  return { jobs };
};
