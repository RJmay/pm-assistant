import { addDays, addMonths } from "./dates";
import { getConfiguredRule } from "./engine";
import { selectForm } from "./forms";
import { daysValueSchema, monthsValueSchema, type RegulatoryRule, type RuleKey } from "./schema";
import { QLD_RULES } from "./seed";

// ============================================================================
// Notice periods for Forms 11 & 12 — deterministic, rules-driven (spec §6/§10)
// ============================================================================
// The periods come from the rules engine (RTA-confirmed). `source` is injectable
// so values can be exercised in tests without changing the production seed. Note
// the end-of-fixed-term Form 12 period is in MONTHS, not days, and the handover
// date is the later of (notice + period) and the lease end date.
// ============================================================================

/** Rent arrears vs a general (non-rent) breach of the agreement. */
export type BreachKind = "rent" | "general";
/** A general tenancy vs a moveable dwelling (caravan park) — different periods. */
export type DwellingType = "general" | "moveable";

export interface NoticeToRemedyBreachRequirements {
  /** Days the tenant has to remedy the breach. */
  remedyDays: number;
  breach: BreachKind;
  dwelling: DwellingType;
  formId: string;
  ruleVersions: string[];
}

export interface NoticeToRemedyBreachOptions {
  /** Rent arrears vs a general (non-rent) breach. Default "rent". */
  breach?: BreachKind;
  /** General tenancy vs moveable dwelling (caravan park). Default "general". */
  dwelling?: DwellingType;
}

/** The rule key for a Form 11 remedy period, by breach kind + dwelling type. */
function remedyBreachRuleKey(breach: BreachKind, dwelling: DwellingType): RuleKey {
  // A general (non-rent) breach is 7 days for both dwelling types; only rent
  // arrears differ (7 days general tenancy, 5 days moveable dwelling).
  if (breach === "general") return "notice_remedy_breach_general";
  return dwelling === "moveable"
    ? "notice_remedy_breach_rent_arrears_moveable"
    : "notice_remedy_breach_rent_arrears";
}

/** Form 11 (Notice to Remedy Breach) requirements for the given breach + dwelling. */
export function noticeToRemedyBreachRequirements(
  asOf: string,
  opts: NoticeToRemedyBreachOptions = {},
  source: readonly RegulatoryRule[] = QLD_RULES,
): NoticeToRemedyBreachRequirements {
  const breach = opts.breach ?? "rent";
  const dwelling = opts.dwelling ?? "general";
  const rule = getConfiguredRule(remedyBreachRuleKey(breach, dwelling), asOf, source);
  const { days } = daysValueSchema.parse(rule.value);
  const form = selectForm("notice_to_remedy_breach", asOf);
  return {
    remedyDays: days,
    breach,
    dwelling,
    formId: form.formId,
    ruleVersions: [rule.version, `form-${form.formId}`],
  };
}

/** The earliest "remedy by" date for a Form 11 issued on `noticeDate`. */
export function remedyByDate(noticeDate: string, remedyDays: number): string {
  return addDays(noticeDate, remedyDays);
}

export type NoticeToLeaveGround =
  | "unremedied_breach"
  | "unremedied_general_breach"
  | "end_of_fixed_term";

export interface NoticeToLeaveRequirements {
  /** The notice period amount. */
  period: number;
  /** Whether `period` is in days (unremedied breach) or months (end of term). */
  unit: "days" | "months";
  ground: NoticeToLeaveGround;
  formId: string;
  ruleVersions: string[];
}

/** Form 12 (Notice to Leave) requirements for a given ground. */
export function noticeToLeaveRequirements(
  ground: NoticeToLeaveGround,
  asOf: string,
  source: readonly RegulatoryRule[] = QLD_RULES,
): NoticeToLeaveRequirements {
  const form = selectForm("notice_to_leave", asOf);
  if (ground === "end_of_fixed_term") {
    const rule = getConfiguredRule("notice_to_leave_end_of_fixed_term", asOf, source);
    const { months } = monthsValueSchema.parse(rule.value);
    return {
      period: months,
      unit: "months",
      ground,
      formId: form.formId,
      ruleVersions: [rule.version, `form-${form.formId}`],
    };
  }
  // Both unremedied-breach grounds are expressed in days; only the period
  // differs (rent arrears 7 days, general breach 14 days).
  const key =
    ground === "unremedied_general_breach"
      ? "notice_to_leave_unremedied_general_breach"
      : "notice_to_leave_unremedied_breach";
  const rule = getConfiguredRule(key, asOf, source);
  const { days } = daysValueSchema.parse(rule.value);
  return {
    period: days,
    unit: "days",
    ground,
    formId: form.formId,
    ruleVersions: [rule.version, `form-${form.formId}`],
  };
}

/** `noticeDate` + the requirement's period (respecting its days/months unit). */
export function noticePeriodEnd(
  noticeDate: string,
  req: { period: number; unit: "days" | "months" },
): string {
  return req.unit === "months"
    ? addMonths(noticeDate, req.period)
    : addDays(noticeDate, req.period);
}

// ----------------------------------------------------------------------------
// Notice of intention to leave (Form 13) — the TENANT's notice (spec §10)
// ----------------------------------------------------------------------------
// The mirror of Form 12: the tenant ends the tenancy. v1 supports the three
// common grounds; periods come from @pm/rules. End of fixed term computes the
// vacate date as the later of (notice + period) and the lease end date.

export type NoticeOfIntentionToLeaveGround = "periodic" | "end_of_fixed_term" | "unremedied_breach";

export interface NoticeOfIntentionToLeaveRequirements {
  /** The notice period, in days (all v1 Form 13 grounds are in days). */
  period: number;
  unit: "days";
  ground: NoticeOfIntentionToLeaveGround;
  formId: string;
  ruleVersions: string[];
}

/** Form 13 (Notice of Intention to Leave) requirements for a given ground. */
export function noticeOfIntentionToLeaveRequirements(
  ground: NoticeOfIntentionToLeaveGround,
  asOf: string,
  source: readonly RegulatoryRule[] = QLD_RULES,
): NoticeOfIntentionToLeaveRequirements {
  const form = selectForm("notice_of_intention_to_leave", asOf);
  const key =
    ground === "periodic"
      ? "notice_intention_to_leave_periodic"
      : ground === "end_of_fixed_term"
        ? "notice_intention_to_leave_end_of_fixed_term"
        : "notice_intention_to_leave_unremedied_breach";
  const rule = getConfiguredRule(key, asOf, source);
  const { days } = daysValueSchema.parse(rule.value);
  return {
    period: days,
    unit: "days",
    ground,
    formId: form.formId,
    ruleVersions: [rule.version, `form-${form.formId}`],
  };
}
