import { describe, expect, it } from "vitest";
import { buildNoticeToLeave, renderDocumentPdf } from "../src";

const base = {
  agencyName: "Sunshine Coast Test Agency",
  tenantNames: ["Alex Tan"],
  propertyAddress: "12 Marine Parade, Maroochydore",
  noticeDate: "2026-06-03",
};

describe("renderDocumentPdf", () => {
  it("produces a valid, non-trivial PDF for a Form 12", async () => {
    const doc = buildNoticeToLeave({
      ...base,
      ground: "end_of_fixed_term",
      leaseEndDate: "2026-10-31",
    });
    const bytes = await renderDocumentPdf(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(800);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("handles long / multi-tenant content across wraps + page breaks", async () => {
    const doc = buildNoticeToLeave({
      ...base,
      agencyName: "A".repeat(90),
      tenantNames: ["Alex Tan", "Sam Lee", "Jordan Fox"],
      propertyAddress: "12 Marine Parade, Maroochydore, Queensland 4558 ".repeat(4),
      ground: "unremedied_general_breach",
    });
    const bytes = await renderDocumentPdf(doc);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });
});
