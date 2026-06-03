// ============================================================================
// Maintenance coordination templates (Phase 3, spec §9)
// ============================================================================
// Two outbound templates a maintenance job produces:
//   - a tradie quote request (to an approved tradie), and
//   - an owner-approval request (when the spend is above the PM's routine
//     authority).
// Both are drafted-and-queued for the PM to review and send. Hard rules
// (spec §5): never commit the owner to spend, never promise a tradie
// attendance time, never disclose third-party personal details.
// ============================================================================

import { type BuiltDraft, renderTemplate, type Template } from "./engine";

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function firstName(full: string): string {
  return full.split(/\s+/)[0]?.trim() || full;
}

// ----------------------------------------------------------------------------
// Tradie quote request
// ----------------------------------------------------------------------------

export const TRADIE_QUOTE_REQUEST_TEMPLATE: Template = {
  key: "tradie_quote_request_v1",
  category: "MAINTENANCE",
  subject: "Quote request — {{trade}} at {{property_address}}",
  body: `Hi {{tradie_name}},

We have a {{trade}} job at {{property_address}} and would like a quote.

Issue: {{issue_summary}}

{{urgency_line}}Could you please reply with your quote and your earliest availability? We'll confirm access arrangements with the tenant once we have a time that works.

{{pm_signoff}}
{{pm_name}}
{{agency_name}}`,
  requiredVariables: [
    "tradie_name",
    "trade",
    "property_address",
    "issue_summary",
    "pm_name",
    "agency_name",
  ],
};

export interface TradieQuoteRequestInput {
  tradieName: string;
  trade: string;
  propertyAddress: string;
  issueSummary: string;
  isEmergency: boolean;
  agencyName: string;
  pmName: string;
  pmSignoff?: string;
}

export function buildTradieQuoteRequest(input: TradieQuoteRequestInput): BuiltDraft {
  const { subject, body } = renderTemplate(TRADIE_QUOTE_REQUEST_TEMPLATE, {
    tradie_name: input.tradieName,
    trade: input.trade,
    property_address: input.propertyAddress,
    issue_summary: input.issueSummary,
    pm_name: input.pmName,
    agency_name: input.agencyName,
    pm_signoff: input.pmSignoff?.trim() || "Kind regards,",
    urgency_line: input.isEmergency
      ? "This is an urgent repair, so the sooner you're able to attend the better. "
      : "",
  });

  const reviewNotes: string[] = [
    `Outbound tradie quote request (${input.trade}). Review and edit before sending — nothing sends automatically.`,
    "Confirm the issue and access details before sending. We don't commit the owner to spend or promise the tenant a specific time.",
  ];
  if (input.isEmergency) {
    reviewNotes.push(
      "Flagged EMERGENCY (RTRA s214) — prioritise. The tenant may also arrange emergency repairs via the nominated repairer up to the statutory limit if they can't reach us.",
    );
  }

  return { subject, body, reviewNotes };
}

// ----------------------------------------------------------------------------
// Owner-approval request
// ----------------------------------------------------------------------------

export const OWNER_APPROVAL_REQUEST_TEMPLATE: Template = {
  key: "owner_approval_request_v1",
  category: "MAINTENANCE",
  subject: "Approval needed — maintenance at {{property_address}}",
  body: `Hi {{owner_first_name}},

A maintenance matter has come up at {{property_address}} that we'd like your approval to proceed with.

Issue: {{issue_summary}}

{{cost_line}}As it's above the routine spend we handle on your behalf, we wanted to check with you before going ahead. Could you let us know if you're happy for us to proceed? If you'd like to discuss the options first, just reply and we'll talk it through.

{{pm_signoff}}
{{pm_name}}
{{agency_name}}`,
  requiredVariables: [
    "owner_first_name",
    "property_address",
    "issue_summary",
    "pm_name",
    "agency_name",
  ],
};

export interface OwnerApprovalRequestInput {
  ownerName: string;
  propertyAddress: string;
  issueSummary: string;
  /** Estimated cost in cents, if known. */
  estimateCents?: number;
  /** The routine-approval threshold this exceeds, in cents. */
  thresholdCents: number;
  agencyName: string;
  pmName: string;
  pmSignoff?: string;
}

export function buildOwnerApprovalRequest(input: OwnerApprovalRequestInput): BuiltDraft {
  const costLine =
    input.estimateCents != null
      ? `The estimated cost is ${formatDollars(input.estimateCents)}. `
      : "We're still gathering quotes and will share them with you, but ";

  const { subject, body } = renderTemplate(OWNER_APPROVAL_REQUEST_TEMPLATE, {
    owner_first_name: firstName(input.ownerName),
    property_address: input.propertyAddress,
    issue_summary: input.issueSummary,
    pm_name: input.pmName,
    agency_name: input.agencyName,
    pm_signoff: input.pmSignoff?.trim() || "Kind regards,",
    cost_line: costLine,
  });

  const reviewNotes: string[] = [
    "Outbound owner-approval request. Review and edit before sending — nothing sends automatically.",
    `Above the routine approval threshold (${formatDollars(input.thresholdCents)}) — the owner's approval is required before proceeding. This asks for approval; it never authorises spend on the owner's behalf.`,
  ];
  if (input.estimateCents != null && input.estimateCents <= input.thresholdCents) {
    reviewNotes.push(
      `Note: the estimate (${formatDollars(input.estimateCents)}) is within the routine threshold — owner approval may not be strictly required. Confirm before sending.`,
    );
  }

  return { subject, body, reviewNotes };
}
