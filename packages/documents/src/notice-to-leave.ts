import { handoverDate, type NoticeToLeaveGround, noticeToLeaveRequirements } from "@pm/rules";
import { type DocumentModel, formatNames, humanDate, STANDARD_DISCLAIMER } from "./model";

// ============================================================================
// Notice to Leave (RTA Form 12)
// ============================================================================
// The notice period (per ground) + Form number come from @pm/rules. Those
// periods are seeded UNCONFIRMED, so this builder THROWS until a human confirms
// the current RTA value. Grounds supported in v1: an unremedied breach
// (following a Form 11) and end of a fixed-term agreement.
// ============================================================================

const GROUND_LABEL: Record<NoticeToLeaveGround, string> = {
  unremedied_breach: "Breach of the tenancy agreement not remedied",
  end_of_fixed_term: "End of the fixed-term tenancy agreement",
};

export interface NoticeToLeaveInput {
  agencyName: string;
  agencyContact?: string;
  tenantNames: string[];
  propertyAddress: string;
  /** Date the notice is issued, ISO `YYYY-MM-DD`. */
  noticeDate: string;
  ground: NoticeToLeaveGround;
}

export function buildNoticeToLeave(
  input: NoticeToLeaveInput,
  asOf: string = input.noticeDate,
): DocumentModel {
  const req = noticeToLeaveRequirements(input.ground, asOf);
  const handover = handoverDate(input.noticeDate, req.noticeDays);
  const tenantsLine = formatNames(input.tenantNames);

  return {
    type: "notice_to_leave",
    formId: req.formId,
    title: `Notice to Leave (Form ${req.formId})`,
    generatedDate: input.noticeDate,
    to: { name: tenantsLine, addressLines: [input.propertyAddress] },
    from: {
      name: input.agencyName,
      addressLines: input.agencyContact ? [input.agencyContact] : [],
    },
    fields: [
      { label: "Premises", value: input.propertyAddress },
      { label: "Tenant(s)", value: tenantsLine },
      { label: "Ground", value: GROUND_LABEL[input.ground] },
      { label: "Hand over the premises by", value: humanDate(handover) },
      { label: "Notice given", value: humanDate(input.noticeDate) },
      { label: "Minimum notice", value: `${req.noticeDays} days` },
    ],
    sections: [
      {
        paragraphs: [
          `This is notice under the Residential Tenancies and Rooming Accommodation Act 2008 (Qld) ` +
            `to leave the above premises.`,
          `Ground: ${GROUND_LABEL[input.ground]}.`,
          `You are asked to hand over vacant possession of the premises on or before ${humanDate(handover)}.`,
        ],
      },
      {
        heading: "Your options",
        paragraphs: [
          `If you believe this notice is not valid, you can seek advice from the RTA or QCAT.`,
          `Please contact us to arrange the handover, including returning keys and the exit inspection.`,
        ],
      },
    ],
    ruleVersions: req.ruleVersions,
    disclaimer: STANDARD_DISCLAIMER,
  };
}
