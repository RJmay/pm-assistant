import { describe, expect, it } from "vitest";
import { buildEntryNoticeDocument, DocumentNotCompliantError, renderDocumentHtml } from "../src";

// Entry rules took their current form on 2025-05-01; evaluate after that.
const base = {
  agencyName: "Sunshine Coast Test Agency",
  tenantNames: ["Alex Tan"],
  propertyAddress: "12 Marine Parade, Maroochydore",
  noticeDate: "2026-06-03",
};

describe("buildEntryNoticeDocument", () => {
  it("builds a Form 9 entry notice with the rules-engine notice period + earliest date", () => {
    const doc = buildEntryNoticeDocument({ ...base, lastInspectionDate: null });
    expect(doc.type).toBe("entry_notice");
    expect(doc.formId).toBe("9");
    expect(doc.title).toBe("Entry Notice (Form 9)");
    // earliest = noticeDate + 7 days = 2026-06-10
    const entry = doc.fields.find((f) => f.label === "Date of entry");
    expect(entry?.value).toBe("10 June 2026");
    expect(doc.fields.find((f) => f.label === "Minimum notice required")?.value).toBe("7 days");
    expect(doc.ruleVersions.length).toBeGreaterThan(0);
  });

  it("accepts a PM-proposed entry date that meets the notice period", () => {
    const doc = buildEntryNoticeDocument({
      ...base,
      lastInspectionDate: null,
      entryDate: "2026-06-20",
    });
    expect(doc.fields.find((f) => f.label === "Date of entry")?.value).toBe("20 June 2026");
  });

  it("refuses an entry date inside the notice period", () => {
    expect(() =>
      buildEntryNoticeDocument({ ...base, lastInspectionDate: null, entryDate: "2026-06-05" }),
    ).toThrow(DocumentNotCompliantError);
  });

  it("respects the inspection frequency cap from the rules engine", () => {
    // last inspection 2026-04-01 → +3 months = 2026-07-01, later than notice+7.
    const doc = buildEntryNoticeDocument({ ...base, lastInspectionDate: "2026-04-01" });
    expect(doc.fields.find((f) => f.label === "Date of entry")?.value).toBe("1 July 2026");
  });

  it("renders escaped, print-ready HTML containing the key fields", () => {
    const doc = buildEntryNoticeDocument({
      ...base,
      tenantNames: ["Alex <b>Tan</b>"],
      lastInspectionDate: null,
    });
    const html = renderDocumentHtml(doc);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Entry Notice (Form 9)");
    expect(html).toContain("10 June 2026");
    expect(html).toContain("RTA Form 9");
    // value is HTML-escaped, not injected as markup
    expect(html).toContain("Alex &lt;b&gt;Tan&lt;/b&gt;");
    expect(html).not.toContain("Alex <b>Tan</b>");
    expect(html).toContain("not legal advice");
  });
});
