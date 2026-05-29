import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  let agencyName: string | null = null;
  if (locals.agencyId) {
    const { data } = await locals.supabase
      .from("agencies")
      .select("name")
      .eq("id", locals.agencyId)
      .maybeSingle();
    agencyName = data?.name ?? null;
  }
  return {
    session: locals.session,
    user: locals.user,
    agencyId: locals.agencyId,
    agencyName,
  };
};
