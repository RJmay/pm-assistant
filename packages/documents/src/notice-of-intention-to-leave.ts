import {
  maxIso,
  type NoticeOfIntentionToLeaveGround,
  noticeOfIntentionToLeaveRequirements,
  noticePeriodEnd,
} from "@pm/rules";
import { type DocumentModel, formatNames, humanDate, STANDARD_DISCLAIMER } from "./model";

// ============================================================================
// Notice of Intention to Leave (RTA Form 13) — the TENANT's notice
// ============================================================================
// The mirror of Form 12: the tenant gives notice to the lessor/agent. The
// notice period (per ground) + Form number come from @pm/rules. For end of
// fixed term the vacate date is the LATER of (notice + period) and the lease
// end date. v1 grounds: periodic, end of fixed term, unremedied (lessor) breach.
// ============================================================================

const GROUND_LABEL: Record<NoticeOfIntentionToLeaveGround, string> = {
  periodic: "Ending a periodic agreement (without grounds)",
  end_of_fixed_term: "Ending at the end of the fixed-term agreement",
  unremedied_breach: "Unremedied breach by the lessor/agent",
  sale_not_disclosed: "Lessor's undisclosed intention to sell the premises",
  repair_order_non_compliance: "Lessor's failure to comply with a repair order",
  compulsory_acquisition: "Compulsory acquisition of the premises",
  condition_of_premises: "Condition of the premises",
  death_of_tenant: "Death of a tenant",
  tribunal_order_non_compliance: "Lessor's non-compliance with a tribunal (QCAT) order",
};

export interface NoticeOfIntentionToLeaveInput {
  /** The lessor/agent the notice is given TO. */
  agencyName: string;
  agencyContact?: string;
  /** The tenant(s) giving the notice (the document's sender). */
  tenantNames: string[];
  propertyAddress: string;
  /** Date the notice is issued, ISO `YYYY-MM-DD`. */
  noticeDate: string;
  ground: NoticeOfIntentionToLeaveGround;
  /** Lease end date (ISO) — required for a correct end-of-fixed-term vacate date. */
  leaseEndDate?: string | null;
}

export function buildNoticeOfIntentionToLeave(
  input: NoticeOfIntentionToLeaveInput,
  asOf: string = input.noticeDate,
): DocumentModel {
  const req = noticeOfIntentionToLeaveRequirements(input.ground, asOf);
  const periodEnd = noticePeriodEnd(input.noticeDate, req);
  // End of fixed term: the tenancy ends on the later of the agreement end date
  // or the notice period end (RTA).
  const vacateBy =
    input.ground === "end_of_fixed_term" && input.leaseEndDate
      ? maxIso(periodEnd, input.leaseEndDate)
      : periodEnd;
  const tenantsLine = formatNames(input.tenantNames);
  const noticeLabel = `${req.period} ${req.period === 1 ? "day" : "days"}`;

  return {
    type: "notice_of_intention_to_leave",
    formId: req.formId,
    title: `Notice of Intention to Leave (Form ${req.formId})`,
    generatedDate: input.noticeDate,
    // The tenant gives this notice TO the lessor/agent.
    to: {
      name: input.agencyName,
      addressLines: input.agencyContact ? [input.agencyContact] : [],
    },
    from: { name: tenantsLine, addressLines: [input.propertyAddress] },
    fields: [
      { label: "Premises", value: input.propertyAddress },
      { label: "Tenant(s)", value: tenantsLine },
      { label: "Reason", value: GROUND_LABEL[input.ground] },
      { label: "Vacating on or before", value: humanDate(vacateBy) },
      { label: "Notice given", value: humanDate(input.noticeDate) },
      { label: "Minimum notice", value: noticeLabel },
    ],
    sections: [
      {
        paragraphs: [
          `This is notice under the Residential Tenancies and Rooming Accommodation Act 2008 (Qld) ` +
            `of the tenant's intention to leave the above premises.`,
          `Reason: ${GROUND_LABEL[input.ground]}.`,
          `The tenant(s) intend to hand over vacant possession of the premises on or before ${humanDate(vacateBy)}.`,
        ],
      },
      {
        heading: "Next steps",
        paragraphs: [
          `Please arrange the exit inspection and the return of the rental bond.`,
          `If anything about this notice needs to be discussed, please contact the tenant(s).`,
        ],
      },
    ],
    ruleVersions: req.ruleVersions,
    disclaimer: STANDARD_DISCLAIMER,
  };
}
