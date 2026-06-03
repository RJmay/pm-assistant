import { assessRentIncrease, earliestRentIncreaseDate } from "@pm/rules";
import {
  type DocumentModel,
  DocumentNotCompliantError,
  formatDollars,
  frequencyLabel,
  humanDate,
  STANDARD_DISCLAIMER,
} from "./model";

// ============================================================================
// Notice of Rent Increase
// ============================================================================
// QLD has no numbered RTA form for a rent increase — it's a written notice with
// statutory minimums. The notice period, the once-per-12-months rule and the
// (post-6-Jun-2024) property basis all come from @pm/rules (assessRentIncrease).
// We refuse to generate a notice the rules engine assesses as non-compliant, and
// the new rent figure is a PM/commercial input (never computed or invented here).
// ============================================================================

export interface RentIncreaseNoticeInput {
  agencyName: string;
  agencyContact?: string;
  tenantNames: string[];
  propertyAddress: string;
  /** Date the notice is issued, ISO `YYYY-MM-DD`. */
  noticeDate: string;
  currentRentCents: number;
  /** The new rent — a commercial decision supplied by the PM. */
  newRentCents: number;
  rentFrequency: "weekly" | "fortnightly" | "monthly";
  /** Proposed effective date, ISO. Defaults to the earliest compliant date. */
  effectiveDate?: string;
  /** Last increase date for the property (post-2024) / tenancy, or null. */
  lastIncreaseDate: string | null;
}

export function buildRentIncreaseNoticeDocument(input: RentIncreaseNoticeInput): DocumentModel {
  if (input.newRentCents <= input.currentRentCents) {
    throw new DocumentNotCompliantError([
      "The new rent must be higher than the current rent for a rent-increase notice.",
    ]);
  }

  const effectiveDate =
    input.effectiveDate ??
    earliestRentIncreaseDate({
      noticeDate: input.noticeDate,
      lastIncreaseDate: input.lastIncreaseDate,
    });

  const assessment = assessRentIncrease({
    proposedEffectiveDate: effectiveDate,
    noticeDate: input.noticeDate,
    lastIncreaseDate: input.lastIncreaseDate,
  });
  if (!assessment.allowed) {
    throw new DocumentNotCompliantError(assessment.reasons);
  }

  const tenantsLine = formatNames(input.tenantNames);
  const freq = frequencyLabel(input.rentFrequency);
  const basisLine =
    assessment.basis === "property"
      ? "Rent may be increased at most once every 12 months for the property (since 6 June 2024)."
      : "Rent may be increased at most once every 12 months for the tenancy.";

  return {
    type: "rent_increase_notice",
    formId: null,
    title: "Notice of Rent Increase",
    generatedDate: input.noticeDate,
    to: { name: tenantsLine, addressLines: [input.propertyAddress] },
    from: {
      name: input.agencyName,
      addressLines: input.agencyContact ? [input.agencyContact] : [],
    },
    fields: [
      { label: "Premises", value: input.propertyAddress },
      { label: "Tenant(s)", value: tenantsLine },
      { label: "Current rent", value: `${formatDollars(input.currentRentCents)} ${freq}` },
      { label: "New rent", value: `${formatDollars(input.newRentCents)} ${freq}` },
      { label: "Takes effect from", value: humanDate(effectiveDate) },
      { label: "Notice given", value: humanDate(input.noticeDate) },
      { label: "Minimum notice required", value: `${assessment.minNoticeMonths} months` },
    ],
    sections: [
      {
        paragraphs: [
          `This is notice under the Residential Tenancies and Rooming Accommodation Act 2008 (Qld) ` +
            `that the rent for the above premises will increase.`,
          `From ${humanDate(effectiveDate)}, the rent will be ${formatDollars(input.newRentCents)} ${freq} ` +
            `(currently ${formatDollars(input.currentRentCents)} ${freq}).`,
          `This notice gives at least ${assessment.minNoticeMonths} months' written notice before the increase takes effect, as required.`,
        ],
      },
      {
        heading: "About this increase",
        paragraphs: [basisLine, `If you have questions about the increase, please contact us.`],
      },
    ],
    ruleVersions: assessment.ruleVersions,
    disclaimer: STANDARD_DISCLAIMER,
  };
}

function formatNames(names: string[]): string {
  const cleaned = names.map((n) => n.trim()).filter((n) => n !== "");
  if (cleaned.length === 0) return "The tenant(s)";
  if (cleaned.length === 1) return cleaned[0] as string;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")} and ${cleaned[cleaned.length - 1]}`;
}
