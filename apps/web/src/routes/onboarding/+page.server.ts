import type { Json } from "@pm/db";
import { fail, redirect } from "@sveltejs/kit";
import { type ImportRow, REQUIRED_FIELDS } from "$lib/import-presets";
import { WIZARD_STEPS, type WizardStep } from "$lib/onboarding";
import { env } from "$lib/public-env";
import type { Actions, PageServerLoad } from "./$types";

// ============================================================================
// Onboarding wizard — server side.
// ============================================================================
// Steps: account → connect-email → import → voice → first-draft (registry in
// $lib/onboarding — +page.server.ts may only export route handlers). Progress
// is persisted in onboarding_progress (RLS-scoped) so the wizard survives
// refresh/logout and every step is skippable + resumable. Plain DB writes go
// through locals.supabase (RLS); the two side-effectful operations (agency
// provisioning, the first-draft injection) call the Worker with the caller's
// own access token.

const workerUrl = () => (env.PUBLIC_WORKER_URL ?? "").replace(/\/+$/, "");

export const load: PageServerLoad = async ({ locals }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) {
    // Fresh signup: no tenant yet — the only available step is "account".
    return {
      step: "account" as WizardStep,
      completedSteps: [] as string[],
      agencyName: null,
      mailboxAddress: null,
      propertyCount: 0,
      repairerSet: false,
      voice: null,
      firstDraftId: null,
    };
  }

  const [progressRes, agencyRes, configRes, stateRes, propsRes] = await Promise.all([
    locals.supabase
      .from("onboarding_progress")
      .select("current_step, completed_steps, data")
      .eq("agency_id", agencyId)
      .maybeSingle(),
    locals.supabase
      .from("agencies")
      .select("name, suburb, business_hours, after_hours_emergency_line")
      .eq("id", agencyId)
      .maybeSingle(),
    locals.supabase
      .from("agency_config")
      .select("nominated_repairer, pm_signoff_default, house_rules")
      .eq("agency_id", agencyId)
      .maybeSingle(),
    locals.supabase
      .from("agency_email_state")
      .select("mailbox_address")
      .eq("agency_id", agencyId)
      .maybeSingle(),
    locals.supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agencyId),
  ]);

  const progress = progressRes.data;
  const completedSteps = Array.isArray(progress?.completed_steps)
    ? (progress.completed_steps as string[])
    : [];
  const progressData = (progress?.data ?? {}) as Record<string, unknown>;
  const step = (WIZARD_STEPS as readonly string[]).includes(progress?.current_step ?? "")
    ? (progress?.current_step as WizardStep)
    : "connect-email";

  return {
    step,
    completedSteps,
    agencyName: agencyRes.data?.name ?? null,
    mailboxAddress: stateRes.data?.mailbox_address ?? null,
    propertyCount: propsRes.count ?? 0,
    repairerSet: Boolean(configRes.data?.nominated_repairer),
    voice: {
      signoff: configRes.data?.pm_signoff_default ?? "Kind regards,",
      houseRules: configRes.data?.house_rules ?? "",
      businessHours: agencyRes.data?.business_hours ?? "",
      afterHours: agencyRes.data?.after_hours_emergency_line ?? "",
      // house_rules round-trip: saveVoice packs "- Tone: X" as the first line;
      // split it back out so a re-save never wipes what's already there.
      ...splitHouseRules(configRes.data?.house_rules ?? ""),
    },
    firstDraftId: typeof progressData.firstDraftId === "string" ? progressData.firstDraftId : null,
  };
};

/** Inverse of saveVoice's packing: "- Tone: X\n<rest>" → { tone, extraRules }. */
function splitHouseRules(houseRules: string): { tone: string; extraRules: string } {
  const match = /^- Tone: (.+)\n?/.exec(houseRules);
  if (!match) return { tone: "professional, warm", extraRules: houseRules };
  return {
    tone: match[1]?.trim() ?? "professional, warm",
    extraRules: houseRules.slice(match[0].length),
  };
}

