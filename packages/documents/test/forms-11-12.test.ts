import { describe, expect, it } from "vitest";
import {
  buildGeneralBreachNotice,
  buildNoticeToLeave,
  buildRemedyBreachNotice,
  renderDocumentHtml,
} from "../src";

const base = {
  agencyName: "Sunshine Coast Test Agency",
  tenantNames: ["Alex Tan"],
  propertyAddress: "12 Marine Parade, Maroochydore",
  noticeDate: "2026-06-03",
};

// Periods are RTA-confirmed in the seed, so the builders now produce documents.
describe("buildRemedyBreachNotice (Form 11)", () => {
  it("builds a rent-arrears remedy notice with the 7-day remedy date", () => {
    const doc = buildRemedyBreachNotice({ ...base, amountOwedCents: 116000 });
    expect(doc.formId).toBe("11");
    expect(doc.title).toBe("Notice to Remedy Breach (Form 11)");
    expect(doc.fields.find((f) => f.label === "Amount owing")?.value).toBe("$1,160.00");
    expect(doc.fields.find((f) => f.label === "Remedy required by")?.value).toBe("10 June 2026");
    expect(doc.fields.find((f) => f.label === "Remedy period")?.value).toBe("7 days");
    const html = renderDocumentHtml(doc);
    expect(html).toContain("Notice to Remedy Breach (Form 11)");
    expect(html).not.toMatch(/\{\{|\}\}/);
  });

  it("moveable-dwelling rent arrears → 5-day remedy date", () => {
    const doc = buildRemedyBreachNotice({ ...base, amountOwedCents: 50000, dwelling: "moveable" });
    expect(doc.fields.find((f) => f.label === "Remedy period")?.value).toBe("5 days");
    expect(doc.fields.find((f) => f.label === "Remedy required by")?.value).toBe("8 June 2026");
  });
});

describe("buildGeneralBreachNotice (Form 11, non-rent)", () => {
  it("builds a general-breach notice with the 7-day remedy date + the described breach", () => {
    const doc = buildGeneralBreachNotice({
      ...base,
      breachDescription: "Unapproved pet kept at the premises",
    });
    expect(doc.formId).toBe("11");
    expect(doc.title).toBe("Notice to Remedy Breach (Form 11)");
    expect(doc.fields.find((f) => f.label === "Nature of breach")?.value).toBe(
      "Unapproved pet kept at the premises",
    );
    expect(doc.fields.find((f) => f.label === "Remedy period")?.value).toBe("7 days");
    expect(doc.fields.find((f) => f.label === "Remedy required by")?.value).toBe("10 June 2026");
    const html = renderDocumentHtml(doc);
    expect(html).toContain("Unapproved pet kept at the premises");
    expect(html).not.toMatch(/\{\{|\}\}/);
  });
});

describe("buildNoticeToLeave (Form 12)", () => {
  it("unremedied rent breach → 7 days to hand over", () => {
    const doc = buildNoticeToLeave({ ...base, ground: "unremedied_breach" });
    expect(doc.formId).toBe("12");
    expect(doc.fields.find((f) => f.label === "Minimum notice")?.value).toBe("7 days");
    expect(doc.fields.find((f) => f.label === "Hand over the premises by")?.value).toBe(
      "10 June 2026",
    );
  });

  it("unremedied GENERAL breach → 14 days to hand over", () => {
    const doc = buildNoticeToLeave({ ...base, ground: "unremedied_general_breach" });
    expect(doc.formId).toBe("12");
    expect(doc.fields.find((f) => f.label === "Minimum notice")?.value).toBe("14 days");
    expect(doc.fields.find((f) => f.label === "Hand over the premises by")?.value).toBe(
      "17 June 2026",
    );
    expect(doc.fields.find((f) => f.label === "Ground")?.value).toContain(
      "Breach of the agreement",
    );
  });

  it("end of fixed term → 2 months, handover is the LATER of notice+2mo and lease end", () => {
    // lease ends 2026-10-31, well after notice + 2 months (2026-08-03) → use the lease end
    const late = buildNoticeToLeave({
      ...base,
      ground: "end_of_fixed_term",
      leaseEndDate: "2026-10-31",
    });
    expect(late.fields.find((f) => f.label === "Minimum notice")?.value).toBe("2 months");
    expect(late.fields.find((f) => f.label === "Hand over the premises by")?.value).toBe(
      "31 October 2026",
    );

    // notice given late (lease already near its end) → notice + 2 months governs
    const soon = buildNoticeToLeave({
      ...base,
      ground: "end_of_fixed_term",
      leaseEndDate: "2026-06-15",
    });
    expect(soon.fields.find((f) => f.label === "Hand over the premises by")?.value).toBe(
      "3 August 2026",
    );
  });
});
