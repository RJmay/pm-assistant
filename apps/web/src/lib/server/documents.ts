import type { Client } from "@pm/db";

// Server queries for the documents views. Agency-scoped via RLS (authed client).

export interface DocumentListItem {
  id: string;
  type: string;
  form_id: string | null;
  title: string;
  tenancy_id: string | null;
  created_at: string;
}

export interface TenancyOption {
  id: string;
  label: string;
}

/** Generated documents for the agency, newest first. */
export async function fetchDocuments(
  client: Client,
  agencyId: string,
): Promise<DocumentListItem[]> {
  const { data, error } = await client
    .from("documents")
    .select("id, type, form_id, title, tenancy_id, created_at")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`documents fetch failed: ${error.message}`);
  return (data ?? []) as DocumentListItem[];
}

export interface DocumentRecord {
  id: string;
  type: string;
  form_id: string | null;
  title: string;
  content: string;
  rule_versions: string[];
  created_at: string;
  /** Whether a rendered PDF is available for download (0021). */
  hasPdf: boolean;
}

/** One document with its rendered content. */
export async function fetchDocument(
  client: Client,
  agencyId: string,
  id: string,
): Promise<DocumentRecord | null> {
  const { data, error } = await client
    .from("documents")
    .select("id, type, form_id, title, content, rule_versions, created_at, pdf_base64")
    .eq("agency_id", agencyId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`document fetch failed: ${error.message}`);
  if (!data) return null;
  const { pdf_base64, ...rest } = data;
  return { ...rest, hasPdf: Boolean(pdf_base64) };
}

/** Active tenancies as dropdown options ("12 Marine Parade — Alex Tan"). */
export async function fetchTenancyOptions(
  client: Client,
  agencyId: string,
): Promise<TenancyOption[]> {
  const { data: tenancies, error } = await client
    .from("tenancies")
    .select("id, property_id")
    .eq("agency_id", agencyId)
    .eq("status", "active");
  if (error) throw new Error(`tenancies fetch failed: ${error.message}`);
  const rows = tenancies ?? [];
  if (rows.length === 0) return [];

  const propertyIds = [...new Set(rows.map((t) => t.property_id).filter((p): p is string => !!p))];
  const tenancyIds = rows.map((t) => t.id);

  const [{ data: properties }, { data: tenants }] = await Promise.all([
    propertyIds.length > 0
      ? client
          .from("properties")
          .select("id, address_line1, suburb")
          .eq("agency_id", agencyId)
          .in("id", propertyIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; address_line1: string; suburb: string | null }>,
        }),
    client
      .from("tenants")
      .select("tenancy_id, full_name, is_primary")
      .eq("agency_id", agencyId)
      .in("tenancy_id", tenancyIds),
  ]);

  const addr = new Map(
    (properties ?? []).map((p) => [
      p.id,
      [p.address_line1, p.suburb].filter((x) => x && x.trim() !== "").join(", "),
    ]),
  );
  const primaryTenant = new Map<string, string>();
  for (const t of tenants ?? []) {
    if (!t.tenancy_id) continue;
    if (t.is_primary || !primaryTenant.has(t.tenancy_id)) {
      primaryTenant.set(t.tenancy_id, t.full_name);
    }
  }

  return rows.map((t) => {
    const address = t.property_id
      ? (addr.get(t.property_id) ?? "Unknown property")
      : "Unknown property";
    const tenant = primaryTenant.get(t.id);
    return { id: t.id, label: tenant ? `${address} — ${tenant}` : address };
  });
}
