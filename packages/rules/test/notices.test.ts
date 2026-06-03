import { describe, expect, it } from "vitest";
import {
  handoverDate,
  noticeToLeaveRequirements,
  noticeToRemedyBreachRequirements,
  type RegulatoryRule,
  RuleNotConfiguredError,
  remedyByDate,
} from "../src";

const ASOF = "2026-06-03";

function confirmedRule(key: string, days: number): RegulatoryRule {
  return {
    jurisdiction: "QLD",
    key: key as RegulatoryRule["key"],
    version: "test-confirmed",
    value: { days },
    effectiveFrom: null,
    effectiveTo: null,
    sourceUrl: null,
    sourceNote: "test",
    needsHumanConfirmation: false,
    notes: null,
  };
}

describe("notice periods — unconfirmed by default (anti-invention)", () => {
  it("throws until a human confirms the Form 11 remedy period", () => {
    expect(() => noticeToRemedyBreachRequirements(ASOF)).toThrow(RuleNotConfiguredError);
  });

  it("throws until a human confirms the Form 12 notice periods", () => {
    expect(() => noticeToLeaveRequirements("unremedied_breach", ASOF)).toThrow(
      RuleNotConfiguredError,
    );
    expect(() => noticeToLeaveRequirements("end_of_fixed_term", ASOF)).toThrow(
      RuleNotConfiguredError,
    );
  });
});

describe("notice periods — once a value is confirmed", () => {
  it("returns the Form 11 remedy requirements + computes the remedy-by date", () => {
    const source = [confirmedRule("notice_remedy_breach_rent_arrears", 7)];
    const req = noticeToRemedyBreachRequirements(ASOF, source);
    expect(req.remedyDays).toBe(7);
    expect(req.formId).toBe("11");
    expect(req.ruleVersions.length).toBeGreaterThan(0);
    expect(remedyByDate(ASOF, req.remedyDays)).toBe("2026-06-10");
  });

  it("returns the Form 12 requirements per ground + computes the handover date", () => {
    const source = [confirmedRule("notice_to_leave_unremedied_breach", 14)];
    const req = noticeToLeaveRequirements("unremedied_breach", ASOF, source);
    expect(req.noticeDays).toBe(14);
    expect(req.formId).toBe("12");
    expect(req.ground).toBe("unremedied_breach");
    expect(handoverDate(ASOF, req.noticeDays)).toBe("2026-06-17");
  });
});
