import { error, fail } from "@sveltejs/kit";
import { computeDraftDiff } from "$lib/draft-diff";
import type { Actions, PageServerLoad } from "./$types";

async function currentAgencyUserId(locals: App.Locals, agencyId: string): Promise<string | null> {
  if (!locals.user) return null;
  const { data } = await locals.supabase
    .from("agency_users")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("auth_user_id", locals.user.id)
    .maybeSingle();
  return data?.id ?? null;
}

export const load: PageServerLoad = async ({ locals, params }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");

  const { data: draft, error: draftErr } = await locals.supabase
    .from("ai_drafts")
    .select(
      "id, email_message_id, draft_source, recipient_email, recipient_name, tenancy_id, property_id, category, category_confidence, priority, escalation_flag, emergency_landlord_alert, safety_critical, do_not_send, draft_confidence, draft_subject, draft_body, pm_review_notes, model_used, match_confidence, matched_via, status, bounced_at, bounce_detail, created_at",
    )
    .eq("agency_id", agencyId)
    .eq("id", params.draftId)
    .maybeSingle();
  if (draftErr) error(500, draftErr.message);
  if (!draft) error(404, "Draft not found");

  // Inbound-reply drafts have a source email; sequence (outbound) drafts don't.
  const message = draft.email_message_id
    ? (
        await locals.supabase
          .from("email_messages")
          .select(
            "id, from_name, from_address, to_addresses, subject, body_plain, body_html, received_at",
          )
          .eq("agency_id", agencyId)
          .eq("id", draft.email_message_id)
          .maybeSingle()
      ).data
    : null;

  // For a sequence draft, resolve the property address to show the PM the
  // context (who/where this proactive message is going to).
  let outboundContext: { propertyAddress: string | null } | null = null;
  if (draft.draft_source === "sequence") {
    let propertyAddress: string | null = null;
    if (draft.property_id) {
      const { data: property } = await locals.supabase
        .from("properties")
        .select("address_line1, suburb")
        .eq("agency_id", agencyId)
        .eq("id", draft.property_id)
        .maybeSingle();
      if (property) {
        propertyAddress = [property.address_line1, property.suburb]
          .filter((p) => p && p.trim() !== "")
          .join(", ");
      }
    }
    outboundContext = { propertyAddress };
  }

  const { data: edits } = await locals.supabase
    .from("draft_edits")
    .select("id, previous_subject, new_subject, previous_body, new_body, edited_at")
    .eq("agency_id", agencyId)
    .eq("draft_id", draft.id)
    .order("edited_at", { ascending: false });

  // TODO(types): pm_review_notes is jsonb (typed Json). It always holds a
  // string[] (drafter contract), but the generated type is the recursive Json
  // union, so we narrow through unknown[] here.
  const reviewNotes = Array.isArray(draft.pm_review_notes)
    ? (draft.pm_review_notes as unknown[]).map((n) => String(n))
    : [];

  return {
    draft: { ...draft, pm_review_notes: reviewNotes },
    message: message ?? null,
    outboundContext,
    edits: edits ?? [],
  };
};

export const actions: Actions = {
  saveEdit: async ({ request, locals, params }) => {
    const agencyId = locals.agencyId;
    if (!agencyId) return fail(403, { error: "No agency context" });

    const form = await request.formData();
    const newSubject = String(form.get("subject") ?? "");
    const newBody = String(form.get("body") ?? "");
    const prevSubject = form.get("originalSubject") as string | null;
    const prevBody = form.get("originalBody") as string | null;

    const diff = computeDraftDiff(
      { subject: prevSubject, body: prevBody },
      { subject: newSubject, body: newBody },
    );
    if (!diff) return { saved: false, noChanges: true };

    const editorId = await currentAgencyUserId(locals, agencyId);
    if (!editorId) return fail(403, { error: "Your user is not linked to this agency." });

    const { error: editErr } = await locals.supabase.from("draft_edits").insert({
      agency_id: agencyId,
      draft_id: params.draftId,
      edited_by: editorId,
      previous_subject: diff.previous_subject,
      new_subject: diff.new_subject,
      previous_body: diff.previous_body,
      new_body: diff.new_body,
    });
    if (editErr) return fail(500, { error: editErr.message });

    const { error: updErr } = await locals.supabase
      .from("ai_drafts")
      // Editing clears do_not_send: the PM has taken ownership of the content,
      // which is the sanctioned path to make a flagged draft sendable.
      .update({
        draft_subject: newSubject,
        draft_body: newBody,
        status: "edited",
        do_not_send: false,
      })
      .eq("agency_id", agencyId)
      .eq("id", params.draftId);
    if (updErr) return fail(500, { error: updErr.message });

    return { saved: true };
  },

  discard: async ({ request, locals, params }) => {
    const agencyId = locals.agencyId;
    if (!agencyId) return fail(403, { error: "No agency context" });

    const form = await request.formData();
    const reason = String(form.get("reason") ?? "").trim();
    const editorId = await currentAgencyUserId(locals, agencyId);
    if (!editorId) return fail(403, { error: "Your user is not linked to this agency." });

    const { error: updErr } = await locals.supabase
      .from("ai_drafts")
      .update({ status: "discarded" })
      .eq("agency_id", agencyId)
      .eq("id", params.draftId);
    if (updErr) return fail(500, { error: updErr.message });

    await locals.supabase.from("audit_log").insert({
      agency_id: agencyId,
      actor_type: "user",
      actor_id: editorId,
      action: "draft.discarded",
      entity_type: "ai_drafts",
      entity_id: params.draftId,
      metadata: { reason: reason || null },
    });

    return { discarded: true };
  },
};
