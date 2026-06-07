import { z } from "zod";

// ============================================================================
// @pm/rules — schemas & types
// ============================================================================
// The QLD compliance rules engine. Everything here is DETERMINISTIC data +
// code — never LLM output (PM-Manager_Build_Spec.md §6, §13). Rules are stored
// as versioned rows selected by effective date, mirroring the spec's
// `regulatory_rules` table (§4). The canonical seed lives in `seed.ts`; this
// file defines the shape every rule must satisfy and the per-key value
// schemas the accessors validate against.
//
// PROVENANCE RULE (spec §0.3): we never invent a regulatory fact. Each rule
// carries a `sourceNote`. Where the spec deliberately did NOT state a value
// (e.g. the post-1-May-2025 entry-notice period), the rule is seeded with a
// null value and `needsHumanConfirmation: true` so the engine refuses to guess.
// ============================================================================

/** Calendar date, `YYYY-MM-DD`. Lexical order == chronological order. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO calendar date (YYYY-MM-DD)");

export const RULE_KEYS = [
  "governing_framework",
  "rent_increase_frequency",
  "rent_increase_min_notice",
  "rent_bidding_ban",
  "minimum_housing_standards",
  "entry_notice_routine",
  "entry_frequency_cap",
  "emergency_repairs_s214",
  "forms",
  "house_rules_transition",
  // Notice periods for Forms 11/12 — RTA-confirmed (see seed.ts). Rent-arrears
  // and end-of-term were confirmed first; the general-breach + moveable-dwelling
  // variants were added later (same RTA pages). Any value seeded with
  // `needsHumanConfirmation: true` makes the engine refuse to guess (§0.3).
  "notice_remedy_breach_rent_arrears",
  "notice_remedy_breach_rent_arrears_moveable",
  "notice_remedy_breach_general",
  "notice_to_leave_unremedied_breach",
  "notice_to_leave_unremedied_general_breach",
  "notice_to_leave_end_of_fixed_term",
] as const;

export const ruleKeySchema = z.enum(RULE_KEYS);
export type RuleKey = z.infer<typeof ruleKeySchema>;

/**
 * The envelope every rule version shares. `value` is `unknown` here because
 * its shape varies by key; the typed accessors in the other modules re-parse
 * `value` with the matching per-key schema below before use.
 *
 * `effectiveFrom: null` means "in force since before our records / inception"
 * (we don't assert a start date we don't know). `effectiveTo: null` means
 * "still in force".
 */
export const regulatoryRuleSchema = z.object({
  jurisdiction: z.literal("QLD"),
  key: ruleKeySchema,
  version: z.string().min(1),
  value: z.unknown(),
  effectiveFrom: isoDateSchema.nullable(),
  effectiveTo: isoDateSchema.nullable(),
  sourceUrl: z.string().nullable(),
  sourceNote: z.string().min(1),
  needsHumanConfirmation: z.boolean(),
  notes: z.string().nullable(),
});
export type RegulatoryRule = z.infer<typeof regulatoryRuleSchema>;

// ----------------------------------------------------------------------------
// Per-key value schemas (the shape stored in `value` for each key)
// ----------------------------------------------------------------------------

export const rentIncreaseFrequencyValueSchema = z.object({
  minIntervalMonths: z.number().int().positive(),
  /** Since 6 Jun 2024 the 12-month limit attaches to the property, not the tenancy (spec §6). */
  appliesTo: z.enum(["property", "tenancy"]),
});
export type RentIncreaseFrequencyValue = z.infer<typeof rentIncreaseFrequencyValueSchema>;

export const monthsValueSchema = z.object({ months: z.number().int().positive() });

/** A notice/remedy period expressed in days (Forms 11/12). */
export const daysValueSchema = z.object({ days: z.number().int().positive() });

export const banValueSchema = z.object({
  banned: z.boolean(),
  scope: z.string().min(1),
});

export const housingStandardsValueSchema = z.object({
  inForce: z.boolean(),
  allTenanciesFrom: isoDateSchema,
});

/** Routine-entry notice periods (confirmed from the RTA, form versions Nov 2025). */
export const entryNoticeValueSchema = z.object({
  routineInspectionNoticeDays: z.number().int().positive(),
  generalEntryNoticeHours: z.number().int().positive(),
});

/** Routine-inspection frequency cap (confirmed from the RTA). */
export const entryFrequencyValueSchema = z.object({
  minMonthsBetween: z.number().int().positive(),
  overridableByTenantConsent: z.boolean(),
});

export const emergencyRepairItemSchema = z.object({
  /** stable id for the statutory item */
  key: z.string().min(1),
  /** the statutory item as worded from the RTRA s214 list (spec §6) */
  label: z.string().min(1),
  /** OUR triage heuristic — substrings that suggest this item. NOT statutory. */
  keywords: z.array(z.string().min(1)).min(1),
});
export type EmergencyRepairItem = z.infer<typeof emergencyRepairItemSchema>;

export const emergencyRepairsValueSchema = z.object({
  statute: z.string().min(1),
  items: z.array(emergencyRepairItemSchema).min(1),
});

export const formActionSchema = z.enum([
  "general_tenancy_agreement",
  "entry_notice",
  "notice_to_remedy_breach",
  "notice_to_leave",
  "notice_of_intention_to_leave",
  "disputed_bond",
]);
export type FormAction = z.infer<typeof formActionSchema>;

export const formDefinitionSchema = z.object({
  formId: z.string().min(1),
  /** purpose as stated in the spec, or null where the spec didn't say */
  purpose: z.string().nullable(),
  /** the action this form serves, or null if the spec listed it without a use */
  action: formActionSchema.nullable(),
  updatedUnder2025Regulation: z.boolean(),
  needsHumanConfirmation: z.boolean(),
});
export type FormDefinition = z.infer<typeof formDefinitionSchema>;

export const formsValueSchema = z.object({
  forms: z.array(formDefinitionSchema).min(1),
});

export const houseRulesTransitionValueSchema = z.object({
  schedule5ContinuesUntil: isoDateSchema,
  newRequirementsFrom: isoDateSchema,
  basis: z.string().min(1),
});

export const governingFrameworkValueSchema = z.object({
  act: z.string().min(1),
  regulation: z.string().min(1),
  regulationCommenced: isoDateSchema,
  authority: z.string().min(1),
  tribunal: z.string().min(1),
});
