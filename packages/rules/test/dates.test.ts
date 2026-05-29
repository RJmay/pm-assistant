import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  compareIso,
  daysInMonth,
  InvalidDateError,
  isOnOrAfter,
  isOnOrBefore,
  maxIso,
  parseIsoDate,
} from "../src/dates";

describe("daysInMonth", () => {
  it("knows leap vs non-leap February", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
    expect(daysInMonth(1900, 2)).toBe(28); // divisible by 100, not 400
  });
  it("handles 30- and 31-day months", () => {
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 12)).toBe(31);
  });
});

describe("parseIsoDate", () => {
  it("accepts a valid date", () => {
    expect(parseIsoDate("2025-09-01")).toBe("2025-09-01");
  });
  it("rejects malformed or impossible dates", () => {
    expect(() => parseIsoDate("not-a-date")).toThrow(InvalidDateError);
    expect(() => parseIsoDate("2024-13-01")).toThrow(InvalidDateError);
    expect(() => parseIsoDate("2023-02-29")).toThrow(InvalidDateError); // not a leap year
    expect(() => parseIsoDate("2024-04-31")).toThrow(InvalidDateError);
    expect(() => parseIsoDate("2024-1-1")).toThrow(InvalidDateError); // not zero-padded
  });
});

describe("addMonths", () => {
  it("clamps the day to the target month length", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // leap
    expect(addMonths("2023-01-31", 1)).toBe("2023-02-28"); // non-leap
    expect(addMonths("2024-03-31", 1)).toBe("2024-04-30");
  });
  it("rolls over years", () => {
    expect(addMonths("2024-12-15", 1)).toBe("2025-01-15");
    expect(addMonths("2024-06-06", 12)).toBe("2025-06-06");
  });
  it("supports negative offsets", () => {
    expect(addMonths("2025-01-15", -1)).toBe("2024-12-15");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
  });
});

describe("comparison", () => {
  it("orders chronologically", () => {
    expect(compareIso("2024-06-05", "2024-06-06")).toBe(-1);
    expect(compareIso("2024-06-06", "2024-06-06")).toBe(0);
    expect(compareIso("2025-01-01", "2024-12-31")).toBe(1);
  });
  it("on-or-after / on-or-before are inclusive", () => {
    expect(isOnOrAfter("2024-06-06", "2024-06-06")).toBe(true);
    expect(isOnOrAfter("2024-06-05", "2024-06-06")).toBe(false);
    expect(isOnOrBefore("2024-06-06", "2024-06-06")).toBe(true);
    expect(isOnOrBefore("2024-06-07", "2024-06-06")).toBe(false);
  });
  it("maxIso returns the latest", () => {
    expect(maxIso("2024-01-01", "2025-06-06", "2024-12-31")).toBe("2025-06-06");
    expect(maxIso("2024-01-01")).toBe("2024-01-01");
  });
});
