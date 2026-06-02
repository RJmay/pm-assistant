// ============================================================================
// Owner month-end update template (Phase 2, spec §8 "Owner updates")
// ============================================================================
// A periodic, friendly status update to a property owner, summarising the
// month's activity across their properties from data we already hold. It never
// commits the owner to anything and never discloses third-party (tenant)
// personal information — it's a high-level "here's how things went" note that
// the PM reviews and sends.
// ============================================================================

import { type BuiltDraft, renderTemplate, type Template } from "./engine";

export const OWNER_UPDATE_TEMPLATE: Template = {
  key: "owner_update_v1",
  category: "ADMIN",
  subject: "Your {{report_month}} update from {{agency_name}}",
  body: `Hi {{owner_first_name}},

Here's your monthly update from {{agency_name}} for {{report_month}}.

Across the {{properties_phrase}} you have with us, we handled {{items_phrase}} this month, and your property manager reviewed each one to keep things running smoothly.

If you'd like more detail on anything in particular, just reply and we'll talk it through.

{{pm_signoff}}
{{pm_name}}
{{agency_name}}`,
  requiredVariables: [
    "owner_first_name",
    "agency_name",
    "report_month",
    "properties_phrase",
    "items_phrase",
    "pm_name",
  ],
};

export interface OwnerUpdateInput {
  ownerName: string;
  agencyName: string;
  /** Human label for the reported month, e.g. "May 2026". */
  reportMonthLabel: string;
  propertyCount: number;
  itemsHandled: number;
  pmName: string;
  pmSignoff?: string;
}

function firstName(full: string): string {
  return full.split(/\s+/)[0]?.trim() || full;
}

/** Build a month-end owner update draft + PM review notes. Pure. */
export function buildOwnerUpdateDraft(input: OwnerUpdateInput): BuiltDraft {
  const propertiesPhrase =
    input.propertyCount === 1 ? "1 property" : `${input.propertyCount} properties`;
  const itemsPhrase =
    input.itemsHandled === 0
      ? "no new matters"
      : input.itemsHandled === 1
        ? "1 matter"
        : `${input.itemsHandled} matters`;

  const { subject, body } = renderTemplate(OWNER_UPDATE_TEMPLATE, {
    owner_first_name: firstName(input.ownerName),
    agency_name: input.agencyName,
    report_month: input.reportMonthLabel,
    properties_phrase: propertiesPhrase,
    items_phrase: itemsPhrase,
    pm_name: input.pmName,
    pm_signoff: input.pmSignoff?.trim() || "Kind regards,",
  });

  const reviewNotes: string[] = [
    "Outbound month-end owner update, generated from this period's activity. Review and edit before sending — nothing sends automatically.",
    "Figures are a high-level count from the owner's properties; add any specifics the owner should know, and don't include other parties' personal details.",
  ];

  return { subject, body, reviewNotes };
}