async function saveProgress(
  locals: App.Locals,
  agencyId: string,
  patch: { step?: WizardStep; complete?: WizardStep; data?: Record<string, unknown> },
): Promise<void> {
  const { data: existing } = await locals.supabase
    .from("onboarding_progress")
    .select("completed_steps, data")
    .eq("agency_id", agencyId)
    .maybeSingle();
  const completed = new Set(
    Array.isArray(existing?.completed_steps) ? (existing.completed_steps as string[]) : [],
  );
  if (patch.complete) completed.add(patch.complete);
  const mergedData = {
    ...((existing?.data ?? {}) as Record<string, unknown>),
    ...(patch.data ?? {}),
  };
  await locals.supabase.from("onboarding_progress").upsert(
    {
      agency_id: agencyId,
      ...(patch.step ? { current_step: patch.step } : {}),
      completed_steps: [...completed] as unknown as Json,
      data: mergedData as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "agency_id" },
  );
}

export const actions: Actions = {
  // ---- Step 1: create the agency (Worker, service-role side effects) -------
  provision: async ({ request, locals, fetch }) => {
    if (locals.agencyId) redirect(303, "/onboarding");
    if (!locals.session) return fail(401, { error: "Sign in first." });
    const form = await request.formData();
    const agencyName = String(form.get("agencyName") ?? "").trim();
    const suburb = String(form.get("suburb") ?? "").trim();
    const fullName = String(form.get("fullName") ?? "").trim();
    if (agencyName.length < 2) return fail(400, { error: "Enter your agency's name." });

    const res = await fetch(`${workerUrl()}/api/onboarding/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${locals.session.access_token}`,
      },
      body: JSON.stringify({
        agencyName,
        suburb: suburb || undefined,
        fullName: fullName || undefined,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return fail(res.status === 503 ? 503 : 500, {
        error: body.error ?? "Could not create your agency — try again.",
      });
    }
    // Pick up the new app_metadata.agency_id claim, then re-enter the wizard.
    await locals.supabase.auth.refreshSession();
    redirect(303, "/onboarding");
  },

  // ---- Navigation: persist the current step / mark one complete ------------
  goto: async ({ request, locals }) => {
    const agencyId = locals.agencyId;
    if (!agencyId) return fail(403, { error: "No agency yet." });
    const form = await request.formData();
    const step = String(form.get("step") ?? "");
    const complete = String(form.get("complete") ?? "");
    if (!(WIZARD_STEPS as readonly string[]).includes(step)) {
      return fail(400, { error: "Unknown step." });
    }
    await saveProgress(locals, agencyId, {
      step: step as WizardStep,
      ...(complete && (WIZARD_STEPS as readonly string[]).includes(complete)
        ? { complete: complete as WizardStep }
        : {}),
    });
    return { saved: true };
  },

  // ---- Step 3: import the portfolio (validated rows from the mapper) -------
  importRows: async ({ request, locals }) => {
    const agencyId = locals.agencyId;
    if (!agencyId) return fail(403, { error: "No agency yet." });
    const form = await request.formData();
    let rows: ImportRow[];
    try {
      rows = JSON.parse(String(form.get("rows") ?? "[]")) as ImportRow[];
    } catch {
      return fail(400, { error: "Rows payload was malformed." });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return fail(400, { error: "Nothing to import." });
    }
    if (rows.length > 1000) return fail(400, { error: "Import is capped at 1000 rows." });

    // Server-side re-validation of the required fields (client already
    // filtered; never trust it).
    for (const row of rows) {
      for (const field of REQUIRED_FIELDS) {
        if (!String(row[field] ?? "").trim()) {
          return fail(400, { error: `A row is missing ${field}.` });
        }
      }
    }

    // Idempotency: a retry after a mid-batch failure (or a double-click) must
    // not duplicate the portfolio. Skip any address that already exists.
    const { data: existingProps } = await locals.supabase
      .from("properties")
      .select("address_line1")
      .eq("agency_id", agencyId);
    const existingAddresses = new Set(
      (existingProps ?? []).map((p) => p.address_line1.trim().toLowerCase()),
    );

    // Owners dedupe by name+email within the batch.
    const ownerKey = (r: ImportRow) => `${r.owner_name}|${r.owner_email ?? ""}`.toLowerCase();
    const ownerIds = new Map<string, string>();
    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const addressKey = row.address_line1.trim().toLowerCase();
      if (existingAddresses.has(addressKey)) {
        skipped += 1;
        continue;
      }
      existingAddresses.add(addressKey);

      const key = ownerKey(row);
      let ownerId = ownerIds.get(key);
      if (!ownerId) {
        const { data: owner, error: ownerErr } = await locals.supabase
          .from("owners")
          .insert({
            agency_id: agencyId,
            full_name: row.owner_name,
            email: row.owner_email,
            phone: row.owner_phone,
          })
          .select("id")
          .maybeSingle();
        if (ownerErr || !owner)
          return fail(500, { error: `Owner insert failed: ${ownerErr?.message}` });
        ownerId = owner.id;
        ownerIds.set(key, ownerId);
      }

      const { data: property, error: propErr } = await locals.supabase
        .from("properties")
        .insert({
          agency_id: agencyId,
          owner_id: ownerId,
          address_line1: row.address_line1,
          suburb: row.suburb,
          postcode: row.postcode,
          state: "QLD",
        })
        .select("id")
        .maybeSingle();
      if (propErr || !property) {
        return fail(500, { error: `Property insert failed: ${propErr?.message}` });
      }

      if (row.tenant_name || row.rent_weekly !== null) {
        const { data: tenancy, error: tenancyErr } = await locals.supabase
          .from("tenancies")
          .insert({
            agency_id: agencyId,
            property_id: property.id,
            status: "active",
            rent_amount_cents: row.rent_weekly !== null ? Math.round(row.rent_weekly * 100) : null,
            rent_frequency: row.rent_weekly !== null ? "weekly" : null,
            start_date: row.lease_start,
            end_date: row.lease_end,
            agreement_type: row.lease_end ? "fixed" : "periodic",
            bond_amount_cents: row.bond !== null ? Math.round(row.bond * 100) : null,
          })
          .select("id")
          .maybeSingle();
        if (tenancyErr || !tenancy) {
          return fail(500, { error: `Tenancy insert failed: ${tenancyErr?.message}` });
        }
        if (row.tenant_name) {
          const { error: tenantErr } = await locals.supabase.from("tenants").insert({
            agency_id: agencyId,
            tenancy_id: tenancy.id,
            full_name: row.tenant_name,
            email: row.tenant_email,
            phone: row.tenant_phone,
            is_primary: true,
          });
          if (tenantErr) return fail(500, { error: `Tenant insert failed: ${tenantErr.message}` });
        }
      }
      imported += 1;
    }

    await saveProgress(locals, agencyId, {
      step: "voice",
      complete: "import",
      data: { importedRows: imported },
    });
    return { imported, skipped };
  },

  // ---- Step 3 alternative: sample data --------------------------------------
  sampleData: async ({ locals }) => {
    const agencyId = locals.agencyId;
    if (!agencyId) return fail(403, { error: "No agency yet." });
    const sampleAddress = "Sample: 1 Example Street";
    const { data: existing } = await locals.supabase
      .from("properties")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("address_line1", sampleAddress)
      .maybeSingle();
    if (!existing) {
      const { data: owner } = await locals.supabase
        .from("owners")
        .insert({
          agency_id: agencyId,
          full_name: "Sample Owner",
          email: "sample.owner@example.com",
          notes: "Created by the onboarding wizard — safe to delete.",
        })
        .select("id")
        .maybeSingle();
      const { data: property } = await locals.supabase
        .from("properties")
        .insert({
          agency_id: agencyId,
          owner_id: owner?.id ?? null,
          address_line1: sampleAddress,
          suburb: "Maroochydore",
          postcode: "4558",
          state: "QLD",
          notes: "Created by the onboarding wizard — safe to delete.",
        })
        .select("id")
        .maybeSingle();
      if (property) {
        const { data: tenancy } = await locals.supabase
          .from("tenancies")
          .insert({
            agency_id: agencyId,
            property_id: property.id,
            status: "active",
            rent_amount_cents: 65000,
            rent_frequency: "weekly",
            agreement_type: "periodic",
          })
          .select("id")
          .maybeSingle();
        if (tenancy) {
          await locals.supabase.from("tenants").insert({
            agency_id: agencyId,
            tenancy_id: tenancy.id,
            full_name: "Sam Sample",
            email: "sam.sample@example.com",
            is_primary: true,
          });
        }
      }
    }
    await saveProgress(locals, agencyId, { step: "voice", complete: "import" });
    return { sample: true };
  },

  // ---- Step 4: voice & guardrails -------------------------------------------
  saveVoice: async ({ request, locals }) => {
    const agencyId = locals.agencyId;
    if (!agencyId) return fail(403, { error: "No agency yet." });
    const form = await request.formData();
    const tone = String(form.get("tone") ?? "professional, warm").trim();
    const signoff = String(form.get("signoff") ?? "Kind regards,").trim() || "Kind regards,";
    const businessHours = String(form.get("businessHours") ?? "").trim();
    const afterHours = String(form.get("afterHours") ?? "").trim();
    const repairerName = String(form.get("repairerName") ?? "").trim();
    const repairerPhone = String(form.get("repairerPhone") ?? "").trim();
    const extraRules = String(form.get("houseRules") ?? "").trim();

    const houseRules = [`- Tone: ${tone}`, extraRules].filter(Boolean).join("\n");

    // .select() so an RLS no-op (0 rows matched) fails LOUDLY instead of
    // silently discarding the business hours / after-hours line.
    const { data: agencyUpdated, error: agencyErr } = await locals.supabase
      .from("agencies")
      .update({
        business_hours: businessHours || null,
        after_hours_emergency_line: afterHours || null,
      })
      .eq("id", agencyId)
      .select("id");
    if (agencyErr) return fail(500, { error: agencyErr.message });
    if (!agencyUpdated || agencyUpdated.length === 0) {
      return fail(500, {
        error: "Agency settings could not be saved (no row updated) — contact support.",
      });
    }

    const { error: configErr } = await locals.supabase
      .from("agency_config")
      .update({
        pm_signoff_default: signoff,
        house_rules: houseRules,
        ...(repairerName && repairerPhone
          ? { nominated_repairer: { name: repairerName, number: repairerPhone } as unknown as Json }
          : {}),
      })
      .eq("agency_id", agencyId);
    if (configErr) return fail(500, { error: configErr.message });

    await saveProgress(locals, agencyId, { step: "first-draft", complete: "voice" });
    return { saved: true };
  },

  // ---- Step 5: the first-draft moment (Worker: real pipeline) ---------------
  firstDraft: async ({ locals, fetch }) => {
    const agencyId = locals.agencyId;
    if (!agencyId) return fail(403, { error: "No agency yet." });
    if (!locals.session) return fail(401, { error: "Sign in first." });
    const res = await fetch(`${workerUrl()}/api/onboarding/first-draft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${locals.session.access_token}`,
      },
      body: JSON.stringify({}),
    });
    const body = (await res.json().catch(() => ({}))) as { draftId?: string; error?: string };
    if (!res.ok || !body.draftId) {
      return fail(res.status === 409 ? 409 : 500, {
        error: body.error ?? "The first draft could not be created — try again.",
      });
    }
    await saveProgress(locals, agencyId, {
      step: "first-draft",
      complete: "first-draft",
      data: { firstDraftId: body.draftId },
    });
    return { draftId: body.draftId };
  },
};
