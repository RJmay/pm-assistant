import { addMonths, compareIso, isOnOrAfter, maxIso, parseIsoDate } from "./dates";
import { getConfiguredRule } from "./engine";
import { monthsValueSchema, type RegulatoryRule, rentIncreaseFrequencyValueSchema } from "./schema";

// ============================================================================
// Rent-increase eligibility — deterministic, rules-driven (spec §6)
// ============================================================================
// Two statutory constraints, both sourced from the rules engine:
//   1. Frequency: at most once every 12 months. Since 6 Jun 2024 the 12-month
//      window attaches to the PROPERTY, not the tenancy — so the caller passes
//      the property's last-increase date when evaluating on/after that date.
//   2. Notice: at least 2 months' written notice before the increase takes
//      effect.
// The result carries the rule versions used so the caller can audit-log them
// (spec §6: "All outputs carry the rule_version used").
// ============================================================================

export interface RentIncreaseQuery {
  /** Date the increase is proposed to take effect (YYYY-MM-DD). */
  proposedEffectiveDate: string;
  /** Date written notice was (or will be) given (YYYY-MM-DD). */
  noticeDate: string;
  /**
   * Date of the last rent increase for the relevant unit (property on/after
   * 2024-06-06, otherwise tenancy), or null if there has never been one.
   */
  lastIncreaseDate: string | null;
}

export interface RentIncreaseAssessment {
  allowed: boolean;
  reasons: string[];
  /** Earliest effective date that would satisfy both constraints. */
  earliestCompliantDate: string;
  /** Whether the 12-month window is measured per property or per tenancy on the proposed date. */
  basis: "property" | "tenancy";
  intervalOk: boolean;
  noticeOk: boolean;
  minIntervalMonths: number;
  minNoticeMonths: number;
  ruleVersions: string[];
}

function frequencyRule(asOf: string): RegulatoryRule {
  return getConfiguredRule("rent_increase_frequency", asOf);
}

function noticeRule(asOf: string): RegulatoryRule {
  return getConfiguredRule("rent_increase_min_notice", asOf);
}

/**
 * Assess whether a proposed rent increase is compliant. Pure function: all
 * dates are explicit, so it is fully deterministic and testable across the
 * 6 Jun 2024 effective-date boundary.
 */
export function assessRentIncrease(query: RentIncreaseQuery): RentIncreaseAssessment {
  const proposed = parseIsoDate(query.proposedEffectiveDate);
  const notice = parseIsoDate(query.noticeDate);
  const last = query.lastIncreaseDate === null ? null : parseIsoDate(query.lastIncreaseDate);

  const freq = frequencyRule(proposed);
  const freqValue = rentIncreaseFrequencyValueSchema.parse(freq.value);
  const notc = noticeRule(proposed);
  const noticeValue = monthsValueSchema.parse(notc.value);

  const minIntervalMonths = freqValue.minIntervalMonths;
  const minNoticeMonths = noticeValue.months;

  const reasons: string[] = [];

  // Constraint 1 — frequency.
  const earliestByInterval = last === null ? null : addMonths(last, minIntervalMonths);
  const intervalOk = earliestByInterval === null || isOnOrAfter(proposed, earliestByInterval);
  if (!intervalOk && earliestByInterval !== null) {
    reasons.push(
      `Only one increase is allowed every ${minIntervalMonths} months (per ${freqValue.appliesTo}); ` +
        `the last increase was ${last}, so the earliest compliant effective date is ${earliestByInterval}.`,
    );
  }

  // Constraint 2 — notice.
  const earliestByNotice = addMonths(notice, minNoticeMonths);
  const noticeOk = isOnOrAfter(proposed, earliestByNotice);
  if (!noticeOk) {
    reasons.push(
      `At least ${minNoticeMonths} months' written notice is required; notice dated ${notice} ` +
        `supports an effective date no earlier than ${earliestByNotice}.`,
    );
  }

  const earliestCompliantDate =
    earliestByInterval === null ? earliestByNotice : maxIso(earliestByInterval, earliestByNotice);

  return {
    allowed: intervalOk && noticeOk,
    reasons,
    earliestCompliantDate,
    basis: freqValue.appliesTo,
    intervalOk,
    noticeOk,
    minIntervalMonths,
    minNoticeMonths,
    ruleVersions: [freq.version, notc.version],
  };
}

/**
 * Earliest effective date a rent increase could lawfully take, given when
 * notice is served and the last increase. Convenience over `assessRentIncrease`.
 */
export function earliestRentIncreaseDate(query: {
  noticeDate: string;
  lastIncreaseDate: string | null;
}): string {
  const notice = parseIsoDate(query.noticeDate);
  const notc = noticeRule(notice);
  const minNoticeMonths = monthsValueSchema.parse(notc.value).months;
  const byNotice = addMonths(notice, minNoticeMonths);

  if (query.lastIncreaseDate === null) return byNotice;

  const last = parseIsoDate(query.lastIncreaseDate);
  const freq = frequencyRule(notice);
  const minIntervalMonths = rentIncreaseFrequencyValueSchema.parse(freq.value).minIntervalMonths;
  const byInterval = addMonths(last, minIntervalMonths);

  return compareIso(byInterval, byNotice) > 0 ? byInterval : byNotice;
}
