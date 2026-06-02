// ============================================================================
// Arrears courtesy-reminder template (Phase 2, spec §8 "Arrears sequence")
// ============================================================================
// A gentle, early rent reminder drafted when a tenancy is flagged in arrears.
// It is a COURTESY notice, never a statutory one: it states how many days the
// rent is overdue (a fact from data) but makes no legal threat and asserts no
// statutory threshold. Any escalation to a Notice to Remedy Breach (Form 11)
// is surfaced to the PM as a judgement call — we never encode a regulatory
// fact the rules engine can't source (spec §0.3 / §6).
// ============================================================================

import { type BuiltDraft, humanDate, renderTemplate, type Template } from "./engine";

export const ARREARS_TEMPLATE: Template = {
  key: "arrears_v1",
  category: "RENT",
  subject: "Rent reminder — {{property_address}}",
  body: `Hi {{tenant_name}},

This is a friendly reminder that the rent for {{property_address}} is currently {{days_overdue_phrase}}.

If you've already made the payment, thank you — please disregard this note, and it can take a day or two to show up on our end. If not, please arrange payment as soon as you're able, or get in touch so we can talk through a way forward together.

{{pm_signoff}}
{{pm_name}}
{{agency_name}}`,
  requiredVariables: [
    "tenant_name",
    "property_address",
    "days_overdue_phrase",
    "pm_name",
    "agency_name",
  ],
};

export interface ArrearsInput {
  tenantName: string;
  propertyAddress: string;
  /** Whole days the rent is overdue (>= 1). */
  daysOverdue: number;
  /** Date arrears were flagged, ISO `YYYY-MM-DD`. */
  arrearsSince: string;
  agencyName: string;
  pmName: string;
  pmSignoff?: string;
  /** When true, add a PM note recommending escalation be considered. */
  escalate?: boolean;
}

/** Build an arrears courtesy-reminder draft + PM review notes. Pure. */
export function buildArrearsDraft(input: ArrearsInput): BuiltDraft {
  const daysPhrase =
    input.daysOverdue === 1 ? "1 day overdue" : `${input.daysOverdue} days overdue`;

  const { subject, body } = renderTemplate(ARREARS_TEMPLATE, {
    tenant_name: input.tenantName,
    property_address: input.propertyAddress,
    days_overdue_phrase: daysPhrase,
    pm_name: input.pmName,
    agency_name: input.agencyName,
    pm_signoff: input.pmSignoff?.trim() || "Kind regards,",
  });

  const reviewNotes: string[] = [
    "Outbound arrears reminder, generated because this tenancy is flagged in arrears. Review and edit before sending — nothing sends automatically.",
    `Rent is ${daysPhrase} (flagged from ${humanDate(input.arrearsSince)}). This is a courtesy reminder, not a statutory notice.`,
  ];
  if (input.escalate) {
    reviewNotes.push(
      `This has been overdue ${input.daysOverdue} days. Review whether a formal Notice to Remedy Breach (Form 11) is warranted — the statutory arrears threshold and process are your call, not the system's.`,
    );
  }

  return { subject, body, reviewNotes };
}
