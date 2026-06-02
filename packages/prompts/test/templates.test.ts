import { describe, expect, it } from "vitest";
import {
  buildArrearsDraft,
  buildInspectionDraft,
  buildLeaseRenewalDraft,
  buildOwnerUpdateDraft,
  humanDate,
  type LeaseRenewalInput,
  MissingTemplateVariableError,
  renderTemplate,
  type Template,
  UnresolvedTemplateSlotError,
} from "../src";

const SIMPLE: Template = {
  key: "test_v1",
  category: "ADMIN",
  subject: "Hello {{name}}",
  body: "Hi {{name}}, your ref is {{ref}}.{{tail}}",
  requiredVariables: ["name", "ref"],
};

describe("renderTemplate", () => {
  it("substitutes every slot", () => {
    const out = renderTemplate(SIMPLE, { name: "Alex", ref: "A-1", tail: " Thanks." });
    expect(out.subject).toBe("Hello Alex");
    expect(out.body).toBe("Hi Alex, your ref is A-1. Thanks.");
  });

  it("allows an optional slot to render empty when supplied as empty string", () => {
    const out = renderTemplate(SIMPLE, { name: "Alex", ref: "A-1", tail: "" });
    expect(out.body).toBe("Hi Alex, your ref is A-1.");
  });

  it("throws when a required variable is blank", () => {
    expect(() => renderTemplate(SIMPLE, { name: "   ", ref: "A-1", tail: "" })).toThrow(
      MissingTemplateVariableError,
    );
  });

  it("throws when a required variable is missing", () => {
    expect(() => renderTemplate(SIMPLE, { name: "Alex", tail: "" })).toThrow(
      MissingTemplateVariableError,
    );
  });

  it("refuses to leave a referenced slot unresolved (never sends raw {{slot}})", () => {
    // `tail` is referenced in the body but not supplied → must throw, not leak.
    expect(() => renderTemplate(SIMPLE, { name: "Alex", ref: "A-1" })).toThrow(
      UnresolvedTemplateSlotError,
    );
  });

  it("coerces numeric values to strings", () => {
    const t: Template = {
      key: "n",
      category: "ADMIN",
      subject: "n={{n}}",
      body: "{{n}}",
      requiredVariables: ["n"],
    };
    expect(renderTemplate(t, { n: 42 }).subject).toBe("n=42");
  });
});

describe("humanDate", () => {
  it("formats an ISO date the Australian way", () => {
    expect(humanDate("2025-11-01")).toBe("1 November 2025");
    expect(humanDate("2026-06-30")).toBe("30 June 2026");
  });

  it("returns the input unchanged when it isn't a valid ISO date", () => {
    expect(humanDate("not-a-date")).toBe("not-a-date");
    expect(humanDate("2025-13-01")).toBe("2025-13-01");
  });
});

describe("buildLeaseRenewalDraft", () => {
  function base(): LeaseRenewalInput {
    return {
      tenantName: "Alex Tan",
      propertyAddress: "12 Marine Parade, Maroochydore",
      leaseEndDate: "2025-11-01",
      agencyName: "Sunshine Coast Test Agency",
      pmName: "Jess Bowman",
    };
  }

  it("renders a complete tenant-facing offer with no leftover slots", () => {
    const d = buildLeaseRenewalDraft(base());
    expect(d.subject).toBe("Your tenancy at 12 Marine Parade, Maroochydore — renewal");
    expect(d.body).toContain("Hi Alex Tan,");
    expect(d.body).toContain("due to end on 1 November 2025");
    expect(d.body).toContain("Jess Bowman");
    expect(d.body).toContain("Sunshine Coast Test Agency");
    expect(d.body).toContain("Kind regards,"); // default sign-off
    expect(d.body).not.toMatch(/\{\{|\}\}/);
  });

  it("uses a custom sign-off when provided", () => {
    const d = buildLeaseRenewalDraft({ ...base(), pmSignoff: "Warm regards," });
    expect(d.body).toContain("Warm regards,");
    expect(d.body).not.toContain("Kind regards,");
  });

  it("never states a rent figure in the body; surfaces the rent-review window in notes only", () => {
    const d = buildLeaseRenewalDraft({
      ...base(),
      rentReview: {
        lastIncreaseDate: "2024-06-01",
        earliestCompliantDate: "2025-08-02",
        minNoticeMonths: 2,
        minIntervalMonths: 12,
        ruleVersions: ["rent_increase_frequency@2024-06-06", "rent_increase_min_notice@2008-07-01"],
      },
    });
    // The body never proposes money.
    expect(d.body).not.toMatch(/\$\d/);
    expect(d.body.toLowerCase()).not.toContain("rent will");
    // The compliant window lands in the review notes for the PM.
    const notes = d.reviewNotes.join("\n");
    expect(notes).toContain("earliest a new rent could lawfully take effect is 2 August 2025");
    expect(notes).toContain("at most one increase every 12 months");
    expect(notes).toContain("Do not state a new rent in this email");
  });

  it("omits the rent-review note when no review window is supplied", () => {
    const d = buildLeaseRenewalDraft(base());
    expect(d.reviewNotes.join("\n")).not.toContain("Rent review window");
    expect(d.reviewNotes.length).toBeGreaterThan(0);
  });
});

