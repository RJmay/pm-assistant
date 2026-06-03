import { compareIso, earliestRoutineInspectionDate, entryNoticeRequirements } from "@pm/rules";
import {
  type DocumentModel,
  DocumentNotCompliantError,
  humanDate,
  STANDARD_DISCLAIMER,
} from "./model";

// ============================================================================
// Entry Notice (RTA Form 9) — routine inspection
// ============================================================================
// Statutory notice period + the Form number come from @pm/rules
// (entryNoticeRequirements / earliestRoutineInspectionDate). The PM may propose
// an entry date; if it's inside the notice period (or breaches the frequency
// cap), we refuse to generate the notice rather than emit a non-compliant one.
// ============================================================================

export interface EntryNoticeInput {
  agencyName: string;
  /** Optional contact line for the issuer block (phone/email). */
  agencyContact?: string;
  tenantNames: string[];
  propertyAddress: string;
  /** Date the notice is issued, ISO `YYYY-MM-DD`. */
  noticeDate: string;
  /** Proposed entry date, ISO. Defaults to the earliest compliant date. */
  entryDate?: string;
  /** Date of the last routine inspection (frequency cap), or null. */
  lastInspectionDate?: string | null;
  /** Free-text entry window, e.g. "between 9:00am and 5:00pm". */
  entryWindow?: string;
}

export function buildEntryNoticeDocument(
  input: EntryNoticeInput,
  asOf: string = input.noticeDate,
): DocumentModel {
  const requirements = entryNoticeRequirements(asOf);
  const window = earliestRoutineInspectionDate({
    noticeDate: input.noticeDate,
    lastInspectionDate: input.lastInspectionDate ?? null,
    asOf,
  });
  const entryDate = input.entryDate ?? window.earliestDate;

  // Reject an entry date that doesn't satisfy the notice period / frequency cap.
  if (compareIso(entryDate, window.earliestDate) < 0) {
    const reasons = [
      `A routine inspection requires at least ${requirements.routineInspectionNoticeDays} days' ` +
        `notice${window.cappedByFrequency ? " and respects the inspection-frequency cap" : ""}; ` +
        `the earliest compliant entry date is ${humanDate(window.earliestDate)}.`,
    ];
    throw new DocumentNotCompliantError(reasons);
  }

  const tenantsLine = formatNames(input.tenantNames);
  const entryWindow = input.entryWindow?.trim() || "between 8:00am and 6:00pm";

  return {
    type: "entry_notice",
    formId: requirements.formId,
    title: `Entry Notice (Form ${requirements.formId})`,
    generatedDate: input.noticeDate,
    to: { name: tenantsLine, addressLines: [input.propertyAddress] },
    from: {
      name: input.agencyName,
      addressLines: input.agencyContact ? [input.agencyContact] : [],
    },
    fields: [
      { label: "Premises", value: input.propertyAddress },
      { label: "Tenant(s)", value: tenantsLine },
      { label: "Reason for entry", value: "Routine inspection of the premises" },
      { label: "Date of entry", value: humanDate(entryDate) },
      { label: "Time of entry", value: entryWindow },
      { label: "Notice given", value: humanDate(input.noticeDate) },
      {
        label: "Minimum notice required",
        value: `${requirements.routineInspectionNoticeDays} days`,
      },
    ],
    sections: [
      {
        paragraphs: [
          `This is notice under the Residential Tenancies and Rooming Accommodation Act 2008 (Qld) ` +
            `that the lessor/agent intends to enter the above premises to carry out a routine inspection.`,
          `Entry will take place on ${humanDate(entryDate)}, ${entryWindow}.`,
          `This notice gives at least ${requirements.routineInspectionNoticeDays} days' notice, as required for a routine inspection.`,
        ],
      },
      {
        heading: "What this means for you",
        paragraphs: [
          `You do not have to be present for the inspection, but you're welcome to be.`,
          `Routine inspections are limited to once every ${requirements.minMonthsBetween} months unless you agree in writing to more frequent inspections.`,
          `If the proposed date or time doesn't suit, please contact us to arrange an alternative.`,
        ],
      },
    ],
    ruleVersions: requirements.ruleVersions,
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
