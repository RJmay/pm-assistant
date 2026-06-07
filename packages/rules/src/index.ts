// ============================================================================
// @pm/rules — deterministic QLD compliance rules engine
// ============================================================================
// PM-Manager_Build_Spec.md §6: compliance and numeric logic is deterministic
// code + versioned data, never LLM output. This package is stack-agnostic
// (pure TypeScript + zod) so it survives whatever app/runtime decision the
// build settles on. See PHASE_RULES_ENGINE.md / HANDOFF for context.
// ============================================================================

export const PACKAGE_NAME = "@pm/rules";

// Date math
export {
  addDays,
  addMonths,
  compareIso,
  daysInMonth,
  InvalidDateError,
  isOnOrAfter,
  isOnOrBefore,
  maxIso,
  parseIsoDate,
} from "./dates";
export type { EmergencyTriageResult } from "./emergency";
export {
  listEmergencyRepairItems,
  triageEmergencyRepair,
} from "./emergency";
// Rule resolution
export {
  findRule,
  getActiveRules,
  getConfiguredRule,
  getRule,
  getRuleVersions,
  RuleNotConfiguredError,
  RuleNotFoundError,
} from "./engine";
export type { EscalationDetection, EscalationFlag, EscalationTrigger } from "./escalation";
export { detectEscalations } from "./escalation";
export {
  FormNotConfiguredError,
  getFormById,
  listForms,
  NoFormForActionError,
  selectForm,
} from "./forms";
export type { EntryNoticeRequirements, RoutineInspectionWindow } from "./inspection";
export {
  earliestRoutineInspectionDate,
  entryNoticeRequirements,
} from "./inspection";
export type {
  BreachKind,
  DwellingType,
  NoticeToLeaveGround,
  NoticeToLeaveRequirements,
  NoticeToRemedyBreachOptions,
  NoticeToRemedyBreachRequirements,
} from "./notices";
export {
  noticePeriodEnd,
  noticeToLeaveRequirements,
  noticeToRemedyBreachRequirements,
  remedyByDate,
} from "./notices";
export type { RentIncreaseAssessment, RentIncreaseQuery } from "./rent";
// Domain logic
export {
  assessRentIncrease,
  earliestRentIncreaseDate,
} from "./rent";
export type {
  EmergencyRepairItem,
  FormAction,
  FormDefinition,
  RegulatoryRule,
  RentIncreaseFrequencyValue,
  RuleKey,
} from "./schema";
// Schemas & types
export {
  banValueSchema,
  daysValueSchema,
  emergencyRepairItemSchema,
  emergencyRepairsValueSchema,
  entryFrequencyValueSchema,
  entryNoticeValueSchema,
  formActionSchema,
  formDefinitionSchema,
  formsValueSchema,
  governingFrameworkValueSchema,
  houseRulesTransitionValueSchema,
  housingStandardsValueSchema,
  isoDateSchema,
  monthsValueSchema,
  RULE_KEYS,
  regulatoryRuleSchema,
  rentIncreaseFrequencyValueSchema,
  ruleKeySchema,
} from "./schema";
// Canonical seed
export { QLD_RULES, SPEC_ASSERTED_DATES } from "./seed";
