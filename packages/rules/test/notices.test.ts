import { describe, expect, it } from "vitest";
import {
  noticePeriodEnd,
  noticeToLeaveRequirements,
  noticeToRemedyBreachRequirements,
  remedyByDate,
} from "../src";

const ASOF = "2026-06-03";

describe("noticeToRemedyBreachRequirements (Form 11, rent arrears)", () => {
  it("returns the RTA-confirmed 7-day remedy period + Form 11", () => {
    const req = noticeToRemedyBreachRequirements(ASOF);
    expect(req.remedyDays).toBe(7);
    expect(req.formId).toBe("11");
    expect(req.ruleVersions.length).toBeGreaterThan(0);
    expect(remedyByDate(ASOF, req.remedyDays)).toBe("2026-06-10");
  });
});

describe("noticeToLeaveRequirements (Form 12)", () => {
  it("unremedied rent breach is 7 DAYS", () => {
    const req = noticeToLeaveRequirements("unremedied_breach", ASOF);
    expect(req.period).toBe(7);
    expect(req.unit).toBe("days");
    expect(req.formId).toBe("12");
    expect(noticePeriodEnd(ASOF, req)).toBe("2026-06-10");
  });

  it("end of fixed term is 2 MONTHS (not days)", () => {
    const req = noticeToLeaveRequirements("end_of_fixed_term", ASOF);
    expect(req.period).toBe(2);
    expect(req.unit).toBe("months");
    expect(req.formId).toBe("12");
    // 2026-06-03 + 2 months = 2026-08-03
    expect(noticePeriodEnd(ASOF, req)).toBe("2026-08-03");
  });
});
