import type { Client } from "@pm/db";

// ============================================================================
// Shared entity resolvers for outbound sequences
// ============================================================================
// The tenant/property/PM lookups every tenancy-scoped sequence needs. Each is
// agency-scoped (service-role client bypasses RLS).
// ============================================================================

export interface Recipient {
  name: string;
  email: string;
}

/**
 * The tenant a sequence should write to: the primary tenant with an email, or
 * the first contactable one. Returns null when no tenant on the tenancy has an
 * email — the caller decides whether to skip.
 */
export async function resolvePrimaryTenant(
  client: Client,
  agencyId: string,
  tenancyId: string,
): Promise<Recipient | null> {
  const { data, error } = await client
    .from("tenants")
    .select("full_name, email, is_primary")
    .eq("agency_id", agencyId)
    .eq("tenancy_id", tenancyId);
  if (error) throw new Error(`tenants lookup failed: ${error.message}`);
  const withEmail = (data ?? []).filter((t) => t.email && t.email.trim() !== "");
  const chosen = withEmail.find((t) => t.is_primary) ?? withEmail[0];
  if (!chosen?.email) return null;
  return { name: chosen.full_name, email: chosen.email };
}

/** A human property address ("12 Marine Parade, Maroochydore"), or a safe generic. */
export async function resolvePropertyAddress(
  client: Client,
  agencyId: string,
  propertyId: string | null,
): Promise<string> {
  if (!propertyId) return "your property";
  const { data } = await client
    .from("properties")
    .select("address_line1, suburb")
    .eq("agency_id", agencyId)
    .eq("id", propertyId)
    .maybeSingle();
  if (!data) return "your property";
  return [data.address_line1, data.suburb].filter((p) => p && p.trim() !== "").join(", ");
}

/** The property's managing PM, then any active PM, then a safe generic. */
export async function resolvePmName(
  client: Client,
  agencyId: string,
  propertyId: string | null,
): Promise<string> {
  if (propertyId) {
    const { data: property } = await client
      .from("properties")
      .select("managing_pm_id")
      .eq("agency_id", agencyId)
      .eq("id", propertyId)
      .maybeSingle();
    if (property?.managing_pm_id) {
      const { data: pm } = await client
        .from("agency_users")
        .select("full_name")
        .eq("agency_id", agencyId)
        .eq("id", property.managing_pm_id)
        .maybeSingle();
      if (pm?.full_name) return pm.full_name;
    }
  }
  const { data: anyPm } = await client
    .from("agency_users")
    .select("full_name")
    .eq("agency_id", agencyId)
    .eq("role", "pm")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  return anyPm?.full_name ?? "your property manager";
}
