// ============================================================================
// Calendar date math — UTC-anchored, no timezone drift
// ============================================================================
// QLD compliance dates are calendar dates, not instants. We represent them as
// `YYYY-MM-DD` strings and do all arithmetic on the (year, month, day) triple
// so results never shift across a timezone boundary. `addMonths` clamps the
// day to the target month's length (31 Jan + 1 month -> 28/29 Feb), which is
// the conventional behaviour for statutory notice periods expressed in months.
// ============================================================================

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export class InvalidDateError extends Error {
  override readonly name = "InvalidDateError";
  constructor(value: string) {
    super(`Invalid ISO calendar date (expected YYYY-MM-DD): ${JSON.stringify(value)}`);
  }
}

interface Ymd {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** Days in a (1-based) month of a given year, leap-year aware. */
export function daysInMonth(year: number, month: number): number {
  // Date.UTC month is 0-based; day 0 of month `month` == last day of (month-1) 1-based.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toYmd(iso: string): Ymd {
  if (!ISO_RE.test(iso)) throw new InvalidDateError(iso);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (month < 1 || month > 12) throw new InvalidDateError(iso);
  if (day < 1 || day > daysInMonth(year, month)) throw new InvalidDateError(iso);
  return { year, month, day };
}

function fromYmd({ year, month, day }: Ymd): string {
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Validate and normalise an ISO date (throws `InvalidDateError` if malformed). */
export function parseIsoDate(iso: string): string {
  return fromYmd(toYmd(iso));
}

/** Add `n` calendar months, clamping the day to the target month length. */
export function addMonths(iso: string, n: number): string {
  const { year, month, day } = toYmd(iso);
  const zeroBased = month - 1 + n;
  const newYear = year + Math.floor(zeroBased / 12);
  const newMonth = (((zeroBased % 12) + 12) % 12) + 1;
  const clampedDay = Math.min(day, daysInMonth(newYear, newMonth));
  return fromYmd({ year: newYear, month: newMonth, day: clampedDay });
}

/** Add `n` calendar days. */
export function addDays(iso: string, n: number): string {
  const { year, month, day } = toYmd(iso);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return fromYmd({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  });
}

/** Chronological comparison: -1 if a<b, 0 if equal, 1 if a>b. */
export function compareIso(a: string, b: string): -1 | 0 | 1 {
  // Validate both, then rely on lexical order (zero-padded YYYY-MM-DD).
  parseIsoDate(a);
  parseIsoDate(b);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isOnOrAfter(a: string, b: string): boolean {
  return compareIso(a, b) >= 0;
}

export function isOnOrBefore(a: string, b: string): boolean {
  return compareIso(a, b) <= 0;
}

/** Latest of the given dates (chronologically). Throws if none supplied. */
export function maxIso(first: string, ...rest: string[]): string {
  return rest.reduce((acc, d) => (compareIso(d, acc) > 0 ? d : acc), parseIsoDate(first));
}
