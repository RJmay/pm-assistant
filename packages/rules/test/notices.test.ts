import { describe, expect, it } from "vitest";
import {
  noticeOfIntentionToLeaveRequirements,
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
    expect(req.breach).toBe("rent");
    expect(req.dwelling).toBe("general");
    expect(req.formId).toBe("11");
    expect(req.ruleVersions.length).toBeGreaterThan(0);
    expect(remedyByDate(ASOF, req.remedyDays)).toBe("2026-06-10");
  });
});

describe("noticeToRemedyBreachRequirements — breach + dwelling variants", () => {
  it("general (non-rent) breach is 7 days", () => {
    const req = noticeToRemedyBreachRequirements(ASOF, { breach: "general" });
    expect(req.remedyDays).toBe(7);
    expect(req.breach).toBe("general");
  });

  it("moveable-dwelling rent arrears is 5 days", () => {
    const req = noticeToRemedyBreachRequirements(ASOF, { breach: "rent", dwelling: "moveable" });
    expect(req.remedyDays).toBe(5);
    expect(req.dwelling).toBe("moveable");
    expect(remedyByDate(ASOF, req.remedyDays)).toBe("2026-06-08");
  });

  it("a general breach in a moveable dwelling is still 7 days", () => {
    const req = noticeToRemedyBreachRequirements(ASOF, { breach: "general", dwelling: "moveable" });
    expect(req.remedyDays).toBe(7);
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

  it("unremedied GENERAL (non-rent) breach is 14 DAYS", () => {
    const req = noticeToLeaveRequirements("unremedied_general_breach", ASOF);
    expect(req.period).toBe(14);
    expect(req.unit).toBe("days");
    expect(req.formId).toBe("12");
    expect(noticePeriodEnd(ASOF, req)).toBe("2026-06-17");
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

describe("noticeOfIntentionToLeaveRequirements (Form 13)", () => {
  it("periodic without grounds is 14 days", () => {
    const req = noticeOfIntentionToLeaveRequirements("periodic", ASOF);
    expect(req.period).toBe(14);
    expect(req.unit).toBe("days");
    expect(req.formId).toBe("13");
    expect(noticePeriodEnd(ASOF, req)).toBe("2026-06-17");
  });

  it("unremedied (lessor) breach is 7 days", () => {
    const req = noticeOfIntentionToLeaveRequirements("unremedied_breach", ASOF);
    expect(req.period).toBe(7);
    expect(req.formId).toBe("13");
    expect(noticePeriodEnd(ASOF, req)).toBe("2026-06-10");
  });

  it("end of fixed term is 14 days", () => {
    const req = noticeOfIntentionToLeaveRequirements("end_of_fixed_term", ASOF);
    expect(req.period).toBe(14);
    expect(req.unit).toBe("days");
    expect(req.formId).toBe("13");
  });

  it("a 14-day additional ground (sale not disclosed) is 14 days", () => {
    const req = noticeOfIntentionToLeaveRequirements("sale_not_disclosed", ASOF);
    expect(req.period).toBe(14);
    expect(req.formId).toBe("13");
    expect(noticePeriodEnd(ASOF, req)).toBe("2026-06-17");
  });

  it("non-compliance with a tribunal order is 7 days", () => {
    const req = noticeOfIntentionToLeaveRequirements("tribunal_order_non_compliance", ASOF);
    expect(req.period).toBe(7);
    expect(req.formId).toBe("13");
    expect(noticePeriodEnd(ASOF, req)).toBe("2026-06-10");
  });

  it("domestic & family violence is 7 days", () => {
    const req = noticeOfIntentionToLeaveRequirements("dfv", ASOF);
    expect(req.period).toBe(7);
    expect(req.formId).toBe("13");
  });

  it("non-liveability is immediate (0 days) — vacate date = notice date", () => {
    const req = noticeOfIntentionToLeaveRequirements("non_liveability", ASOF);
    expect(req.period).toBe(0);
    expect(req.unit).toBe("days");
    expect(noticePeriodEnd(ASOF, req)).toBe(ASOF);
  });
});
