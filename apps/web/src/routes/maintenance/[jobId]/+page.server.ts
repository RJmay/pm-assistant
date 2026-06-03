import { error } from "@sveltejs/kit";
import { fetchMaintenanceJob } from "$lib/server/maintenance";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");
  const job = await fetchMaintenanceJob(locals.supabase, agencyId, params.jobId);
  if (!job) error(404, "Maintenance job not found");
  return { job };
};
