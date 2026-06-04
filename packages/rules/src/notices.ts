import { addDays, addMonths } from "./dates";
import { getConfiguredRule } from "./engine";
import { selectForm } from "./forms";
import { daysValueSchema, monthsValueSchema, type RegulatoryRule } from "./schema";
import { QLD_RULES } from "./seed";

// ============================================================================
// Notice periods for Forms 11 & 12 — deterministic, rules-driven (spec §6/§10)
// ============================================================================
// The periods come from the rules engine (RTA-confirmed). `source` is injectable
// so values can be exercised in tests without changing the production seed. Note
// the end-of-fixed-term Form 12 period is in MONTHS, not days, and the handover
// date is the later of (notice + period) and the lease end date.
// ============================================================================

export interface NoticeToRemedyBreachRequirements {
  /** Days the tenant has to remedy the breach. */
  remedyDays: number;
  formId: string;
  ruleVersions: string[];
}

/** Form 11 (Notice to Remedy Breach) requirements for a rent-arrears breach. */
export function noticeToRemedyBreachRequirements(
  asOf: string,
  source: readonly RegulatoryRule[] = QLD_RULES,
): NoticeToRemedyBreachRequirements {
  const rule = getConfiguredRule("notice_remedy_breach_rent_arrears", asOf, source);
  const { days } = daysValueSchema.parse(rule.value);
  const form = selectForm("notice_to_remedy_breach", asOf);
  return {
    remedyDays: days,
    formId: form.formId,
    ruleVersions: [rule.version, `form-${form.formId}`],
  };
}

/** The earliest "remedy by" date for a Form 11 issued on `noticeDate`. */
export function remedyByDate(noticeDate: string, remedyDays: number): string {
  return addDays(noticeDate, remedyDays);
}

export type NoticeToLeaveGround = "unremedied_breach" | "end_of_fixed_term";

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
  const rule = getConfiguredRule("notice_to_leave_unremedied_breach", asOf, source);
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
export function noticePeriodEnd(noticeDate: string, req: NoticeToLeaveRequirements): string {
  return req.unit === "months"
    ? addMonths(noticeDate, req.period)
    : addDays(noticeDate, req.period);
}
