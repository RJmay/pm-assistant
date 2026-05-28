import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type AssembleInput, assemble, draft } from "../src";
import { INBOUND_FIXTURES } from "./fixtures/inbound";

const RUN = process.env.RUN_LLM_TESTS === "1";

const __dirname = dirname(fileURLToPath(import.meta.url));
const basePrompt = readFileSync(resolve(__dirname, "../src/base/pm-drafting-v2.1.md"), "utf-8");

const NOW = new Date("2026-05-28T00:00:00Z");
const AGENCY_NAME = "Sunshine Coast Test Agency";

// Body-content constraints from the prompt's hedge-language section. These
// are exact phrases (case-sensitive) that the prompt explicitly forbids.
const FORBIDDEN_PHRASES = [
  "The owner will",
  "Don't worry about the cost",
  "That's covered under your bond",
  "You're entitled to a rent reduction",
];

// Specific-time promises ("tomorrow at 9am", "at 14:30") that the prompt
// disallows in tradie commitments.
const SPECIFIC_TIME_PATTERNS = [/tomorrow at \d/i, /\bat \d{1,2}(am|pm|:\d{2})/i];

function sunshineCoastSystemPrompt(): string {
  const input: AssembleInput = {
    basePrompt,
    now: NOW,
    agency: {
      id: "11111111-1111-1111-1111-111111111111",
      name: AGENCY_NAME,
      suburb: "Mooloolaba",
      businessHours: "Mon-Fri 9am-5pm AEST",
      afterHoursLine: "+61 7 5555 1111",
      principal: "Casey Brennan, principal@scta-test.example",
    },
    agencyConfig: {
      voiceSamples: [
        {
          label: "Sample 1 - warm acknowledgement",
          body: "Hi Alex,\n\nThanks for letting me know about the dripping tap. I've logged it and our plumber will be in touch directly to arrange a time.\n\nKind regards,\nJess",
        },
        {
          label: "Sample 2 - hedged response",
          body: "Hi Jordan,\n\nThanks for raising this. I'll need to discuss the request with the owner before I can give you a firm answer — I'll come back to you within 48 hours.\n\nKind regards,\nJess",
        },
      ],
      approvedTradies: [
        {
          trade: "Plumbing",
          name: "Coast Plumbing Co",
          businessHoursContact: "+61 7 5555 0001",
          afterHoursContact: "+61 400 555 001",
        },
        {
          trade: "Electrical",
          name: "Sparkwise Electrical",
          businessHoursContact: "+61 7 5555 0002",
          afterHoursContact: "+61 400 555 002",
        },
      ],
      nominatedRepairer: { name: "Coast Plumbing Co", number: "+61 400 555 001" },
      routineApprovalThresholdCents: 25000,
      writtenQuoteThresholdCents: 50000,
      perOwnerQuoteExceptions: [],
      houseRules:
        "- Pet requests are processed within 7 business days\n- We do not accept rent payment by credit card",
    },
    pms: [
      { name: "Jess Bowman", email: "jess@scta-test.example" },
      { name: "Sam Tran", email: "sam@scta-test.example" },
    ],
  };
  return assemble(input);
}

const describeIf = RUN ? describe : describe.skip;

describeIf("draft (live, RUN_LLM_TESTS=1)", () => {
  if (!RUN) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("RUN_LLM_TESTS=1 but ANTHROPIC_API_KEY is not set");
  }

  const systemPrompt = sunshineCoastSystemPrompt();

  for (const fixture of INBOUND_FIXTURES) {
    it(`${fixture.id} — ${fixture.label}`, { timeout: 60_000 }, async () => {
      const out = await draft({ systemPrompt, inboundEmail: fixture.email }, { apiKey });

      // ---- Structured-field assertions (deterministic via tool use) ----
      expect(out.category, "category").toBe(fixture.expected.category);
      expect(out.priority, "priority").toBe(fixture.expected.priority);
      expect(out.escalation_flag, "escalation_flag").toBe(fixture.expected.escalation_flag);
      expect(out.do_not_send, "do_not_send").toBe(fixture.expected.do_not_send);
      expect(out.emergency_landlord_alert, "emergency_landlord_alert").toBe(
        fixture.expected.emergency_landlord_alert,
      );

      // ---- Body-content constraints (apply only to sendable drafts) ----
      if (!fixture.expected.do_not_send) {
        expect(out.draft_body, "must contain agency signoff").toContain(AGENCY_NAME);
        for (const phrase of FORBIDDEN_PHRASES) {
          expect(out.draft_body, `must not contain forbidden phrase "${phrase}"`).not.toContain(
            phrase,
          );
        }
        for (const pattern of SPECIFIC_TIME_PATTERNS) {
          expect(
            out.draft_body,
            `must not promise a specific time (matched ${pattern})`,
          ).not.toMatch(pattern);
        }
      }
    });
  }
});
