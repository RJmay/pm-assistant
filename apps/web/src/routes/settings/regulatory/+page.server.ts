import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

async function isAdminUser(locals: App.Locals, agencyId: string): Promise<boolean> {
  if (!locals.user) return false;
  const { data } = await locals.supabase
    .from("agency_users")
    .select("role")
    .eq("agency_id", agencyId)
    .eq("auth_user_id", locals.user.id)
    .maybeSingle();
  return data?.role === "admin" || data?.role === "principal";
}

export const load: PageServerLoad = async ({ locals }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");
  if (!(await isAdminUser(locals, agencyId))) {
    error(403, "Regulatory alerts are restricted to agency admins.");
  }

  const { data, error: alertsErr } = await locals.supabase
    .from("regulatory_alerts")
    .select(
      "id, source, source_url, detected_at, change_summary, effective_date, affected_modules, proposed_changes, operator_review_state",
    )
    .order("detected_at", { ascending: false })
    .limit(100);
  if (alertsErr) error(500, alertsErr.message);

  // proposed_changes is jsonb (Json); narrow to the {module, description}[] the
  // monitoring summariser writes.
  const alerts = (data ?? []).map((a) => ({
    ...a,
    proposed_changes: Array.isArray(a.proposed_changes)
      ? (a.proposed_changes as Array<Record<string, unknown>>).map((p) => ({
          module: String(p?.module ?? ""),
          description: String(p?.description ?? ""),
        }))
      : [],
  }));

  return { alerts };
};
