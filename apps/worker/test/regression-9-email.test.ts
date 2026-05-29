import type { DraftSubmission } from "@pm/shared";
import { describe, expect, it } from "vitest";
import { applyComplianceFloor } from "../src/services/compliance-floor";

// ============================================================================
// The 9-email regression pack (spec §14) — deterministic layer
// ============================================================================
// Ports the prototype's 9 canonical test emails (one per category + the edge
// cases) and asserts the DETERMINISTIC compliance floor's outcome on each,
// given a "naive" LLM baseline (escalation NONE / priority STANDARD /
// do_not_send false). This verifiably nails §14's emphasis: the two failure
// modes — emergency (prioritised) and domestic-violence (escalated + never
// auto-sent) — are handled correctly, AND the routine emails are NOT over-
// triggered. (Category/tone assertions against the live LLM are covered by the
// RUN_LLM_TESTS-gated drafter tests; this layer needs no API key.)
// ============================================================================

const ASOF = "2025-09-02";

function naive(overrides: Partial<DraftSubmission> = {}): DraftSubmission {
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

interface Case {
  name: string;
  body: string;
  escalation_flag: DraftSubmission["escalation_flag"];
  do_not_send: boolean;
  priority: DraftSubmission["priority"];
}

const CASES: Case[] = [
  {
    name: "emergency burst pipe → prioritised, not escalated",
    body: "There's a burst pipe under the kitchen sink and water is going everywhere — please send someone urgently.",
    escalation_flag: "NONE",
    do_not_send: false,
    priority: "PRIORITY",
  },
  {
    name: "routine fix → untouched",
    body: "The hallway light bulb has blown and the bathroom tap drips a little. No rush at all.",
    escalation_flag: "NONE",
    do_not_send: false,
    priority: "STANDARD",
  },
  {
    name: "rent pushback → untouched",
    body: "I got the notice about the rent increase to $620 a week. That feels high for the area — can we have a chat about it?",
    escalation_flag: "NONE",
    do_not_send: false,
    priority: "STANDARD",
  },
  {
    name: "lease break → untouched",
    body: "I've been offered a job interstate and need to end my lease a few months early. What are my options?",
    escalation_flag: "NONE",
    do_not_send: false,
    priority: "STANDARD",
  },
  {
    name: "repeat noise complaint → untouched",
    body: "This is the third time I've reported the upstairs tenants playing loud music past midnight. It's really affecting my sleep.",
    escalation_flag: "NONE",
    do_not_send: false,
    priority: "STANDARD",
  },
  {
    name: "QCAT threat → escalated LEGAL",
    body: "If this isn't sorted out I'll be lodging a dispute with QCAT and seeking compensation.",
    escalation_flag: "LEGAL",
    do_not_send: false,
    priority: "STANDARD",
  },
  {
    name: "inspection reschedule → untouched",
    body: "Could we move the routine inspection booked for Tuesday to the following week? I'll be away.",
    escalation_flag: "NONE",
    do_not_send: false,
    priority: "STANDARD",
  },
  {
    name: "owner email → untouched",
    body: "Hi, this is the owner of 12 Smith St. Can you send the latest statement and let me know when the next inspection is?",
    escalation_flag: "NONE",
    do_not_send: false,
    priority: "STANDARD",
  },
  {
    name: "domestic-violence safety case → escalated WELFARE + never auto-sent",
    body: "I need to talk to someone urgently. I'm experiencing domestic violence and I'm scared for my safety here at the property.",
    escalation_flag: "WELFARE",
    do_not_send: true,
    priority: "STANDARD",
  },
];

describe("9-email regression pack (§14) — deterministic compliance floor", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const { submission } = applyComplianceFloor(naive(), c.body, ASOF);
      expect(submission.escalation_flag, "escalation_flag").toBe(c.escalation_flag);
      expect(submission.do_not_send, "do_not_send").toBe(c.do_not_send);
      expect(submission.priority, "priority").toBe(c.priority);
    });
  }

  it("the two failure modes are both covered by the pack", () => {
    expect(CASES.some((c) => c.escalation_flag === "WELFARE" && c.do_not_send)).toBe(true);
    expect(CASES.some((c) => c.priority === "PRIORITY")).toBe(true);
  });
});
