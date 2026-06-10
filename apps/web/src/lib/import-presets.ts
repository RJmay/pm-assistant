// Portfolio-import column mapping: canonical fields, header presets for the
// common QLD trust-accounting exports (PropertyMe, Console Cloud, VaultRE),
// auto-detection, and per-row validation. Pure functions — unit-tested.

export const IMPORT_FIELDS = [
  "address_line1",
  "suburb",
  "postcode",
  "owner_name",
  "owner_email",
  "owner_phone",
  "tenant_name",
  "tenant_email",
  "tenant_phone",
  "rent_weekly",
  "lease_start",
  "lease_end",
  "bond",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABELS: Record<ImportField, string> = {
  address_line1: "Street address",
  suburb: "Suburb",
  postcode: "Postcode",
  owner_name: "Owner name",
  owner_email: "Owner email",
  owner_phone: "Owner phone",
  tenant_name: "Tenant name",
  tenant_email: "Tenant email",
  tenant_phone: "Tenant phone",
  rent_weekly: "Rent ($/week)",
  lease_start: "Lease start",
  lease_end: "Lease end",
  bond: "Bond ($)",
};

export const REQUIRED_FIELDS: ImportField[] = ["address_line1", "owner_name"];

/** header → canonical field synonyms, normalised (lowercase, alphanumeric only). */
const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  address_line1: ["propertyaddress", "address", "streetaddress", "property", "addressline1"],
  suburb: ["suburb", "city", "locality"],
  postcode: ["postcode", "postalcode", "pcode", "zip"],
  owner_name: ["ownername", "owner", "ownership", "landlord", "landlordname", "lessor"],
  owner_email: ["owneremail", "landlordemail", "lessoremail", "ownersemail"],
  owner_phone: [
    "ownerphone",
    "ownermobile",
    "landlordphone",
    "landlordmobile",
    "ownercontact",
    "lessorphone",
  ],
  tenant_name: ["tenantname", "tenant", "tenants", "primarytenant"],
  tenant_email: ["tenantemail", "tenantsemail", "email"],
  tenant_phone: ["tenantphone", "tenantmobile", "tenantcontact", "mobile", "phone"],
  rent_weekly: ["rent", "weeklyrent", "rentamount", "rentalamount", "rentpw", "rentperweek"],
  lease_start: [
    "leasestart",
    "tenancystart",
    "leasecommencement",
    "agreementstart",
    "leasestartdate",
  ],
  lease_end: [
    "leaseend",
    "tenancyend",
    "leaseexpiry",
    "vacatedate",
    "agreementend",
    "leaseenddate",
  ],
  bond: ["bond", "bondamount", "bondheld", "bondlodged"],
};

/** Named presets — used for the "looks like a PropertyMe export" hint. */
export const PRESETS: Array<{ id: string; label: string; signatureHeaders: string[] }> = [
  {
    id: "propertyme",
    label: "PropertyMe",
    signatureHeaders: ["propertyaddress", "ownername", "tenantname"],
  },
  {
    id: "console",
    label: "Console Cloud",
    signatureHeaders: ["address", "landlord", "weeklyrent"],
  },
  {
    id: "vaultre",
    label: "VaultRE",
    signatureHeaders: ["property", "owner", "rentalamount"],
  },
];

export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type Mapping = Partial<Record<ImportField, number>>;

/** Auto-map CSV headers to canonical fields via the synonym table. */
export function detectMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const normalised = headers.map(normaliseHeader);
  for (const field of IMPORT_FIELDS) {
    // Synonyms are listed specific → generic; try them IN ORDER so a generic
    // header ("Email", "Phone", "Property") can't steal a field when a more
    // specific column ("Tenant Email", "Owner Phone") exists in the file.
    // A column can only serve one field.
    for (const synonym of HEADER_SYNONYMS[field]) {
      const idx = normalised.findIndex(
        (h, i) => h === synonym && !Object.values(mapping).includes(i),
      );
      if (idx !== -1) {
        mapping[field] = idx;
        break;
      }
    }
  }
  return mapping;
}

/** Which preset (if any) these headers most resemble. */
export function detectPreset(headers: string[]): string | null {
  const normalised = new Set(headers.map(normaliseHeader));
  let best: { id: string; score: number } | null = null;
  for (const preset of PRESETS) {
    const score = preset.signatureHeaders.filter((h) => normalised.has(h)).length;
    if (score >= 2 && (best === null || score > best.score)) best = { id: preset.id, score };
  }
  return best?.id ?? null;
}

export interface ImportRow {
  address_line1: string;
  suburb: string | null;
  postcode: string | null;
  owner_name: string;
  owner_email: string | null;
  owner_phone: string | null;
  tenant_name: string | null;
  tenant_email: string | null;
  tenant_phone: string | null;
  rent_weekly: number | null;
  lease_start: string | null;
  lease_end: string | null;
  bond: number | null;
}

export interface RowResult {
  row: ImportRow | null;
  errors: string[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "12/03/2026" (AU), "2026-03-12", "12-03-2026" → ISO date; null if blank; undefined if invalid. */
export function parseAuDate(value: string): string | null | undefined {
  const v = value.trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return v;
  const au = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (au) {
    const [, d, m, y] = au;
    const day = Number(d);
    const month = Number(m);
    if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return undefined;
}

function parseMoney(value: string): number | null | undefined {
  const v = value.trim().replace(/[$,\s]/g, "");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/** Validate + coerce one CSV record against a mapping. */
export function validateRow(record: string[], mapping: Mapping): RowResult {
  const get = (field: ImportField): string => {
    const idx = mapping[field];
    return idx === undefined ? "" : (record[idx] ?? "").trim();
  };
  const errors: string[] = [];

  const address = get("address_line1");
  if (!address) errors.push("Street address is required");
  const ownerName = get("owner_name");
  if (!ownerName) errors.push("Owner name is required");

  const ownerEmail = get("owner_email");
  if (ownerEmail && !EMAIL_REGEX.test(ownerEmail)) errors.push("Owner email looks invalid");
  const tenantEmail = get("tenant_email");
  if (tenantEmail && !EMAIL_REGEX.test(tenantEmail)) errors.push("Tenant email looks invalid");

  const rent = parseMoney(get("rent_weekly"));
  if (rent === undefined) errors.push("Rent must be a number");
  const bond = parseMoney(get("bond"));
  if (bond === undefined) errors.push("Bond must be a number");

  const leaseStart = parseAuDate(get("lease_start"));
  if (leaseStart === undefined) errors.push("Lease start must be a date (DD/MM/YYYY)");
  const leaseEnd = parseAuDate(get("lease_end"));
  if (leaseEnd === undefined) errors.push("Lease end must be a date (DD/MM/YYYY)");

  if (errors.length > 0) return { row: null, errors };
  return {
    row: {
      address_line1: address,
      suburb: get("suburb") || null,
      postcode: get("postcode") || null,
      owner_name: ownerName,
      owner_email: ownerEmail || null,
      owner_phone: get("owner_phone") || null,
      tenant_name: get("tenant_name") || null,
      tenant_email: tenantEmail || null,
      tenant_phone: get("tenant_phone") || null,
      rent_weekly: rent ?? null,
      lease_start: leaseStart ?? null,
      lease_end: leaseEnd ?? null,
      bond: bond ?? null,
    },
    errors: [],
  };
}
