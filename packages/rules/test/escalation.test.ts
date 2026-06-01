import { describe, expect, it } from "vitest";
import { detectEscalations } from "../src/escalation";

describe("detectEscalations — legal", () => {
  it("flags QCAT as LEGAL", () => {
    const r = detectEscalations("I'm taking this to QCAT if it's not fixed");
    expect(r.escalate).toBe(true);
    expect(r.flags).toContain("LEGAL");
    expect(r.matches[0]?.trigger).toBe("legal_qcat_rta_or_lawyer");
  });

  it("flags a lawyer", () => {
    expect(detectEscalations("My lawyer will be in touch").flags).toContain("LEGAL");
  });
});

describe("detectEscalations — welfare", () => {
  it("flags domestic violence", () => {
    const r = detectEscalations("I am fleeing violence and have a protection order");
    expect(r.flags).toContain("WELFARE");
  });

  it("flags self-harm", () => {
    expect(detectEscalations("I feel like I want to end my life").flags).toContain("WELFARE");
  });

  it("flags self-harm phrased as a gerund (recall-gap regression)", () => {
    // "hurting myself" is NOT a substring of "hurt myself" — must be matched
    // explicitly or the deterministic floor silently misses the case.
    expect(detectEscalations("I've been thinking about hurting myself").flags).toContain("WELFARE");
    expect(detectEscalations("some nights I just want to take my own life").flags).toContain(
      "WELFARE",
    );
  });
});

describe("detectEscalations — reputational", () => {
  it("flags media involvement", () => {
    expect(detectEscalations("I'm going to contact the media about this").flags).toContain(
      "REPUTATIONAL",
    );
  });

  it("flags discrimination", () => {
    expect(detectEscalations("this feels like discrimination").flags).toContain("REPUTATIONAL");
  });
});

describe("detectEscalations — combination & dedupe", () => {
  it("dedupes a flag raised by two different triggers in the same category", () => {
    // "the media" -> media_or_police, "your staff member" -> staff_misconduct;
    // both map to REPUTATIONAL, so two matches collapse to one flag.
    const r = detectEscalations("I'll call the media and report your staff member");
    expect(r.flags).toEqual(["REPUTATIONAL"]);
    expect(r.matches.length).toBeGreaterThanOrEqual(2);
  });

  it("raises multiple distinct flags", () => {
    const r = detectEscalations("domestic violence situation and I'll take you to QCAT");
    expect(r.flags).toContain("WELFARE");
    expect(r.flags).toContain("LEGAL");
  });
});

describe("detectEscalations — benign", () => {
  it("does not escalate ordinary maintenance", () => {
    const r = detectEscalations("The kitchen tap is dripping, can someone take a look?");
    expect(r.escalate).toBe(false);
    expect(r.flags).toHaveLength(0);
  });

  it("does not false-trigger on near-miss phrasing", () => {
    // Recall-oriented but not naive: these must NOT escalate.
    for (const text of [
      "I broke the law of physics joke aside, the oven knob fell off",
      "The lawnmower is broken, can a tradie look at it",
      "Could you confirm the rent amount for next month's payment?",
    ]) {
      expect(detectEscalations(text).escalate, text).toBe(false);
    }
  });
});
