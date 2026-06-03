import { describe, expect, it } from "vitest";
import { buildRentIncreaseNoticeDocument, DocumentNotCompliantError } from "../src";

const base = {
  agencyName: "Sunshine Coast Test Agency",
  tenantNames: ["Alex Tan", "Sam Lee"],
  propertyAddress: "12 Marine Parade, Maroochydore",
  noticeDate: "2026-06-03",
  currentRentCents: 58000,
  newRentCents: 62000,
  rentFrequency: "weekly" as const,
  lastIncreaseDate: "2025-01-01",
};

describe("buildRentIncreaseNoticeDocument", () => {
  it("builds a compliant rent-increase notice with rules-engine dates + basis", () => {
    const doc = buildRentIncreaseNoticeDocument(base);
    expect(doc.type).toBe("rent_increase_notice");
    expect(doc.formId).toBeNull(); // no numbered RTA form for rent increases
    expect(doc.fields.find((f) => f.label === "Current rent")?.value).toBe("$580.00 per week");
    expect(doc.fields.find((f) => f.label === "New rent")?.value).toBe("$620.00 per week");
    expect(doc.fields.find((f) => f.label === "Minimum notice required")?.value).toBe("2 months");
    // earliest effective = max(notice + 2mo = 2026-08-03, last + 12mo = 2026-01-01) = 2026-08-03
    expect(doc.fields.find((f) => f.label === "Takes effect from")?.value).toBe("3 August 2026");
    // property basis (last increase + the 12-month rule both post-2024-06-06)
    expect(doc.sections.some((s) => s.paragraphs.some((p) => p.includes("for the property")))).toBe(
      true,
    );
    expect(doc.ruleVersions.length).toBeGreaterThan(0);
  });

  it("names both tenants", () => {
    const doc = buildRentIncreaseNoticeDocument(base);
    expect(doc.to.name).toBe("Alex Tan and Sam Lee");
  });

  it("refuses when the new rent is not higher than the current rent", () => {
    expect(() => buildRentIncreaseNoticeDocument({ ...base, newRentCents: 58000 })).toThrow(
      DocumentNotCompliantError,
    );
  });

  it("refuses a too-soon effective date (within the 2-month notice)", () => {
    expect(() => buildRentIncreaseNoticeDocument({ ...base, effectiveDate: "2026-06-20" })).toThrow(
      DocumentNotCompliantError,
    );
  });
});
