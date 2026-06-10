import type { RentFrequency, TenancyStatus } from "./types";

// Pure rent-roll logic: assembling the property list from raw rows and the
// derived indicators (current tenancy, inspection due, arrears) that drive the
// outbound sequences. Server queries live in $lib/server/rent-roll.ts.

export interface RentRollPropertyRow {
  id: string;
  address_line1: string;
  suburb: string | null;
  postcode: string | null;
  owner_id: string | null;
}

export interface RentRollOwnerRow {
  id: string;
  full_name: string;
}

export interface RentRollTenancyRow {
  id: string;
  property_id: string;
  status: TenancyStatus;
  start_date: string | null;
  end_date: string | null;
  rent_amount_cents: number | null;
  rent_frequency: RentFrequency | null;
  arrears_since: string | null;
  last_routine_inspection_date: string | null;
}

export interface RentRollTenantRow {
  tenancy_id: string | null;
  full_name: string;
  email: string | null;
  is_primary: boolean | null;
}

/** One row of the /properties list. */
export interface PropertyListItem {
  id: string;
  addressLine1: string;
  suburb: string | null;
  postcode: string | null;
  ownerName: string | null;
  tenancyId: string | null;
  tenancyStatus: TenancyStatus | null;
  rentCents: number | null;
  rentFrequency: RentFrequency | null;
  endDate: string | null;
  arrearsSince: string | null;
  inspectionDue: string | null;
  tenantNames: string[];
}

// "Current" tenancy = the one a PM means when they say "the tenancy at X".
const TENANCY_RANK: Record<TenancyStatus, number> = { active: 0, ending: 1, draft: 2, ended: 3 };

/** Pick the tenancy a PM cares about: active > ending > draft > ended, newest start first. */
export function pickCurrentTenancy<T extends { status: TenancyStatus; start_date: string | null }>(
  tenancies: T[],
): T | null {
  if (tenancies.length === 0) return null;
  return [...tenancies].sort((a, b) => {
    const byRank = TENANCY_RANK[a.status] - TENANCY_RANK[b.status];
    if (byRank !== 0) return byRank;
    return (b.start_date ?? "").localeCompare(a.start_date ?? "");
  })[0];
}

/**
 * Today's calendar date in Queensland (AEST, UTC+10 — no DST). Matches the
 * worker crons' aestToday() convention; a plain UTC date is yesterday's date
 * every Brisbane morning until 10am.
 */
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;
export function aestToday(now: Date = new Date()): string {
  return new Date(now.getTime() + AEST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * When the next routine inspection falls due: last inspection (or tenancy
 * start, if never inspected) + the interval. Mirrors the daily inspection
 * scanner's trigger — including clamping to the end of the target month
 * (31 Aug + 6mo = 28 Feb, like @pm/rules addMonths), NOT JS date rollover.
 * Returns an ISO date or null if there's no anchor date.
 */
export function nextInspectionDue(
  tenancy: { last_routine_inspection_date: string | null; start_date: string | null },
  intervalMonths = 6,
): string | null {
  const anchor = tenancy.last_routine_inspection_date ?? tenancy.start_date;
  if (!anchor) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(anchor);
  if (!m) return null;
  const monthsZeroBased = Number(m[2]) - 1 + intervalMonths;
  const year = Number(m[1]) + Math.floor(monthsZeroBased / 12);
  const month = (monthsZeroBased % 12) + 1;
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Number(m[3]), lastDayOfMonth);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type InspectionState = "overdue" | "due_soon" | "ok";

/** Badge state for an inspection due date ("due soon" = within 30 days). */
export function inspectionState(
  dueIso: string | null,
  today: string,
  dueSoonDays = 30,
): InspectionState | null {
  if (!dueIso) return null;
  if (dueIso < today) return "overdue";
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!t) return null;
  const horizon = new Date(Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]) + dueSoonDays))
    .toISOString()
    .slice(0, 10);
  return dueIso <= horizon ? "due_soon" : "ok";
}

/** Assemble the /properties list from raw agency-scoped rows. Sorted by address. */
export function buildRentRoll(
  properties: RentRollPropertyRow[],
  owners: RentRollOwnerRow[],
  tenancies: RentRollTenancyRow[],
  tenants: RentRollTenantRow[],
): PropertyListItem[] {
  const ownerById = new Map(owners.map((o) => [o.id, o.full_name]));
  const tenanciesByProperty = new Map<string, RentRollTenancyRow[]>();
  for (const t of tenancies) {
    const list = tenanciesByProperty.get(t.property_id) ?? [];
    list.push(t);
    tenanciesByProperty.set(t.property_id, list);
  }
  const tenantsByTenancy = new Map<string, RentRollTenantRow[]>();
  for (const t of tenants) {
    if (!t.tenancy_id) continue;
    const list = tenantsByTenancy.get(t.tenancy_id) ?? [];
    list.push(t);
    tenantsByTenancy.set(t.tenancy_id, list);
  }

  return properties
    .map((p): PropertyListItem => {
      const current = pickCurrentTenancy(tenanciesByProperty.get(p.id) ?? []);
      const currentTenants = current ? (tenantsByTenancy.get(current.id) ?? []) : [];
      // Primary tenant first so truncated lists show the right name.
      currentTenants.sort((a, b) => Number(b.is_primary ?? false) - Number(a.is_primary ?? false));
      return {
        id: p.id,
        addressLine1: p.address_line1,
        suburb: p.suburb,
        postcode: p.postcode,
        ownerName: p.owner_id ? (ownerById.get(p.owner_id) ?? null) : null,
        tenancyId: current?.id ?? null,
        tenancyStatus: current?.status ?? null,
        rentCents: current?.rent_amount_cents ?? null,
        rentFrequency: current?.rent_frequency ?? null,
        endDate: current?.end_date ?? null,
        arrearsSince: current?.arrears_since ?? null,
        inspectionDue: current && current.status === "active" ? nextInspectionDue(current) : null,
        tenantNames: currentTenants.map((t) => t.full_name),
      };
    })
    .sort((a, b) => a.addressLine1.localeCompare(b.addressLine1));
}

/** Case-insensitive search across address, suburb, owner and tenant names. */
export function matchesSearch(item: PropertyListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.addressLine1,
    item.suburb ?? "",
    item.postcode ?? "",
    item.ownerName ?? "",
    ...item.tenantNames,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}
