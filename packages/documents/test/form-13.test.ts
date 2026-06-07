import { describe, expect, it } from "vitest";
import { buildNoticeOfIntentionToLeave, renderDocumentHtml } from "../src";

const base = {
  agencyName: "Sunshine Coast Test Agency",
  tenantNames: ["Alex Tan"],
  propertyAddress: "12 Marine Parade, Maroochydore",
  noticeDate: "2026-06-03",
};

describe("buildNoticeOfIntentionToLeave (Form 13)", () => {
  it("periodic → 14 days, with the tenant as the sender and the agency as recipient", () => {
    const doc = buildNoticeOfIntentionToLeave({ ...base, ground: "periodic" });
    expect(doc.formId).toBe("13");
    expect(doc.type).toBe("notice_of_intention_to_leave");
    expect(doc.title).toBe("Notice of Intention to Leave (Form 13)");
    // The tenant gives this notice TO the lessor/agent (direction is reversed
    // from Form 12).
    expect(doc.from.name).toBe("Alex Tan");
    expect(doc.to.name).toBe("Sunshine Coast Test Agency");
    expect(doc.fields.find((f) => f.label === "Minimum notice")?.value).toBe("14 days");
    expect(doc.fields.find((f) => f.label === "Vacating on or before")?.value).toBe("17 June 2026");
    const html = renderDocumentHtml(doc);
    expect(html).toContain("Notice of Intention to Leave (Form 13)");
    expect(html).not.toMatch(/\{\{|\}\}/);
  });

  it("unremedied lessor breach → 7 days", () => {
    const doc = buildNoticeOfIntentionToLeave({ ...base, ground: "unremedied_breach" });
    expect(doc.fields.find((f) => f.label === "Minimum notice")?.value).toBe("7 days");
    expect(doc.fields.find((f) => f.label === "Vacating on or before")?.value).toBe("10 June 2026");
  });

  it("an additional 14-day ground (death of a tenant) renders with the right period + label", () => {
    const doc = buildNoticeOfIntentionToLeave({ ...base, ground: "death_of_tenant" });
    expect(doc.fields.find((f) => f.label === "Minimum notice")?.value).toBe("14 days");
    expect(doc.fields.find((f) => f.label === "Reason")?.value).toContain("Death of a tenant");
    expect(doc.fields.find((f) => f.label === "Vacating on or before")?.value).toBe("17 June 2026");
  });

  it("DFV → 7 days with the guardrail note (affected tenant only + evidence)", () => {
    const doc = buildNoticeOfIntentionToLeave({ ...base, ground: "dfv" });
    expect(doc.fields.find((f) => f.label === "Minimum notice")?.value).toBe("7 days");
    const html = renderDocumentHtml(doc);
    expect(html).toContain("domestic and family violence");
    expect(html).toContain("ends ONLY the interest of the affected tenant");
    expect(html).not.toMatch(/\{\{|\}\}/);
  });

  it("non-liveability → immediate, vacate date equals the notice date", () => {
    const doc = buildNoticeOfIntentionToLeave({ ...base, ground: "non_liveability" });
    expect(doc.fields.find((f) => f.label === "Minimum notice")?.value).toBe(
      "Immediate (effective the day given)",
    );
    expect(doc.fields.find((f) => f.label === "Vacating on or before")?.value).toBe("3 June 2026");
  });

  it("end of fixed term → vacate is the LATER of notice+14d and the lease end", () => {
    // lease ends 2026-10-31, well after notice + 14 days (2026-06-17) → lease end
    const late = buildNoticeOfIntentionToLeave({
      ...base,
      ground: "end_of_fixed_term",
      leaseEndDate: "2026-10-31",
    });
    expect(late.fields.find((f) => f.label === "Minimum notice")?.value).toBe("14 days");
    expect(late.fields.find((f) => f.label === "Vacating on or before")?.value).toBe(
      "31 October 2026",
    );

    // lease ends 2026-06-10, before notice + 14 days → notice + 14 days governs
    const soon = buildNoticeOfIntentionToLeave({
      ...base,
      ground: "end_of_fixed_term",
      leaseEndDate: "2026-06-10",
    });
    expect(soon.fields.find((f) => f.label === "Vacating on or before")?.value).toBe(
      "17 June 2026",
    );
  });
});
