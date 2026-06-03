import { type RegulatoryRule, regulatoryRuleSchema } from "./schema";

// ============================================================================
// QLD regulatory rules — canonical seed
// ============================================================================
// Seeded ONLY from facts stated in PM-Manager_Build_Spec.md §6 (and the
// governing-framework note in that section). Nothing here is inferred from
// model knowledge. Where the spec named a change but withheld the number, the
// rule carries `value: null` + `needsHumanConfirmation: true` and the accessor
// refuses to return a value (spec §0.3 — never invent a regulatory fact).
//
// Effective dates that appear below — and ONLY these — are asserted by the
// spec: 2024-06-06, 2024-09-01, 2025-05-01, 2025-09-01, 2026-08-31,
// 2026-09-01. `seed.test.ts` enforces that no other hard date sneaks in.
//
// When the DB-backed `regulatory_rules` table (migration 0008) is populated,
// these same rows are the seed; the engine logic is identical whether the
// rows come from this array or from Postgres.
// ============================================================================

const RTA = "https://www.rta.qld.gov.au/";
const QLD_LEGISLATION = "https://www.legislation.qld.gov.au/";

const RAW: RegulatoryRule[] = [
  {
    jurisdiction: "QLD",
    key: "governing_framework",
    version: "qld-2025-regulation",
    value: {
      act: "Residential Tenancies and Rooming Accommodation Act 2008 (Qld)",
      regulation: "Residential Tenancies and Rooming Accommodation Regulation 2025",
      regulationCommenced: "2025-09-01",
      authority: "Residential Tenancies Authority (RTA)",
      tribunal: "Queensland Civil and Administrative Tribunal (QCAT)",
    },
    effectiveFrom: "2025-09-01",
    effectiveTo: null,
    sourceUrl: QLD_LEGISLATION,
    sourceNote:
      "Spec §6: governing law RTRA Act 2008 (Qld); supporting regulation RTRA Regulation 2025, commenced 1 September 2025; administering body RTA; tribunal QCAT.",
    needsHumanConfirmation: false,
    notes: null,
  },

  // --- Rent increases: property-based 12-month rule since 6 Jun 2024 --------
  {
    jurisdiction: "QLD",
    key: "rent_increase_frequency",
    version: "qld-pre-2024-06-06",
    value: { minIntervalMonths: 12, appliesTo: "tenancy" },
    effectiveFrom: null, // legacy regime; spec does not state its start date
    effectiveTo: "2024-06-05",
    sourceUrl: RTA,
    sourceNote:
      "Spec §6: rent increases limited to once every 12 months; the property-based attachment took effect 6 Jun 2024, so before that the 12-month limit attached to the tenancy.",
    needsHumanConfirmation: false,
    notes: "Superseded by the property-based version on 2024-06-06.",
  },
  {
    jurisdiction: "QLD",
    key: "rent_increase_frequency",
    version: "qld-2024-06-06",
    value: { minIntervalMonths: 12, appliesTo: "property" },
    effectiveFrom: "2024-06-06",
    effectiveTo: null,
    sourceUrl: RTA,
    sourceNote:
      "Spec §6: since 6 June 2024 the annual rent-increase limit attaches to the PROPERTY, not the tenancy; still once every 12 months.",
    needsHumanConfirmation: false,
    notes:
      "Caller must supply the PROPERTY's last-increase date (not the tenancy's) when evaluating eligibility on/after 2024-06-06.",
  },
  {
    jurisdiction: "QLD",
    key: "rent_increase_min_notice",
    version: "qld-current",
    value: { months: 2 },
    effectiveFrom: null, // spec gives the current value without a change date
    effectiveTo: null,
    sourceUrl: RTA,
    sourceNote: "Spec §6: minimum written notice period for a rent increase is 2 months.",
    needsHumanConfirmation: false,
    notes: null,
  },

  // --- Rent bidding banned since 6 Jun 2024 ---------------------------------
  {
    jurisdiction: "QLD",
    key: "rent_bidding_ban",
    version: "qld-2024-06-06",
    value: { banned: true, scope: "all_forms" },
    effectiveFrom: "2024-06-06",
    effectiveTo: null,
    sourceUrl: RTA,
    sourceNote: "Spec §6: rent bidding (all forms) banned since 6 June 2024.",
    needsHumanConfirmation: false,
    notes: null,
  },

  // --- Minimum housing standards, phased to 1 Sep 2024 ----------------------
  {
    jurisdiction: "QLD",
    key: "minimum_housing_standards",
    version: "qld-2024-09-01",
    value: { inForce: true, allTenanciesFrom: "2024-09-01" },
    effectiveFrom: "2024-09-01",
    effectiveTo: null,
    sourceUrl: RTA,
    sourceNote:
      "Spec §6: minimum housing standards in force for all tenancies (phased to 1 September 2024).",
    needsHumanConfirmation: false,
    notes: null,
  },

  // --- Entry rules updated 1 May 2025 — VALUES NOT IN SPEC, must confirm ----
  {
    jurisdiction: "QLD",
    key: "entry_notice_routine",
    version: "qld-2025-05-01",
    value: { routineInspectionNoticeDays: 7, generalEntryNoticeHours: 48 },
    effectiveFrom: "2025-05-01",
    effectiveTo: null,
    sourceUrl:
      "https://www.rta.qld.gov.au/during-a-tenancy/living-in-the-property/entry-to-the-property",
    sourceNote:
      "Confirmed from the RTA 'Entry to the property' page (form versions dated Nov 2025): a routine inspection requires 7 days' written notice (Entry notice Form 9); most other reasons (repairs/maintenance, showing to prospective tenants/buyers, post-breach, valuation) require 48 hours. Entry is 8am-6pm Mon-Sat unless the tenant agrees.",
    needsHumanConfirmation: false,
    notes:
      "routineInspectionNoticeDays drives Phase 2 inspection scheduling + Phase 4 Form 9; generalEntryNoticeHours (48h) covers repairs/showings. Add finer per-reason periods if a workflow needs them.",
  },
  {
    jurisdiction: "QLD",
    key: "entry_frequency_cap",
    version: "qld-2025-05-01",
    value: { minMonthsBetween: 3, overridableByTenantConsent: true },
    effectiveFrom: "2025-05-01",
    effectiveTo: null,
    sourceUrl:
      "https://www.rta.qld.gov.au/during-a-tenancy/living-in-the-property/routine-inspections",
    sourceNote:
      "Confirmed from the RTA 'Routine inspections' page (and the pilot agency): routine inspections cannot be carried out more than once every 3 months, unless the tenant agrees in writing.",
    needsHumanConfirmation: false,
    notes:
      "minMonthsBetween = the minimum gap between routine inspections; overridable by written tenant consent.",
  },

  // --- Emergency repairs (RTRA s214) statutory list -------------------------
  {
    jurisdiction: "QLD",
    key: "emergency_repairs_s214",
    version: "rtra-s214",
    value: {
      statute: "RTRA Act 2008 (Qld) s214",
      // `label` is the statutory item as worded in the spec; `keywords` is OUR
      // triage heuristic (not statutory) used by the maintenance classifier.
      items: [
        {
          key: "burst_water_service",
          label: "A burst water service",
          keywords: ["burst water", "burst pipe", "pipe burst", "water main burst"],
        },
        {
          key: "broken_toilet",
          label: "A blocked or broken toilet (where there is only one toilet)",
          keywords: [
            "toilet blocked",
            "blocked toilet",
            "broken toilet",
            "toilet won't flush",
            "only toilet",
          ],
        },
        {
          key: "serious_roof_leak",
          label: "A serious roof leak",
          keywords: ["roof leak", "leaking roof", "ceiling leaking", "water through the ceiling"],
        },
        {
          key: "gas_leak",
          label: "A gas leak",
          keywords: ["gas leak", "smell of gas", "gas smell", "leaking gas"],
        },
        {
          key: "dangerous_electrical_fault",
          label: "A dangerous electrical fault",
          keywords: [
            "electrical fault",
            "exposed wiring",
            "sparking",
            "electric shock",
            "burning smell from power",
          ],
        },
        {
          key: "flooding_storm_fire_damage",
          label: "Flooding or serious flood damage, or serious storm or fire damage",
          keywords: ["flooding", "flood damage", "storm damage", "fire damage", "house flooded"],
        },
        {
          key: "essential_supply_failure",
          label: "A failure or breakdown of the gas, electricity or water supply to the premises",
          keywords: [
            "no water",
            "no power",
            "no electricity",
            "power is out",
            "water cut off",
            "no gas",
          ],
        },
        {
          key: "essential_service_failure",
          label: "A failure of an essential service or appliance for hot water, cooking or heating",
          keywords: [
            "no hot water",
            "hot water not working",
            "stove not working",
            "oven not working",
            "cooktop not working",
          ],
        },
        {
          key: "unsafe_or_insecure",
          label: "A fault or damage that makes the premises unsafe or insecure",
          keywords: [
            "unsafe",
            "insecure",
            "broken lock",
            "can't lock",
            "door won't lock",
            "window won't close",
            "break-in",
          ],
        },
      ],
    },
    effectiveFrom: null,
    effectiveTo: null,
    sourceUrl: RTA,
    sourceNote:
      "Spec §6: the RTRA s214 statutory emergency-repairs list, enumerated verbatim from the spec. `keywords` are an application triage heuristic, not part of the statute.",
    needsHumanConfirmation: false,
    notes:
      "Used by the maintenance triage to flag EMERGENCY vs routine (spec §9). A keyword hit is a flag for human/LLM review, not a legal determination.",
  },

  // --- RTA forms ------------------------------------------------------------
  {
    jurisdiction: "QLD",
    key: "forms",
    version: "qld-2025-regulation",
    value: {
      forms: [
        {
          formId: "18a",
          purpose: "General tenancy agreement",
          action: "general_tenancy_agreement",
          updatedUnder2025Regulation: true,
          needsHumanConfirmation: false,
        },
        {
          formId: "9",
          purpose: "Entry notice",
          action: "entry_notice",
          updatedUnder2025Regulation: false,
          needsHumanConfirmation: false,
        },
        {
          formId: "11",
          purpose: "Notice to remedy breach",
          action: "notice_to_remedy_breach",
          updatedUnder2025Regulation: false,
          needsHumanConfirmation: false,
        },
        {
          formId: "12",
          purpose: "Notice to leave",
          action: "notice_to_leave",
          updatedUnder2025Regulation: false,
          needsHumanConfirmation: false,
        },
        {
          formId: "13",
          purpose: "Notice of intention to leave",
          action: "notice_of_intention_to_leave",
          updatedUnder2025Regulation: false,
          needsHumanConfirmation: false,
        },
        {
          formId: "R12",
          purpose: "Disputed bond (refund of rental bond)",
          action: "disputed_bond",
          updatedUnder2025Regulation: false,
          needsHumanConfirmation: false,
        },
        {
          formId: "18b",
          purpose: "Moveable dwelling tenancy agreement",
          action: null,
          updatedUnder2025Regulation: true,
          needsHumanConfirmation: false,
        },
        {
          formId: "R18",
          purpose: "Rooming accommodation agreement",
          action: null,
          updatedUnder2025Regulation: true,
          needsHumanConfirmation: false,
        },
      ],
    },
    effectiveFrom: null,
    effectiveTo: null,
    sourceUrl: RTA,
    sourceNote:
      "RTA forms relevant to drafting — 18a (general tenancy agreement), 18b (moveable dwelling tenancy agreement, confirmed from the official RTA form), 9 (entry notice), 11 (notice to remedy breach), 12 (notice to leave), 13 (notice of intention to leave), R12 (disputed bond). 18a/18b/R18 were updated under the 2025 Regulation.",
    needsHumanConfirmation: false,
    notes:
      "Confirm exact current form versions from the RTA forms page before generating any statutory document (Phase 4). R18 (rooming accommodation agreement) confirmed from the official RTA form; rooming accommodation is out of v1 residential scope but the metadata is recorded.",
  },

  // --- Notice periods for Forms 11/12 (UNCONFIRMED — never invented) --------
  // The spec did not state these periods, and the 2024/2025 reforms changed
  // several of them. They are seeded with value null + needsHumanConfirmation
  // so the engine THROWS until a human confirms the current RTA value (§0.3).
  {
    jurisdiction: "QLD",
    key: "notice_remedy_breach_rent_arrears",
    version: "qld-unconfirmed",
    value: null,
    effectiveFrom: null,
    effectiveTo: null,
    sourceUrl: RTA,
    sourceNote:
      "Form 11 (Notice to Remedy Breach) remedy period for unpaid rent — NOT stated in the spec; confirm the current value from the RTA before use.",
    needsHumanConfirmation: true,
    notes:
      "To activate: confirm the rent-arrears remedy period (days) for a Notice to Remedy Breach (Form 11) from rta.qld.gov.au, set value {days: N}, set needsHumanConfirmation:false, and add any newly-asserted hard date to SPEC_ASSERTED_DATES.",
  },
  {
    jurisdiction: "QLD",
    key: "notice_to_leave_unremedied_breach",
    version: "qld-unconfirmed",
    value: null,
    effectiveFrom: null,
    effectiveTo: null,
    sourceUrl: RTA,
    sourceNote:
      "Form 12 (Notice to Leave) notice period where a Form 11 breach is not remedied — NOT stated in the spec; confirm from the RTA before use.",
    needsHumanConfirmation: true,
    notes:
      "To activate: confirm the notice period (days) for a Notice to Leave (Form 12) following an unremedied breach, set value {days: N}, set needsHumanConfirmation:false.",
  },
  {
    jurisdiction: "QLD",
    key: "notice_to_leave_end_of_fixed_term",
    version: "qld-unconfirmed",
    value: null,
    effectiveFrom: null,
    effectiveTo: null,
    sourceUrl: RTA,
    sourceNote:
      "Form 12 (Notice to Leave) notice period at the end of a fixed-term agreement — NOT stated in the spec, and changed by the 2024 reforms; confirm from the RTA before use.",
    needsHumanConfirmation: true,
    notes:
      "To activate: confirm the end-of-fixed-term notice period (days) for a Notice to Leave (Form 12) under the current rules, set value {days: N}, set needsHumanConfirmation:false.",
  },

  // --- Prescribed house-rules transition (forward-dated) --------------------
  {
    jurisdiction: "QLD",
    key: "house_rules_transition",
    version: "qld-house-rules-2026",
    value: {
      schedule5ContinuesUntil: "2026-08-31",
      newRequirementsFrom: "2026-09-01",
      basis: "2025 Regulation",
    },
    effectiveFrom: null,
    effectiveTo: null,
    sourceUrl: QLD_LEGISLATION,
    sourceNote:
      "Spec §6: existing Schedule 5 (2009 Regulation) house rules continue until 31 August 2026; from 1 September 2026 all prescribed house rules must meet the 2025 Regulation requirements.",
    needsHumanConfirmation: false,
    notes:
      "FORWARD-DATED CHANGE: prescribed house rules must be re-checked against the 2025 Regulation from 2026-09-01. Surface to affected agencies ahead of that date.",
  },
];

/** The canonical, validated QLD rule set. Parsing here fails loudly if a row is malformed. */
export const QLD_RULES: readonly RegulatoryRule[] = Object.freeze(
  regulatoryRuleSchema.array().parse(RAW),
);

/** The only hard effective-dates the spec asserts. `seed.test.ts` guards this. */
export const SPEC_ASSERTED_DATES = [
  "2024-06-06",
  "2024-09-01",
  "2025-05-01",
  "2025-09-01",
  "2026-08-31",
  "2026-09-01",
  // governing-framework duplicates 2025-09-01; the 2024-06-05 boundary is
  // (effective date - 1 day) of an asserted date, allowed explicitly below.
  "2024-06-05",
] as const;
