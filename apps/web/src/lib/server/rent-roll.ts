import type { Client } from "@pm/db";
import {
  buildRentRoll,
  type PropertyListItem,
  type RentRollTenancyRow,
  type RentRollTenantRow,
} from "$lib/rent-roll";
import type { Owner, Property, RentFrequency, TenancyStatus } from "$lib/types";

// Server queries for the rent-roll views. Agency-scoped via RLS (authed
// client) + explicit agency_id filters (belt-and-braces, like every other
// $lib/server module).

const TENANCY_COLUMNS =
  "id, property_id, status, start_date, end_date, rent_amount_cents, rent_frequency, agreement_type, arrears_since, last_routine_inspection_date, bond_amount_cents, bond_rta_reference";

/** Every non-archived property, assembled into list rows. */
export async function fetchRentRoll(client: Client, agencyId: string): Promise<PropertyListItem[]> {
  const [properties, owners, tenancies, tenants] = await Promise.all([
    client
      .from("properties")
      .select("id, address_line1, suburb, postcode, owner_id")
      .eq("agency_id", agencyId)
      .is("archived_at", null),
    client.from("owners").select("id, full_name").eq("agency_id", agencyId),
    client
      .from("tenancies")
      .select(
        "id, property_id, status, start_date, end_date, rent_amount_cents, rent_frequency, arrears_since, last_routine_inspection_date",
      )
      .eq("agency_id", agencyId),
    client
      .from("tenants")
      .select("tenancy_id, full_name, email, is_primary")
      .eq("agency_id", agencyId),
  ]);
  for (const r of [properties, owners, tenancies, tenants]) {
    if (r.error) throw new Error(`rent roll fetch failed: ${r.error.message}`);
  }
  return buildRentRoll(
    properties.data ?? [],
    owners.data ?? [],
    (tenancies.data ?? []) as RentRollTenancyRow[],
    (tenants.data ?? []) as RentRollTenantRow[],
  );
}

export interface TenancyDetail {
  id: string;
  property_id: string;
  status: TenancyStatus;
  start_date: string | null;
  end_date: string | null;
  rent_amount_cents: number | null;
  rent_frequency: RentFrequency | null;
  agreement_type: "fixed" | "periodic" | null;
  arrears_since: string | null;
  last_routine_inspection_date: string | null;
  bond_amount_cents: number | null;
  bond_rta_reference: string | null;
  tenants: TenantDetail[];
}

export interface TenantDetail {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  is_primary: boolean | null;
}

export interface ActivityItem {
  id: string;
  title: string;
  when: string;
  badge: string | null;
}

export interface PropertyDetail {
  property: Pick<
    Property,
    | "id"
    | "address_line1"
    | "address_line2"
    | "suburb"
    | "postcode"
    | "state"
    | "notes"
    | "owner_id"
  >;
  owner: Pick<Owner, "id" | "full_name" | "email" | "phone"> | null;
  tenancies: TenancyDetail[];
  activity: { drafts: ActivityItem[]; jobs: ActivityItem[]; documents: ActivityItem[] };
}

/** One property with its owner, tenancies (+tenants) and recent activity. */
export async function fetchPropertyDetail(
  client: Client,
  agencyId: string,
  propertyId: string,
): Promise<PropertyDetail | null> {
  const { data: property, error: propErr } = await client
    .from("properties")
    .select("id, address_line1, address_line2, suburb, postcode, state, notes, owner_id")
    .eq("agency_id", agencyId)
    .eq("id", propertyId)
    .maybeSingle();
  if (propErr) throw new Error(`property fetch failed: ${propErr.message}`);
  if (!property) return null;

  const [ownerRes, tenanciesRes, draftsRes, jobsRes, documentsRes] = await Promise.all([
    property.owner_id
      ? client
          .from("owners")
          .select("id, full_name, email, phone")
          .eq("agency_id", agencyId)
          .eq("id", property.owner_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    client
      .from("tenancies")
      .select(TENANCY_COLUMNS)
      .eq("agency_id", agencyId)
      .eq("property_id", propertyId)
      .order("start_date", { ascending: false, nullsFirst: false }),
    client
      .from("ai_drafts")
      .select("id, draft_subject, category, status, created_at")
      .eq("agency_id", agencyId)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(5),
    client
      .from("maintenance_jobs")
      .select("id, issue, state, created_at")
      .eq("agency_id", agencyId)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(5),
    client
      .from("documents")
      .select("id, title, type, created_at")
      .eq("agency_id", agencyId)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  for (const r of [ownerRes, tenanciesRes, draftsRes, jobsRes, documentsRes]) {
    if (r.error) throw new Error(`property detail fetch failed: ${r.error.message}`);
  }

  const tenancyRows = tenanciesRes.data ?? [];
  const tenancyIds = tenancyRows.map((t) => t.id);
  let tenantsByTenancy = new Map<string, TenantDetail[]>();
  if (tenancyIds.length > 0) {
    const { data: tenantRows, error: tenantsErr } = await client
      .from("tenants")
      .select("id, tenancy_id, full_name, email, phone, is_primary")
      .eq("agency_id", agencyId)
      .in("tenancy_id", tenancyIds);
    if (tenantsErr) throw new Error(`tenants fetch failed: ${tenantsErr.message}`);
    tenantsByTenancy = new Map();
    for (const t of tenantRows ?? []) {
      if (!t.tenancy_id) continue;
      const list = tenantsByTenancy.get(t.tenancy_id) ?? [];
      list.push({
        id: t.id,
        full_name: t.full_name,
        email: t.email,
        phone: t.phone,
        is_primary: t.is_primary,
      });
      tenantsByTenancy.set(t.tenancy_id, list);
    }
    for (const list of tenantsByTenancy.values()) {
      list.sort((a, b) => Number(b.is_primary ?? false) - Number(a.is_primary ?? false));
    }
  }

  return {
    property,
    owner: ownerRes.data ?? null,
    tenancies: tenancyRows.map(
      (t): TenancyDetail => ({
        ...(t as Omit<TenancyDetail, "tenants">),
        tenants: tenantsByTenancy.get(t.id) ?? [],
      }),
    ),
    activity: {
      drafts: (draftsRes.data ?? []).map((d) => ({
        id: d.id,
        title: d.draft_subject ?? "(no subject)",
        when: d.created_at,
        badge: d.status,
      })),
      jobs: (jobsRes.data ?? []).map((j) => ({
        id: j.id,
        title: j.issue,
        when: j.created_at,
        badge: j.state,
      })),
      documents: (documentsRes.data ?? []).map((doc) => ({
        id: doc.id,
        title: doc.title,
        when: doc.created_at,
        badge: null,
      })),
    },
  };
}
