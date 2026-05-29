import { error, fail } from "@sveltejs/kit";
import { activeVersion, fetchPromptVersions } from "$lib/server/prompts";
import type { Actions, PageServerLoad } from "./$types";

const ADMIN_ROLES = ["admin", "principal"];

async function currentAgencyUser(
  locals: App.Locals,
  agencyId: string,
): Promise<{ id: string; role: string } | null> {
  if (!locals.user) return null;
  const { data } = await locals.supabase
    .from("agency_users")
    .select("id, role")
    .eq("agency_id", agencyId)
    .eq("auth_user_id", locals.user.id)
    .maybeSingle();
  return data ?? null;
}

export const load: PageServerLoad = async ({ locals }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");

  const me = await currentAgencyUser(locals, agencyId);
  if (!me || !ADMIN_ROLES.includes(me.role)) {
    error(403, "Prompt management is restricted to agency admins.");
  }

  const versions = await fetchPromptVersions(locals.supabase, agencyId);
  return {
    versions,
    active: activeVersion(versions, agencyId),
  };
};

export const actions: Actions = {
  // Activate a version: append a NEW active row (copying the chosen content) and
  // close the current active row's window. Prompt content is never edited in
  // place — versioning is append-only (CLAUDE.md + schema rule).
  activate: async ({ request, locals }) => {
    const agencyId = locals.agencyId;
    if (!agencyId) return fail(403, { error: "No agency context" });

    const me = await currentAgencyUser(locals, agencyId);
    if (!me || !ADMIN_ROLES.includes(me.role)) {
      return fail(403, { error: "Only an agency admin can change the active prompt." });
    }

    const form = await request.formData();
    const versionId = String(form.get("versionId") ?? "");
    if (!versionId) return fail(400, { error: "Missing version id." });

    // Load the chosen version (the agency's own, or the global base).
    const { data: target, error: targetErr } = await locals.supabase
      .from("prompt_versions")
      .select("id, version, content")
      .eq("id", versionId)
      .or(`agency_id.eq.${agencyId},agency_id.is.null`)
      .maybeSingle();
    if (targetErr) return fail(500, { error: targetErr.message });
    if (!target) return fail(404, { error: "Version not found." });

    const nowIso = new Date().toISOString();

    // Close the agency's current active window.
    const { error: closeErr } = await locals.supabase
      .from("prompt_versions")
      .update({ active_to: nowIso })
      .eq("agency_id", agencyId)
      .is("active_to", null);
    if (closeErr) return fail(500, { error: closeErr.message });

    // Append the new active row.
    const { error: insErr } = await locals.supabase.from("prompt_versions").insert({
      agency_id: agencyId,
      version: target.version,
      content: target.content,
      active_from: nowIso,
      active_to: null,
      created_by: me.id,
      notes: `Activated via dashboard (from version row ${target.id})`,
    });
    if (insErr) return fail(500, { error: insErr.message });

    await locals.supabase.from("audit_log").insert({
      agency_id: agencyId,
      actor_type: "user",
      actor_id: me.id,
      action: "prompt.activated",
      entity_type: "prompt_versions",
      entity_id: target.id,
      metadata: { version: target.version },
    });

    return { activated: true };
  },
};
