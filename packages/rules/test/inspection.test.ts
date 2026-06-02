import { describe, expect, it } from "vitest";
import { earliestRoutineInspectionDate, entryNoticeRequirements } from "../src";

// Entry rules took their current form on 2025-05-01; evaluate after that.
const ASOF = "2026-06-02";

describe("entryNoticeRequirements", () => {
  it("returns the confirmed QLD routine-entry requirements + Form 9", () => {
    const req = entryNoticeRequirements(ASOF);
    expect(req.routineInspectionNoticeDays).toBe(7);
    expect(req.minMonthsBetween).toBe(3);
    expect(req.overridableByTenantConsent).toBe(true);
    expect(req.formId).toBe("9");
    expect(req.ruleVersions.length).toBeGreaterThan(0);
  });
});

describe("earliestRoutineInspectionDate", () => {
  it("is the notice period after the notice date when there's no prior inspection", () => {
    const w = earliestRoutineInspectionDate({ noticeDate: ASOF, lastInspectionDate: null });
    expect(w.earliestDate).toBe("2026-06-09"); // 2026-06-02 + 7 days
    expect(w.cappedByFrequency).toBe(false);
  });

  it("is bound by the notice period when the last inspection is well in the past", () => {
    const w = earliestRoutineInspectionDate({
      noticeDate: ASOF,
      lastInspectionDate: "2025-01-01",
    });
    expect(w.earliestDate).toBe("2026-06-09");
    expect(w.cappedByFrequency).toBe(false);
  });

  it("is bound by the frequency cap when the last inspection was recent", () => {
    const w = earliestRoutineInspectionDate({
      noticeDate: ASOF,
      lastInspectionDate: "2026-04-01", // + 3 months = 2026-07-01, later than notice
    });
    expect(w.earliestDate).toBe("2026-07-01");
    expect(w.cappedByFrequency).toBe(true);
  });
});
