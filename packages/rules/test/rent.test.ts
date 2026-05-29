import { describe, expect, it } from "vitest";
import { assessRentIncrease, earliestRentIncreaseDate } from "../src/rent";

describe("assessRentIncrease — notice constraint (2 months)", () => {
  it("allows an increase with exactly 2 months' notice and no prior increase", () => {
    const r = assessRentIncrease({
      noticeDate: "2025-01-01",
      proposedEffectiveDate: "2025-03-01",
      lastIncreaseDate: null,
    });
    expect(r.allowed).toBe(true);
    expect(r.noticeOk).toBe(true);
    expect(r.intervalOk).toBe(true);
    expect(r.earliestCompliantDate).toBe("2025-03-01");
  });

  it("blocks an increase with under 2 months' notice", () => {
    const r = assessRentIncrease({
      noticeDate: "2025-01-01",
      proposedEffectiveDate: "2025-02-15",
      lastIncreaseDate: null,
    });
    expect(r.allowed).toBe(false);
    expect(r.noticeOk).toBe(false);
    expect(r.earliestCompliantDate).toBe("2025-03-01");
    expect(r.reasons.join(" ")).toMatch(/2 months/);
  });
});

describe("assessRentIncrease — frequency constraint (12 months)", () => {
  it("allows when exactly 12 months have passed", () => {
    const r = assessRentIncrease({
      noticeDate: "2025-03-01",
      proposedEffectiveDate: "2025-06-06",
      lastIncreaseDate: "2024-06-06",
    });
    expect(r.intervalOk).toBe(true);
    expect(r.allowed).toBe(true);
  });

  it("blocks when under 12 months and reports the earliest compliant date", () => {
    const r = assessRentIncrease({
      noticeDate: "2025-01-01",
      proposedEffectiveDate: "2025-06-05",
      lastIncreaseDate: "2024-06-06",
    });
    expect(r.intervalOk).toBe(false);
    expect(r.allowed).toBe(false);
    // max(2024-06-06 + 12m = 2025-06-06, 2025-01-01 + 2m = 2025-03-01)
    expect(r.earliestCompliantDate).toBe("2025-06-06");
    expect(r.reasons.join(" ")).toMatch(/12 months/);
  });
});

describe("assessRentIncrease — property vs tenancy basis across 6 Jun 2024", () => {
  it("uses property basis on/after 2024-06-06", () => {
    const r = assessRentIncrease({
      noticeDate: "2024-06-06",
      proposedEffectiveDate: "2024-06-06",
      lastIncreaseDate: null,
    });
    expect(r.basis).toBe("property");
    expect(r.ruleVersions).toContain("qld-2024-06-06");
  });

  it("uses tenancy basis the day before", () => {
    const r = assessRentIncrease({
      noticeDate: "2024-04-05",
      proposedEffectiveDate: "2024-06-05",
      lastIncreaseDate: null,
    });
    expect(r.basis).toBe("tenancy");
    expect(r.ruleVersions).toContain("qld-pre-2024-06-06");
  });
});

describe("assessRentIncrease — combined", () => {
  it("earliestCompliantDate is the later of the two constraints", () => {
    const r = assessRentIncrease({
      noticeDate: "2025-05-01", // +2m -> 2025-07-01
      proposedEffectiveDate: "2025-06-01",
      lastIncreaseDate: "2024-06-06", // +12m -> 2025-06-06
    });
    expect(r.allowed).toBe(false);
    expect(r.earliestCompliantDate).toBe("2025-07-01"); // notice is the binding constraint
    expect(r.minIntervalMonths).toBe(12);
    expect(r.minNoticeMonths).toBe(2);
  });
});

describe("earliestRentIncreaseDate", () => {
  it("is notice + 2 months when never increased", () => {
    expect(earliestRentIncreaseDate({ noticeDate: "2025-01-01", lastIncreaseDate: null })).toBe(
      "2025-03-01",
    );
  });
  it("is the later of interval and notice when previously increased", () => {
    expect(
      earliestRentIncreaseDate({ noticeDate: "2025-01-01", lastIncreaseDate: "2024-08-01" }),
    ).toBe("2025-08-01");
  });
});
