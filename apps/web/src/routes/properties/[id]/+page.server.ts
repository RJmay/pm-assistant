import { error, fail } from "@sveltejs/kit";
import { aestToday } from "$lib/rent-roll";
import { fetchPropertyDetail } from "$lib/server/rent-roll";
import type { RentFrequency } from "$lib/types";
import type { Actions, PageServerLoad } from "./$types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RENT_FREQUENCIES: RentFrequency[] = ["weekly", "fortnightly", "monthly"];

export const load: PageServerLoad = async ({ locals, params }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");
  if (!UUID_REGEX.test(params.id)) error(404, "Property not found");
  const detail = await fetchPropertyDetail(locals.supabase, agencyId, params.id);
  if (!detail) error(404, "Property not found");
  // Queensland's calendar date — pre-fills the inspection/arrears date inputs
  // and drives the due badges (UTC would be yesterday until 10am Brisbane).
  const today = aestToday();
  return { ...detail, today };
};

// ---------------------------------------------------------------------------
// Edit actions. All writes go through locals.supabase (RLS-enforced) with
// explicit agency_id filters, confirm a row actually matched, and append an
// audit_log row — same conventions as the queue/settings actions.
// ---------------------------------------------------------------------------

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

interface ActionContext {
  agencyId: string;
  editorId: string;
  form: FormData;
}

/** Shared preamble: agency context + linked agency user + parsed form. */
async function actionContext(
  locals: App.Locals,
  request: Request,
): Promise<ActionContext | ReturnType<typeof fail>> {
  const agencyId = locals.agencyId;
  if (!agencyId) return fail(403, { error: "No agency context" });
  const editorId = await currentAgencyUserId(locals, agencyId);
  if (!editorId) return fail(403, { error: "Your user is not linked to this agency." });
  return { agencyId, editorId, form: await request.formData() };
}

function isFail(v: ActionContext | ReturnType<typeof fail>): v is ReturnType<typeof fail> {
  return !("agencyId" in v);
}

/** Trimmed string field; empty → null. */
function text(form: FormData, name: string): string | null {
  const v = String(form.get(name) ?? "").trim();
  return v === "" ? null : v;
}

function isoDate(form: FormData, name: string): string | null | "invalid" {
  const v = text(form, name);
  if (v === null) return null;
  return DATE_REGEX.test(v) ? v : "invalid";
}

async function writeAudit(
  locals: App.Locals,
  agencyId: string,
  editorId: string,
  entityType: string,
  entityId: string,
  // Json-compatible: the audit metadata column is jsonb.
  changed: Record<string, string | number | boolean | null>,
): Promise<void> {
  await locals.supabase.from("audit_log").insert({
    agency_id: agencyId,
    actor_type: "user",
    actor_id: editorId,
    action: "rent_roll.updated",
    entity_type: entityType,
    entity_id: entityId,
    metadata: { changed },
  });
}

