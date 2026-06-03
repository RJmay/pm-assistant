import { noticeToRemedyBreachRequirements, remedyByDate } from "@pm/rules";
import {
  type DocumentModel,
  formatDollars,
  formatNames,
  humanDate,
  STANDARD_DISCLAIMER,
} from "./model";

// ============================================================================
// Notice to Remedy Breach (RTA Form 11) — rent arrears
// ============================================================================
// The remedy period + Form number come from @pm/rules. That period is seeded
// UNCONFIRMED, so this builder THROWS (RuleNotConfiguredError) until a human
// confirms the current RTA value — it never guesses. The arrears amount is a
// factual PM input.
// ============================================================================

export interface RemedyBreachNoticeInput {
  agencyName: string;
  agencyContact?: string;
  tenantNames: string[];
  propertyAddress: string;
  /** Date the notice is issued, ISO `YYYY-MM-DD`. */
  noticeDate: string;
  /** Rent arrears amount owing, in cents (a factual PM input). */
  amountOwedCents: number;
}

export function buildRemedyBreachNotice(
  input: RemedyBreachNoticeInput,
  asOf: string = input.noticeDate,
): DocumentModel {
  const req = noticeToRemedyBreachRequirements(asOf);
  const remedyBy = remedyByDate(input.noticeDate, req.remedyDays);
  const tenantsLine = formatNames(input.tenantNames);
  const amount = formatDollars(input.amountOwedCents);

  return {
    type: "notice_to_remedy_breach",
    formId: req.formId,
    title: `Notice to Remedy Breach (Form ${req.formId})`,
    generatedDate: input.noticeDate,
    to: { name: tenantsLine, addressLines: [input.propertyAddress] },
    from: {
      name: input.agencyName,
      addressLines: input.agencyContact ? [input.agencyContact] : [],
    },
    fields: [
      { label: "Premises", value: input.propertyAddress },
      { label: "Tenant(s)", value: tenantsLine },
      { label: "Nature of breach", value: "Failure to pay rent (rent in arrears)" },
      { label: "Amount owing", value: amount },
      { label: "Remedy required by", value: humanDate(remedyBy) },
      { label: "Notice given", value: humanDate(input.noticeDate) },
      { label: "Remedy period", value: `${req.remedyDays} days` },
    ],
    sections: [
      {
        paragraphs: [
          `This is notice under the Residential Tenancies and Rooming Accommodation Act 2008 (Qld) ` +
            `that you are in breach of the tenancy agreement for the above premises.`,
          `Rent of ${amount} is owing. You are required to remedy this breach by paying the amount owing on or before ${humanDate(remedyBy)}.`,
        ],
      },
      {
        heading: "If the breach is not remedied",
        paragraphs: [
          `If the breach is not remedied by the date above, the lessor/agent may take further action, which can include issuing a Notice to Leave.`,
          `If you have already paid, or if you'd like to discuss a payment arrangement, please contact us as soon as possible.`,
        ],
      },
    ],
    ruleVersions: req.ruleVersions,
    disclaimer: STANDARD_DISCLAIMER,
  };
}
