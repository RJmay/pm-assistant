import type { Json } from "@pm/db";
import { error, fail } from "@sveltejs/kit";
import type { LeanNote, QuoteException, Tradie, VoiceSample } from "$lib/types";
import type { Actions, PageServerLoad } from "./$types";

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normaliseTradies(v: unknown): Tradie[] {
  return asArray(v)
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      return {
        trade: str(o.trade).trim(),
        name: str(o.name).trim(),
        business_hours_contact: str(o.business_hours_contact).trim() || undefined,
        after_hours_contact: str(o.after_hours_contact).trim() || undefined,
      };
    })
    .filter((t) => t.trade !== "" && t.name !== "");
}
function normaliseVoice(v: unknown): VoiceSample[] {
  return asArray(v)
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      return { label: str(o.label).trim(), body: str(o.body).trim() };
    })
    .filter((s) => s.body !== "");
}
function normaliseLeans(v: unknown): LeanNote[] {
  return asArray(v).map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return { topic: str(o.topic), lean: str(o.lean), expires_at: str(o.expires_at) };
  });
}
function normaliseExceptions(v: unknown): QuoteException[] {
  return asArray(v)
    .map((raw) => ({ note: str((raw as Record<string, unknown>)?.note) }))
    .filter((e) => e.note !== "");
}

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

  const { data, error: cfgErr } = await locals.supabase
    .from("agency_config")
    .select(
      "voice_samples, approved_tradies, nominated_repairer, routine_approval_threshold_cents, written_quote_threshold_cents, per_owner_quote_exceptions, house_rules, lean_notes",
    )
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (cfgErr) error(500, cfgErr.message);

  return {
    isAdmin: await isAdminUser(locals, agencyId),
    tradies: normaliseTradies(data?.approved_tradies),
    voiceSamples: normaliseVoice(data?.voice_samples),
    leanNotes: normaliseLeans(data?.lean_notes),
    quoteExceptions: normaliseExceptions(data?.per_owner_quote_exceptions),
    routineThresholdDollars: (data?.routine_approval_threshold_cents ?? 0) / 100,
    writtenThresholdDollars: (data?.written_quote_threshold_cents ?? 0) / 100,
    houseRules: data?.house_rules ?? "",
    hasNominatedRepairer: data?.nominated_repairer != null,
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const agencyId = locals.agencyId;
    if (!agencyId) return fail(403, { error: "No agency context" });
    if (!(await isAdminUser(locals, agencyId))) {
      return fail(403, { error: "Only an agency admin or principal can change settings." });
    }

    const form = await request.formData();
    const routineDollars = Number(form.get("routine_dollars"));
    const writtenDollars = Number(form.get("written_dollars"));
    if (!Number.isFinite(routineDollars) || routineDollars < 0) {
      return fail(400, { error: "Routine approval threshold must be a non-negative number." });
    }
    if (!Number.isFinite(writtenDollars) || writtenDollars < 0) {
      return fail(400, { error: "Written quote threshold must be a non-negative number." });
    }

    let tradies: Tradie[];
    let voice: VoiceSample[];
    try {
      tradies = normaliseTradies(JSON.parse(str(form.get("approved_tradies")) || "[]"));
      voice = normaliseVoice(JSON.parse(str(form.get("voice_samples")) || "[]"));
    } catch {
      return fail(400, { error: "Could not parse tradies or voice samples." });
    }

    const houseRules = str(form.get("house_rules")).trim() || null;

    const { error: updErr } = await locals.supabase
      .from("agency_config")
      .update({
        // jsonb columns: the generated `Json` type rejects our structured
        // interfaces (no index signature); cast at the boundary.
        approved_tradies: tradies as unknown as Json,
        voice_samples: voice as unknown as Json,
        routine_approval_threshold_cents: Math.round(routineDollars * 100),
        written_quote_threshold_cents: Math.round(writtenDollars * 100),
        house_rules: houseRules,
      })
      .eq("agency_id", agencyId);
    if (updErr) return fail(500, { error: updErr.message });

    return { saved: true };
  },
};
