// ============================================================================
// Lease-renewal offer template (Phase 2, spec §8 "Lease-renewal pipeline")
// ============================================================================
// Drafted when a fixed-term tenancy is approaching its end date. The email
// invites the tenant to renew — it deliberately does NOT propose a rent figure
// or commit the owner to anything (spec §5 hard rules: never commit the owner;
// never give financial advice). Any rent review is a separate PM decision; we
// surface the compliant rent-review *window* (computed by @pm/rules) in the PM
// review notes only, never in the tenant-facing body.
// ============================================================================

import { type BuiltDraft, humanDate, renderTemplate, type Template } from "./engine";

export const LEASE_RENEWAL_TEMPLATE: Template = {
  key: "lease_renewal_v1",
  category: "LEASE",
  subject: "Your tenancy at {{property_address}} — renewal",
  body: `Hi {{tenant_name}},

Your fixed-term tenancy agreement for {{property_address}} is due to end on {{lease_end_date}}.

We'd be glad for you to stay on. If you'd like to renew your tenancy, please reply to let us know and we'll prepare a new agreement for you to review and sign before your current term ends.

If your plans have changed and you're not looking to renew, please let us know so we can talk through the next steps and the notice that applies.

So we have enough time to sort everything out, it would help to hear from you well before {{lease_end_date}}.

{{pm_signoff}}
{{pm_name}}
{{agency_name}}`,
  requiredVariables: [
    "tenant_name",
    "property_address",
    "lease_end_date",
    "pm_name",
    "agency_name",
  ],
};

/** Compliant rent-review window for the tenancy, computed by @pm/rules. */
export interface RentReviewWindow {
  /** Last rent increase for the relevant unit (property/tenancy), or null. */
  lastIncreaseDate: string | null;
  /** Earliest lawful effective date if notice is served on the scan date. */
  earliestCompliantDate: string;
  /** Minimum written-notice months that fed the calculation. */
  minNoticeMonths: number;
  /** Minimum months between increases that fed the calculation. */
  minIntervalMonths: number;
  /** Rule versions used, for the audit trail. */
  ruleVersions: string[];
}

export interface LeaseRenewalInput {
  tenantName: string;
  propertyAddress: string;
  /** Lease end date, ISO `YYYY-MM-DD`. */
  leaseEndDate: string;
  agencyName: string;
  pmName: string;
  /** Sign-off line; defaults to "Kind regards,". */
  pmSignoff?: string;
  /** Present when a rent review is relevant; surfaced in review notes only. */
  rentReview?: RentReviewWindow;
}

/**
 * Build a lease-renewal draft: a tenant-facing renewal invitation plus PM
 * review notes. Pure — the caller supplies the rent-review window (from
 * @pm/rules) so this stays free of any rules-engine dependency.
 */
export function buildLeaseRenewalDraft(input: LeaseRenewalInput): BuiltDraft {
  const leaseEndHuman = humanDate(input.leaseEndDate);
  const { subject, body } = renderTemplate(LEASE_RENEWAL_TEMPLATE, {
    tenant_name: input.tenantName,
    property_address: input.propertyAddress,
    lease_end_date: leaseEndHuman,
    pm_name: input.pmName,
    agency_name: input.agencyName,
    pm_signoff: input.pmSignoff?.trim() || "Kind regards,",
  });

  const reviewNotes: string[] = [
    "Outbound lease-renewal offer, generated from the tenancy's end date. Review and edit before sending — nothing sends automatically.",
    "Confirm the tenant still intends to stay before preparing a new agreement; if they intend to vacate, the correct end-of-tenancy notice applies.",
  ];

  if (input.rentReview) {
    const r = input.rentReview;
    const last = r.lastIncreaseDate ?? "none on record";
    reviewNotes.push(
      `Rent review window: last increase ${last}. QLD rules allow at most one increase every ${r.minIntervalMonths} months ` +
        `(measured per property since 6 Jun 2024) with at least ${r.minNoticeMonths} months' written notice. ` +
        `If notice were served today, the earliest a new rent could lawfully take effect is ${humanDate(r.earliestCompliantDate)}. ` +
        `Do not state a new rent in this email — handle any rent review separately with the correct notice. ` +
        `(rules: ${r.ruleVersions.join(", ")})`,
    );
  }

  return { subject, body, reviewNotes };
}
