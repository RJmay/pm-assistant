import { addDays, addMonths, compareIso } from "./dates";
import { getConfiguredRule } from "./engine";
import { selectForm } from "./forms";
import { entryFrequencyValueSchema, entryNoticeValueSchema } from "./schema";

// ============================================================================
// Routine inspection entry — deterministic, rules-driven (spec §6, §8)
// ============================================================================
// A routine inspection requires a compliant entry notice (Form 9) with the
// statutory notice period, and is capped at a minimum interval between
// inspections (unless the tenant agrees in writing). All of these come from
// the rules engine — the LLM never sources a notice period (spec §6). The
// inspection-scheduling sequence (§8) proposes an entry date that satisfies
// both constraints; the formal Form 9 itself is generated in Phase 4.
// ============================================================================

export interface EntryNoticeRequirements {
  /** Statutory notice days for a routine inspection (Form 9). */
  routineInspectionNoticeDays: number;
  /** Minimum months between routine inspections. */
  minMonthsBetween: number;
  /** Whether the interval cap can be overridden by written tenant consent. */
  overridableByTenantConsent: boolean;
  /** The RTA form for an entry notice (e.g. "9"). */
  formId: string;
  /** Rule versions used, for the audit trail. */
  ruleVersions: string[];
}

/** Current entry-notice requirements for a routine inspection on `asOf`. */
export function entryNoticeRequirements(asOf: string): EntryNoticeRequirements {
  const notice = getConfiguredRule("entry_notice_routine", asOf);
  const noticeValue = entryNoticeValueSchema.parse(notice.value);
  const freq = getConfiguredRule("entry_frequency_cap", asOf);
  const freqValue = entryFrequencyValueSchema.parse(freq.value);
  const form = selectForm("entry_notice", asOf);
  return {
    routineInspectionNoticeDays: noticeValue.routineInspectionNoticeDays,
    minMonthsBetween: freqValue.minMonthsBetween,
    overridableByTenantConsent: freqValue.overridableByTenantConsent,
    formId: form.formId,
    ruleVersions: [notice.version, freq.version, `form-${form.formId}`],
  };
}

export interface RoutineInspectionWindow {
  /** Earliest entry date that satisfies BOTH notice period and frequency cap. */
  earliestDate: string;
  /** True when the frequency cap (not the notice period) is the binding limit. */
  cappedByFrequency: boolean;
  requirements: EntryNoticeRequirements;
}

/**
 * Earliest compliant routine-inspection entry date: at least the notice period
 * after `noticeDate`, and — if there was a prior inspection — at least the
 * minimum interval after it. Pure and deterministic.
 */
export function earliestRoutineInspectionDate(opts: {
  /** Date the entry notice would be served (YYYY-MM-DD). */
  noticeDate: string;
  /** Date of the last routine inspection, or null if none on record. */
  lastInspectionDate: string | null;
  /** Date to resolve rules as of; defaults to `noticeDate`. */
  asOf?: string;
}): RoutineInspectionWindow {
  const requirements = entryNoticeRequirements(opts.asOf ?? opts.noticeDate);
  const byNotice = addDays(opts.noticeDate, requirements.routineInspectionNoticeDays);
  if (!opts.lastInspectionDate) {
    return { earliestDate: byNotice, cappedByFrequency: false, requirements };
  }
  const byFrequency = addMonths(opts.lastInspectionDate, requirements.minMonthsBetween);
  const cappedByFrequency = compareIso(byFrequency, byNotice) > 0;
  return {
    earliestDate: cappedByFrequency ? byFrequency : byNotice,
    cappedByFrequency,
    requirements,
  };
}
