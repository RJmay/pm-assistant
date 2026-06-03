import type { DocumentType } from "@pm/shared";

// ============================================================================
// @pm/documents — deterministic QLD statutory document engine (spec §10)
// ============================================================================
// Builds a structured document MODEL from property/tenancy data + the rules
// engine. Every statutory date, period and form number comes from @pm/rules —
// never an LLM (spec §6/§10). A builder THROWS rather than emit a document
// whose statutory basis the rules engine can't confirm (anti-invention, §0.3)
// or that would be non-compliant (e.g. a too-soon rent increase).
// ============================================================================

export interface DocumentParty {
  name: string;
  addressLines: string[];
}

export interface DocumentField {
  label: string;
  value: string;
}

export interface DocumentSection {
  heading?: string;
  paragraphs: string[];
}

export interface DocumentModel {
  type: DocumentType;
  /** RTA form number where the action maps to one ("9"); null otherwise. */
  formId: string | null;
  title: string;
  /** Date the document is generated/issued, ISO `YYYY-MM-DD`. */
  generatedDate: string;
  /** Recipient — tenant(s) at the premises. */
  to: DocumentParty;
  /** Issuer — the agency (on behalf of the lessor). */
  from: DocumentParty;
  /** The merged statutory + data fields (also persisted for audit). */
  fields: DocumentField[];
  /** Body prose. */
  sections: DocumentSection[];
  /** Rules-engine versions used to compute the statutory dates/periods. */
  ruleVersions: string[];
  /** Standard not-legal-advice footer. */
  disclaimer: string;
}

/**
 * Thrown when the requested document would be non-compliant on the given facts
 * (e.g. an entry date inside the notice period, or a rent increase too soon).
 * The reasons come from the rules engine, so they're safe to surface to the PM.
 */
export class DocumentNotCompliantError extends Error {
  override readonly name = "DocumentNotCompliantError";
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`Document is not compliant: ${reasons.join(" ")}`);
    this.reasons = reasons;
  }
}

export const STANDARD_DISCLAIMER =
  "This document is generated from your agency's records and the Queensland residential " +
  "tenancy rules in force on the date shown. Check every detail before issuing. " +
  "This is not legal advice.";

// ----------------------------------------------------------------------------
// Small formatting helpers (no I/O, no deps)
// ----------------------------------------------------------------------------

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** ISO `YYYY-MM-DD` → "1 November 2025" (string-parts only, no timezone drift). */
export function humanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Cents → "$1,234.56" (en-AU). */
export function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function frequencyLabel(frequency: "weekly" | "fortnightly" | "monthly"): string {
  return frequency === "weekly"
    ? "per week"
    : frequency === "fortnightly"
      ? "per fortnight"
      : "per month";
}

/** Join tenant names naturally ("Alex", "Alex and Sam", "A, B and C"). */
export function formatNames(names: string[]): string {
  const cleaned = names.map((n) => n.trim()).filter((n) => n !== "");
  if (cleaned.length === 0) return "The tenant(s)";
  if (cleaned.length === 1) return cleaned[0] as string;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")} and ${cleaned[cleaned.length - 1]}`;
}
