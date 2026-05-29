import { describe, expect, it } from "vitest";
import {
  findRule,
  getActiveRules,
  getConfiguredRule,
  getRule,
  getRuleVersions,
  RuleNotConfiguredError,
  RuleNotFoundError,
} from "../src/engine";
import { type RegulatoryRule, rentIncreaseFrequencyValueSchema } from "../src/schema";

describe("getRule — version selection by effective date", () => {
  it("returns the property-based frequency rule on/after 2024-06-06", () => {
    const rule = getRule("rent_increase_frequency", "2024-06-06");
    expect(rule.version).toBe("qld-2024-06-06");
    expect(rentIncreaseFrequencyValueSchema.parse(rule.value).appliesTo).toBe("property");
  });

  it("returns the tenancy-based frequency rule the day before the reform", () => {
    const rule = getRule("rent_increase_frequency", "2024-06-05");
    expect(rule.version).toBe("qld-pre-2024-06-06");
    expect(rentIncreaseFrequencyValueSchema.parse(rule.value).appliesTo).toBe("tenancy");
  });

  it("treats a null effectiveFrom as in force since inception", () => {
    // pre-reform rule has effectiveFrom null, effectiveTo 2024-06-05
    const rule = getRule("rent_increase_frequency", "2010-01-01");
    expect(rule.version).toBe("qld-pre-2024-06-06");
  });

  it("throws when no version is in force on the date", () => {
    // governing_framework only commences 2025-09-01
    expect(() => getRule("governing_framework", "2020-01-01")).toThrow(RuleNotFoundError);
  });
});

describe("findRule", () => {
  it("returns null instead of throwing when nothing is in force", () => {
    expect(findRule("governing_framework", "2020-01-01")).toBeNull();
  });
});

describe("getRuleVersions", () => {
  it("lists newest effectiveFrom first", () => {
    const versions = getRuleVersions("rent_increase_frequency");
    expect(versions).toHaveLength(2);
    expect(versions[0]?.version).toBe("qld-2024-06-06");
    expect(versions[1]?.version).toBe("qld-pre-2024-06-06");
  });
});

describe("getConfiguredRule — refuses to guess", () => {
  it("throws RuleNotConfiguredError for a rule still pending confirmation", () => {
    const flagged: RegulatoryRule[] = [
      {
        jurisdiction: "QLD",
        key: "entry_notice_routine",
        version: "test-pending",
        value: null,
        effectiveFrom: null,
        effectiveTo: null,
        sourceUrl: null,
        sourceNote: "synthetic flagged rule for the test",
        needsHumanConfirmation: true,
        notes: null,
      },
    ];
    expect(() => getConfiguredRule("entry_notice_routine", "2025-09-02", flagged)).toThrow(
      RuleNotConfiguredError,
    );
  });

  it("returns configured rules normally (entry rules are now confirmed)", () => {
    expect(getConfiguredRule("rent_increase_min_notice", "2025-09-02").version).toBe("qld-current");
    expect(getConfiguredRule("entry_notice_routine", "2025-09-02").needsHumanConfirmation).toBe(
      false,
    );
  });
});

describe("getActiveRules", () => {
  it("returns one in-force version per key on a current date", () => {
    const active = getActiveRules("2025-09-02");
    const keys = active.map((r) => r.key).sort();
    expect(keys).toContain("rent_increase_frequency");
    expect(keys).toContain("emergency_repairs_s214");
    expect(keys).toContain("forms");
    expect(keys).toContain("governing_framework");
    // exactly one frequency version active
    expect(active.filter((r) => r.key === "rent_increase_frequency")).toHaveLength(1);
  });

  it("excludes a key before its rule commences", () => {
    const active = getActiveRules("2020-01-01");
    expect(active.find((r) => r.key === "governing_framework")).toBeUndefined();
    // the legacy frequency rule (effectiveFrom null) is still present
    expect(active.find((r) => r.key === "rent_increase_frequency")?.version).toBe(
      "qld-pre-2024-06-06",
    );
  });
});
