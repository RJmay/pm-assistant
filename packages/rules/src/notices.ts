import { addDays } from "./dates";
import { getConfiguredRule } from "./engine";
import { selectForm } from "./forms";
import { daysValueSchema, type RegulatoryRule } from "./schema";
import { QLD_RULES } from "./seed";

// ============================================================================
// Notice periods for Forms 11 & 12 — deterministic, rules-driven (spec §6/§10)
// ============================================================================
// The periods come from the rules engine. They're seeded UNCONFIRMED, so these
// accessors THROW `RuleNotConfiguredError` until a human supplies the current
// RTA value (§0.3 — never invent a regulatory fact). The Form numbers come from
// the confirmed `forms` rule. `source` is injectable so a confirmed value can
// be exercised in tests without changing the production seed.
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
  /** Days of notice before the handover day. */
  noticeDays: number;
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
  const key =
    ground === "unremedied_breach"
      ? "notice_to_leave_unremedied_breach"
      : "notice_to_leave_end_of_fixed_term";
  const rule = getConfiguredRule(key, asOf, source);
  const { days } = daysValueSchema.parse(rule.value);
  const form = selectForm("notice_to_leave", asOf);
  return {
    noticeDays: days,
    ground,
    formId: form.formId,
    ruleVersions: [rule.version, `form-${form.formId}`],
  };
}

/** The earliest handover day for a Form 12 issued on `noticeDate`. */
export function handoverDate(noticeDate: string, noticeDays: number): string {
  return addDays(noticeDate, noticeDays);
}
