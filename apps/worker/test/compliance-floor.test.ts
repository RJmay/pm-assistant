import type { DraftSubmission } from "@pm/shared";
import { describe, expect, it } from "vitest";
import { applyComplianceFloor } from "../src/services/compliance-floor";

const ASOF = "2025-09-02";

function sub(overrides: Partial<DraftSubmission> = {}): DraftSubmission {
  return {
    category: "MAINTENANCE",
    category_confidence: "HIGH",
    priority: "STANDARD",
    escalation_flag: "NONE",
    emergency_landlord_alert: false,
    safety_critical: false,
    do_not_send: false,
    draft_confidence: "HIGH",
    draft_subject: "Re: your email",
    draft_body: "Thanks for getting in touch.",
    pm_review_notes: [],
    ...overrides,
  };
}

describe("applyComplianceFloor — escalation safety-net", () => {
  it("raises a missed welfare escalation and forces do_not_send", () => {
    const r = applyComplianceFloor(
      sub(),
      "I am experiencing domestic violence and need help urgently",
      ASOF,
    );
    expect(r.submission.escalation_flag).toBe("WELFARE");
    expect(r.submission.do_not_send).toBe(true);
    expect(r.adjustments.some((a) => a.includes("escalation_flag raised"))).toBe(true);
    expect(r.adjustments.some((a) => a.includes("do_not_send forced"))).toBe(true);
    expect(r.submission.pm_review_notes).toHaveLength(1);
  });

  it("annotates but does not raise when the LLM already escalated", () => {
    const r = applyComplianceFloor(
      sub({ escalation_flag: "LEGAL" }),
      "I will take this to QCAT",
      ASOF,
    );
    expect(r.submission.escalation_flag).toBe("LEGAL"); // not raised (was not NONE)
    expect(r.adjustments).toEqual([]); // no raise, no welfare-force
    expect(r.submission.pm_review_notes).toHaveLength(1); // still annotated
  });

  it("never downgrades a stronger LLM flag", () => {
    const r = applyComplianceFloor(
      sub({ escalation_flag: "WELFARE", do_not_send: true }),
      "my solicitor will be in touch",
      ASOF,
    );
    expect(r.submission.escalation_flag).toBe("WELFARE");
  });

  it("raises a weaker LLM flag up to a detected welfare signal", () => {
    const r = applyComplianceFloor(
      sub({ escalation_flag: "REPUTATIONAL" }),
      "there has been domestic violence at the property",
      ASOF,
    );
    expect(r.submission.escalation_flag).toBe("WELFARE");
    expect(r.submission.do_not_send).toBe(true);
    expect(r.adjustments.some((a) => a.includes("REPUTATIONAL→WELFARE"))).toBe(true);
  });

  it("does not re-force do_not_send when it is already set", () => {
    const r = applyComplianceFloor(sub({ do_not_send: true }), "I am thinking about suicide", ASOF);
    expect(r.submission.do_not_send).toBe(true);
    expect(r.adjustments.some((a) => a.includes("do_not_send forced"))).toBe(false);
    expect(r.adjustments.some((a) => a.includes("escalation_flag raised"))).toBe(true);
  });
});

describe("applyComplianceFloor — s214 emergency triage", () => {
  it("adds a note and bumps STANDARD→PRIORITY on a burst pipe", () => {
    const r = applyComplianceFloor(sub(), "There is a burst pipe flooding the kitchen", ASOF);
    expect(r.submission.priority).toBe("PRIORITY");
    expect(r.adjustments.some((a) => a.includes("PRIORITY"))).toBe(true);
    expect(r.submission.pm_review_notes.some((n) => n.includes("s214"))).toBe(true);
  });

  it("never auto-sets emergency_landlord_alert (PM decides)", () => {
    const r = applyComplianceFloor(sub(), "there is a gas leak in the unit", ASOF);
    expect(r.submission.emergency_landlord_alert).toBe(false);
  });

  it("does not downgrade a higher priority", () => {
    const r = applyComplianceFloor(sub({ priority: "EMERGENCY_ALERT" }), "burst pipe", ASOF);
    expect(r.submission.priority).toBe("EMERGENCY_ALERT");
  });
});

describe("applyComplianceFloor — benign", () => {
  it("returns the submission unchanged with no adjustments", () => {
    const original = sub();
    const r = applyComplianceFloor(
      original,
      "Could you confirm the rent due date for next month?",
      ASOF,
    );
    expect(r.adjustments).toEqual([]);
    expect(r.submission).toBe(original); // same reference — nothing changed
    expect(r.submission.pm_review_notes).toEqual([]);
  });
});
