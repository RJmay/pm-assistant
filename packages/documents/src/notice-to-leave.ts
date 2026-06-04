import {
  maxIso,
  type NoticeToLeaveGround,
  noticePeriodEnd,
  noticeToLeaveRequirements,
} from "@pm/rules";
import { type DocumentModel, formatNames, humanDate, STANDARD_DISCLAIMER } from "./model";

// ============================================================================
// Notice to Leave (RTA Form 12)
// ============================================================================
// The notice period (per ground) + Form number come from @pm/rules. Grounds
// supported in v1: an unremedied RENT-arrears breach (following a Form 11), and
// the end of a fixed-term agreement. For end of term the period is in MONTHS and
// the handover date is the LATER of (notice + period) and the lease end date.
// ============================================================================

const GROUND_LABEL: Record<NoticeToLeaveGround, string> = {
  unremedied_breach: "Failure to pay rent — breach not remedied",
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
  /** Lease end date (ISO) — required for a correct end-of-fixed-term handover. */
  leaseEndDate?: string | null;
}

export function buildNoticeToLeave(
  input: NoticeToLeaveInput,
  asOf: string = input.noticeDate,
): DocumentModel {
  const req = noticeToLeaveRequirements(input.ground, asOf);
  const periodEnd = noticePeriodEnd(input.noticeDate, req);
  // End of fixed term: the tenancy ends on the later of the agreement end date
  // or the notice period end (RTA).
  const handover =
    input.ground === "end_of_fixed_term" && input.leaseEndDate
      ? maxIso(periodEnd, input.leaseEndDate)
      : periodEnd;
  const tenantsLine = formatNames(input.tenantNames);
  const unitWord =
    req.unit === "months"
      ? req.period === 1
        ? "month"
        : "months"
      : req.period === 1
        ? "day"
        : "days";
  const noticeLabel = `${req.period} ${unitWord}`;

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
      { label: "Minimum notice", value: noticeLabel },
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