describe("buildInspectionDraft", () => {
  it("proposes the compliant date, references Form 9 + the notice period, no leftover slots", () => {
    const d = buildInspectionDraft({
      tenantName: "Alex Tan",
      propertyAddress: "12 Marine Parade, Maroochydore",
      proposedDate: "2026-06-09",
      noticeDays: 7,
      formId: "9",
      agencyName: "Sunshine Coast Test Agency",
      pmName: "Jess Bowman",
      ruleVersions: ["qld-2025-05-01", "form-9"],
    });
    expect(d.subject).toBe("Routine inspection at 12 Marine Parade, Maroochydore");
    expect(d.body).toContain("Hi Alex Tan,");
    expect(d.body).toContain("9 June 2026");
    expect(d.body).toContain("Form 9");
    expect(d.body).toContain("7 days' notice");
    expect(d.body).not.toMatch(/\{\{|\}\}/);
    const notes = d.reviewNotes.join("\n");
    expect(notes).toContain("Do not enter without the served notice");
  });

  it("adds a frequency-cap note when the date is bound by the cap", () => {
    const d = buildInspectionDraft({
      tenantName: "Alex",
      propertyAddress: "1 St",
      proposedDate: "2026-07-01",
      noticeDays: 7,
      formId: "9",
      agencyName: "A",
      pmName: "PM",
      cappedByFrequency: true,
      minMonthsBetween: 3,
    });
    expect(d.reviewNotes.join("\n")).toContain("capped at one every 3 months");
  });
});

describe("buildOwnerUpdateDraft", () => {
  it("summarises the month with correct pluralisation and no leftover slots", () => {
    const d = buildOwnerUpdateDraft({
      ownerName: "Casey Brennan",
      agencyName: "Sunshine Coast Test Agency",
      reportMonthLabel: "May 2026",
      propertyCount: 3,
      itemsHandled: 12,
      pmName: "Jess Bowman",
    });
    expect(d.subject).toBe("Your May 2026 update from Sunshine Coast Test Agency");
    expect(d.body).toContain("Hi Casey,");
    expect(d.body).toContain("3 properties");
    expect(d.body).toContain("12 matters");
    expect(d.body).not.toMatch(/\{\{|\}\}/);
  });

  it("uses singular phrasing for one property / one matter", () => {
    const d = buildOwnerUpdateDraft({
      ownerName: "Pat",
      agencyName: "A",
      reportMonthLabel: "May 2026",
      propertyCount: 1,
      itemsHandled: 1,
      pmName: "PM",
    });
    expect(d.body).toContain("1 property");
    expect(d.body).toContain("1 matter");
    expect(d.body).not.toContain("1 properties");
    expect(d.body).not.toContain("1 matters");
  });

  it("phrases a quiet month gracefully", () => {
    const d = buildOwnerUpdateDraft({
      ownerName: "Pat",
      agencyName: "A",
      reportMonthLabel: "May 2026",
      propertyCount: 2,
      itemsHandled: 0,
      pmName: "PM",
    });
    expect(d.body).toContain("no new matters");
  });
});

describe("buildArrearsDraft", () => {
  function base() {
    return {
      tenantName: "Alex Tan",
      propertyAddress: "12 Marine Parade, Maroochydore",
      daysOverdue: 3,
      arrearsSince: "2026-05-30",
      agencyName: "Sunshine Coast Test Agency",
      pmName: "Jess Bowman",
    };
  }

  it("is a courtesy reminder — no legal threat, no statutory threshold asserted", () => {
    const d = buildArrearsDraft(base());
    expect(d.subject).toBe("Rent reminder — 12 Marine Parade, Maroochydore");
    expect(d.body).toContain("Hi Alex Tan,");
    expect(d.body).toContain("3 days overdue");
    expect(d.body).not.toMatch(/\{\{|\}\}/);
    // No threats, no asserted legal day-thresholds in the tenant-facing body.
    expect(d.body.toLowerCase()).not.toContain("form 11");
    expect(d.body.toLowerCase()).not.toContain("breach");
    expect(d.reviewNotes.join("\n")).toContain("courtesy reminder, not a statutory notice");
  });

  it("uses singular phrasing for one day overdue", () => {
    const d = buildArrearsDraft({ ...base(), daysOverdue: 1 });
    expect(d.body).toContain("1 day overdue");
    expect(d.body).not.toContain("1 days overdue");
  });

  it("adds an escalation note for the PM only when flagged (still no legal assertion)", () => {
    const d = buildArrearsDraft({ ...base(), daysOverdue: 9, escalate: true });
    const notes = d.reviewNotes.join("\n");
    expect(notes).toContain("Notice to Remedy Breach (Form 11)");
    expect(notes).toContain("your call, not the system's");
    // Escalation guidance lives in PM notes, never the tenant-facing body.
    expect(d.body.toLowerCase()).not.toContain("form 11");
  });

  it("omits the escalation note when not flagged", () => {
    const d = buildArrearsDraft({ ...base(), daysOverdue: 2, escalate: false });
    expect(d.reviewNotes.join("\n")).not.toContain("Form 11");
  });
});
