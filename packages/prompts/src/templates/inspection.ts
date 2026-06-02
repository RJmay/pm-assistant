// ============================================================================
// Routine-inspection scheduling template (Phase 2, spec §8 "Inspection scheduling")
// ============================================================================
// Drafted when a routine inspection falls due. The email PROPOSES a date that
// already satisfies the statutory notice period + frequency cap (computed by
// @pm/rules) and tells the tenant a formal Entry Notice (Form 9) will follow.
// It never asserts a right to enter without that served notice — the formal
// Form 9 is generated in Phase 4. No statutory field is LLM/text-authored.
// ============================================================================

import { type BuiltDraft, humanDate, renderTemplate, type Template } from "./engine";

export const INSPECTION_TEMPLATE: Template = {
  key: "inspection_v1",
  category: "ADMIN",
  subject: "Routine inspection at {{property_address}}",
  body: `Hi {{tenant_name}},

It's time for a routine inspection of {{property_address}}. We're proposing to visit on {{proposed_date}}.

A formal Entry Notice (Form {{form_id}}) will follow by email confirming the date and time, giving you at least {{notice_days}} days' notice as required. You don't need to be home for the inspection, but you're welcome to be there if you'd prefer.

If that date doesn't suit, just reply and let us know and we'll arrange another time that works for you.

{{pm_signoff}}
{{pm_name}}
{{agency_name}}`,
  requiredVariables: [
    "tenant_name",
    "property_address",
    "proposed_date",
    "form_id",
    "notice_days",
    "pm_name",
    "agency_name",
  ],
};

export interface InspectionInput {
  tenantName: string;
  propertyAddress: string;
  /** Proposed entry date, ISO `YYYY-MM-DD` (already compliant). */
  proposedDate: string;
  /** Statutory notice days for the Entry Notice (from @pm/rules). */
  noticeDays: number;
  /** RTA form id for the entry notice (e.g. "9"). */
  formId: string;
  agencyName: string;
  pmName: string;
  pmSignoff?: string;
  /** True when the proposed date is bound by the frequency cap, not notice. */
  cappedByFrequency?: boolean;
  /** Minimum months between inspections, for the PM note. */
  minMonthsBetween?: number;
  /** Rule versions used, for the audit trail. */
  ruleVersions?: string[];
}

/** Build a routine-inspection scheduling draft + PM review notes. Pure. */
export function buildInspectionDraft(input: InspectionInput): BuiltDraft {
  const { subject, body } = renderTemplate(INSPECTION_TEMPLATE, {
    tenant_name: input.tenantName,
    property_address: input.propertyAddress,
    proposed_date: humanDate(input.proposedDate),
    form_id: input.formId,
    notice_days: input.noticeDays,
    pm_name: input.pmName,
    agency_name: input.agencyName,
    pm_signoff: input.pmSignoff?.trim() || "Kind regards,",
  });

  const reviewNotes: string[] = [
    "Outbound inspection-scheduling message, generated because a routine inspection fell due. Review and edit before sending — nothing sends automatically.",
    `A formal Entry Notice (Form ${input.formId}) must be served with at least ${input.noticeDays} days' notice before entry — the proposed date already satisfies this. Do not enter without the served notice.`,
  ];
  if (input.cappedByFrequency && input.minMonthsBetween) {
    reviewNotes.push(
      `Routine inspections are capped at one every ${input.minMonthsBetween} months (unless the tenant agrees in writing); the proposed date is the earliest the cap allows.`,
    );
  }
  if (input.ruleVersions && input.ruleVersions.length > 0) {
    reviewNotes.push(`(rules: ${input.ruleVersions.join(", ")})`);
  }

  return { subject, body, reviewNotes };
}
