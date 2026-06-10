import type { LayoutServerLoad } from "./$types";

export interface DemoScenarioListItem {
  id: string;
  key: string;
  title: string;
  description: string | null;
  compliance: unknown;
  sort_order: number;
  used_at: string | null;
  last_draft_id: string | null;
}

export const load: LayoutServerLoad = async ({ locals }) => {
  let agencyName: string | null = null;
  let isDemo = false;
  let demoScenarios: DemoScenarioListItem[] = [];

  if (locals.agencyId) {
    const { data } = await locals.supabase
      .from("agencies")
      .select("name, is_demo")
      .eq("id", locals.agencyId)
      .maybeSingle();
    agencyName = data?.name ?? null;
    isDemo = data?.is_demo ?? false;

    // Demo tenants get the scenario library for the floating inject panel.
    if (isDemo) {
      const { data: scenarios } = await locals.supabase
        .from("demo_scenarios")
        .select("id, key, title, description, compliance, sort_order, used_at, last_draft_id")
        .eq("agency_id", locals.agencyId)
        .order("sort_order");
      demoScenarios = scenarios ?? [];
    }
  }

  return {
    session: locals.session,
    user: locals.user,
    agencyId: locals.agencyId,
    agencyName,
    isDemo,
    demoScenarios,
  };
};