export const actions: Actions = {
  recordInspection: async ({ request, locals }) => {
    const ctx = await actionContext(locals, request);
    if (isFail(ctx)) return ctx;
    const tenancyId = text(ctx.form, "tenancyId");
    const date = isoDate(ctx.form, "date");
    if (!tenancyId || !UUID_REGEX.test(tenancyId)) return fail(400, { error: "Invalid tenancy." });
    if (date === null || date === "invalid") {
      return fail(400, { error: "Enter the inspection date (YYYY-MM-DD)." });
    }
    const { data, error: err } = await locals.supabase
      .from("tenancies")
      .update({ last_routine_inspection_date: date })
      .eq("agency_id", ctx.agencyId)
      .eq("id", tenancyId)
      .select("id");
    if (err) return fail(500, { error: err.message });
    if (!data || data.length === 0) return fail(404, { error: "Tenancy not found." });
    await writeAudit(locals, ctx.agencyId, ctx.editorId, "tenancies", tenancyId, {
      last_routine_inspection_date: date,
    });
    return { saved: true };
  },

  setArrears: async ({ request, locals }) => {
    const ctx = await actionContext(locals, request);
    if (isFail(ctx)) return ctx;
    const tenancyId = text(ctx.form, "tenancyId");
    const date = isoDate(ctx.form, "date");
    if (!tenancyId || !UUID_REGEX.test(tenancyId)) return fail(400, { error: "Invalid tenancy." });
    if (date === null || date === "invalid") {
      return fail(400, { error: "Enter the date rent fell behind (YYYY-MM-DD)." });
    }
    const { data, error: err } = await locals.supabase
      .from("tenancies")
      .update({ arrears_since: date })
      .eq("agency_id", ctx.agencyId)
      .eq("id", tenancyId)
      .select("id");
    if (err) return fail(500, { error: err.message });
    if (!data || data.length === 0) return fail(404, { error: "Tenancy not found." });
    await writeAudit(locals, ctx.agencyId, ctx.editorId, "tenancies", tenancyId, {
      arrears_since: date,
    });
    return { saved: true };
  },

  clearArrears: async ({ request, locals }) => {
    const ctx = await actionContext(locals, request);
    if (isFail(ctx)) return ctx;
    const tenancyId = text(ctx.form, "tenancyId");
    if (!tenancyId || !UUID_REGEX.test(tenancyId)) return fail(400, { error: "Invalid tenancy." });
    const { data, error: err } = await locals.supabase
      .from("tenancies")
      .update({ arrears_since: null })
      .eq("agency_id", ctx.agencyId)
      .eq("id", tenancyId)
      .select("id");
    if (err) return fail(500, { error: err.message });
    if (!data || data.length === 0) return fail(404, { error: "Tenancy not found." });
    await writeAudit(locals, ctx.agencyId, ctx.editorId, "tenancies", tenancyId, {
      arrears_since: null,
    });
    return { saved: true };
  },

  updateTenancy: async ({ request, locals }) => {
    const ctx = await actionContext(locals, request);
    if (isFail(ctx)) return ctx;
    const tenancyId = text(ctx.form, "tenancyId");
    if (!tenancyId || !UUID_REGEX.test(tenancyId)) return fail(400, { error: "Invalid tenancy." });

    const rentRaw = text(ctx.form, "rentDollars");
    let rentCents: number | null = null;
    if (rentRaw !== null) {
      const dollars = Number(rentRaw);
      if (!Number.isFinite(dollars) || dollars < 0) {
        return fail(400, { error: "Rent must be a non-negative amount." });
      }
      rentCents = Math.round(dollars * 100);
    }
    const freqRaw = text(ctx.form, "rentFrequency");
    if (freqRaw !== null && !RENT_FREQUENCIES.includes(freqRaw as RentFrequency)) {
      return fail(400, { error: "Invalid rent frequency." });
    }
    const startDate = isoDate(ctx.form, "startDate");
    const endDate = isoDate(ctx.form, "endDate");
    if (startDate === "invalid" || endDate === "invalid") {
      return fail(400, { error: "Dates must be YYYY-MM-DD." });
    }
    if (startDate && endDate && endDate < startDate) {
      return fail(400, { error: "Lease end date can't be before the start date." });
    }

    const patch = {
      rent_amount_cents: rentCents,
      rent_frequency: (freqRaw as RentFrequency | null) ?? null,
      start_date: startDate,
      end_date: endDate,
    };
    const { data, error: err } = await locals.supabase
      .from("tenancies")
      .update(patch)
      .eq("agency_id", ctx.agencyId)
      .eq("id", tenancyId)
      .select("id");
    if (err) return fail(500, { error: err.message });
    if (!data || data.length === 0) return fail(404, { error: "Tenancy not found." });
    await writeAudit(locals, ctx.agencyId, ctx.editorId, "tenancies", tenancyId, patch);
    return { saved: true };
  },

  updateOwner: async ({ request, locals }) => {
    const ctx = await actionContext(locals, request);
    if (isFail(ctx)) return ctx;
    const ownerId = text(ctx.form, "ownerId");
    const fullName = text(ctx.form, "fullName");
    if (!ownerId || !UUID_REGEX.test(ownerId)) return fail(400, { error: "Invalid owner." });
    if (!fullName) return fail(400, { error: "Owner name is required." });
    const patch = {
      full_name: fullName,
      email: text(ctx.form, "email"),
      phone: text(ctx.form, "phone"),
    };
    const { data, error: err } = await locals.supabase
      .from("owners")
      .update(patch)
      .eq("agency_id", ctx.agencyId)
      .eq("id", ownerId)
      .select("id");
    if (err) return fail(500, { error: err.message });
    if (!data || data.length === 0) return fail(404, { error: "Owner not found." });
    await writeAudit(locals, ctx.agencyId, ctx.editorId, "owners", ownerId, patch);
    return { saved: true };
  },

  updateTenant: async ({ request, locals }) => {
    const ctx = await actionContext(locals, request);
    if (isFail(ctx)) return ctx;
    const tenantId = text(ctx.form, "tenantId");
    const fullName = text(ctx.form, "fullName");
    if (!tenantId || !UUID_REGEX.test(tenantId)) return fail(400, { error: "Invalid tenant." });
    if (!fullName) return fail(400, { error: "Tenant name is required." });
    const patch = {
      full_name: fullName,
      email: text(ctx.form, "email"),
      phone: text(ctx.form, "phone"),
    };
    const { data, error: err } = await locals.supabase
      .from("tenants")
      .update(patch)
      .eq("agency_id", ctx.agencyId)
      .eq("id", tenantId)
      .select("id");
    if (err) return fail(500, { error: err.message });
    if (!data || data.length === 0) return fail(404, { error: "Tenant not found." });
    await writeAudit(locals, ctx.agencyId, ctx.editorId, "tenants", tenantId, patch);
    return { saved: true };
  },
};
