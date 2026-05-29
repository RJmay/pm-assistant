import { describe, expect, it } from "vitest";
import {
  emergencyRepairsValueSchema,
  entryFrequencyValueSchema,
  entryNoticeValueSchema,
  formsValueSchema,
} from "../src/schema";
import { QLD_RULES, SPEC_ASSERTED_DATES } from "../src/seed";

describe("seed integrity", () => {
  it("parses and is non-empty", () => {
    expect(QLD_RULES.length).toBeGreaterThan(0);
  });

  it("every rule cites a source", () => {
    for (const rule of QLD_RULES) {
      expect(rule.sourceNote.length, `rule ${rule.key}/${rule.version}`).toBeGreaterThan(0);
      expect(rule.jurisdiction).toBe("QLD");
    }
  });
});

describe("anti-invention guard — no un-asserted regulatory dates", () => {
  it("only contains effective/value dates the spec actually states", () => {
    const allowed = new Set<string>(SPEC_ASSERTED_DATES);
    const serialized = JSON.stringify(QLD_RULES);
    const found = serialized.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    const offenders = [...new Set(found)].filter((d) => !allowed.has(d));
    expect(offenders, `unexpected hard dates in the seed: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("RTA values: confirmed vs still-flagged", () => {
  it("entry rules are confirmed from the RTA (7 days, once / 3 months)", () => {
    const notice = QLD_RULES.find((r) => r.key === "entry_notice_routine");
    expect(notice?.needsHumanConfirmation).toBe(false);
    expect(entryNoticeValueSchema.parse(notice?.value).routineInspectionNoticeDays).toBe(7);

    const freq = QLD_RULES.find((r) => r.key === "entry_frequency_cap");
    expect(freq?.needsHumanConfirmation).toBe(false);
    expect(entryFrequencyValueSchema.parse(freq?.value).minMonthsBetween).toBe(3);
  });

  it("Form 18b is confirmed; R18 stays flagged (not located, out of scope)", () => {
    const formsRule = QLD_RULES.find((r) => r.key === "forms");
    const { forms } = formsValueSchema.parse(formsRule?.value);

    const f18b = forms.find((x) => x.formId === "18b");
    expect(f18b?.purpose).toBe("Moveable dwelling tenancy agreement");
    expect(f18b?.needsHumanConfirmation).toBe(false);

    const r18 = forms.find((x) => x.formId === "R18");
    expect(r18?.purpose).toBeNull();
    expect(r18?.needsHumanConfirmation).toBe(true);
  });
});

describe("statutory completeness", () => {
  it("seeds all nine s214 emergency-repair items", () => {
    const rule = QLD_RULES.find((r) => r.key === "emergency_repairs_s214");
    const { items } = emergencyRepairsValueSchema.parse(rule?.value);
    expect(items).toHaveLength(9);
    // each item carries at least one triage keyword
    for (const item of items) {
      expect(item.keywords.length, item.key).toBeGreaterThan(0);
    }
  });

  it("has both rent-increase frequency versions across the 6 Jun 2024 boundary", () => {
    const versions = QLD_RULES.filter((r) => r.key === "rent_increase_frequency");
    expect(versions).toHaveLength(2);
    const post = versions.find((v) => v.effectiveFrom === "2024-06-06");
    expect(post?.effectiveTo).toBeNull();
    const pre = versions.find((v) => v.effectiveTo === "2024-06-05");
    expect(pre?.effectiveFrom).toBeNull();
  });
});
