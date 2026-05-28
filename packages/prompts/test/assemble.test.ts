import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type AssembleInput, assemble, type LeanNote, MissingNominatedRepairerError } from "../src";

const __dirname = dirname(fileURLToPath(import.meta.url));
const basePrompt = readFileSync(resolve(__dirname, "../src/base/pm-drafting-v2.3.md"), "utf-8");

// Pinned date so snapshots stay deterministic across runs.
const NOW = new Date("2026-05-28T00:00:00Z");
const SCTA_ID = "11111111-1111-1111-1111-111111111111";

function sunshineCoastInput(): AssembleInput {
  return {
    basePrompt,
    now: NOW,
    agency: {
      id: SCTA_ID,
      name: "Sunshine Coast Test Agency",
      suburb: "Mooloolaba",
      businessHours: "Mon-Fri 9am-5pm AEST",
      afterHoursLine: "+61 7 5555 1111",
      principal: "Casey Brennan, principal@scta-test.example",
    },
    agencyConfig: {
      voiceSamples: [
        {
          label: "Sample 1 — warm acknowledgement",
          body: "Hi Alex,\n\nThanks for letting me know about the dripping tap. I've logged it and our plumber will be in touch directly to arrange a time.\n\nKind regards,\nJess",
        },
        {
          label: "Sample 2 — hedged response",
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
      nominatedRepairer: {
        name: "Coast Plumbing Co",
        number: "+61 400 555 001",
      },
      routineApprovalThresholdCents: 25000,
      writtenQuoteThresholdCents: 50000,
      perOwnerQuoteExceptions: [
        { note: "Pat Nguyen requires written quotes for any work over $200" },
      ],
      houseRules:
        "- Pet requests are processed within 7 business days\n- We do not accept rent payment by credit card",
      leanNotes: [],
    },
    pms: [
      {
        name: "Jess Bowman",
        email: "jess@scta-test.example",
        phone: "+61 7 5555 1111",
      },
      {
        name: "Sam Tran",
        email: "sam@scta-test.example",
        phone: "+61 7 5555 1112",
      },
    ],
  };
}

function makeLean(overrides: Partial<LeanNote> = {}): LeanNote {
  return {
    id: "lean-1",
    topic: "Maintenance assertiveness",
    lean: "Lean slightly more firm in maintenance acknowledgements — tenants felt drafts were too soft last week.",
    setAt: "2026-05-25T03:00:00Z",
    setBy: "22222222-2222-2222-2222-222222222222",
    // 60 days after setAt — well clear of NOW (2026-05-28)
    expiresAt: "2026-07-24T03:00:00Z",
    ...overrides,
  };
}

describe("assemble", () => {
  it("full Sunshine Coast Test config produces the canonical prompt", () => {
    const out = assemble(sunshineCoastInput());
    expect(out).toMatchSnapshot();
  });

  it("minimal config (only agency name) renders with explicit not-on-file notes", () => {
    const input = sunshineCoastInput();
    input.agency.suburb = null;
    input.agency.businessHours = null;
    input.agency.afterHoursLine = null;
    input.agency.principal = null;
    input.agencyConfig.voiceSamples = [];
    input.agencyConfig.approvedTradies = [];
    input.agencyConfig.perOwnerQuoteExceptions = [];
    input.agencyConfig.houseRules = null;
    input.pms = [];
    const out = assemble(input);
    expect(out).toMatchSnapshot();
    expect(out).toContain("_Not on file._");
    expect(out).toContain("_No voice samples on file._");
    expect(out).toContain("_No approved tradies on file._");
    expect(out).toContain("_None._");
    expect(out).toContain("_None on file._");
    expect(out).toContain("_No property managers on file._");
  });

  it("empty voice samples renders the explicit placeholder note", () => {
    const input = sunshineCoastInput();
    input.agencyConfig.voiceSamples = [];
    const out = assemble(input);
    expect(out).toContain("_No voice samples on file._");
  });

  it("throws MissingNominatedRepairerError when nominatedRepairer is null", () => {
    const input = sunshineCoastInput();
    input.agencyConfig.nominatedRepairer = null;
    expect(() => assemble(input)).toThrow(MissingNominatedRepairerError);
    try {
      assemble(input);
    } catch (e) {
      expect(e).toBeInstanceOf(MissingNominatedRepairerError);
      if (e instanceof MissingNominatedRepairerError) {
        expect(e.agencyId).toBe(SCTA_ID);
      }
    }
  });

  it("substitutes [PM_NAME] when runtimeContext.pmName is provided; otherwise leaves it literal", () => {
    const withPm = assemble({
      ...sunshineCoastInput(),
      runtimeContext: { pmName: "Jess Bowman" },
    });
    expect(withPm).not.toContain("[PM_NAME]");
    expect(withPm).toContain("Jess Bowman");

    const withoutPm = assemble(sunshineCoastInput());
    expect(withoutPm).toContain("[PM_NAME]");
  });

  describe("lean notes", () => {
    it("strips the entire 'Current tuning leans' section when no active leans", () => {
      const out = assemble(sunshineCoastInput());
      expect(out).not.toContain("Current tuning leans");
      expect(out).not.toContain("[LEAN_NOTES]");
      // The neighbouring sections still render in the right order.
      expect(out.indexOf("House rules and quirks")).toBeLessThan(
        out.indexOf("PM signoff defaults"),
      );
    });

    it("renders active leans as a markdown sublist under the section heading", () => {
      const input = sunshineCoastInput();
      input.agencyConfig.leanNotes = [
        makeLean({ id: "lean-a", topic: "Maintenance assertiveness", lean: "Firmer tone." }),
        makeLean({ id: "lean-b", topic: "Quote turnaround", lean: "Promise sooner." }),
      ];
      const out = assemble(input);
      expect(out).toContain("### Current tuning leans");
      expect(out).toContain("- **Maintenance assertiveness:** Firmer tone.");
      expect(out).toContain("- **Quote turnaround:** Promise sooner.");
      expect(out).not.toContain("[LEAN_NOTES]");
    });

    it("filters expired leans before rendering — section strips if none active", () => {
      const input = sunshineCoastInput();
      input.agencyConfig.leanNotes = [
        // Both expired before NOW (2026-05-28)
        makeLean({ id: "old-1", expiresAt: "2026-05-01T00:00:00Z" }),
        makeLean({ id: "old-2", expiresAt: "2026-05-27T23:59:00Z" }),
      ];
      const out = assemble(input);
      expect(out).not.toContain("Current tuning leans");
      expect(out).not.toContain("[LEAN_NOTES]");
    });

    it("renders only the active subset when a mix of expired and active leans is provided", () => {
      const input = sunshineCoastInput();
      input.agencyConfig.leanNotes = [
        makeLean({
          id: "expired",
          topic: "Stale",
          lean: "Do not apply.",
          expiresAt: "2026-05-01T00:00:00Z",
        }),
        makeLean({
          id: "fresh",
          topic: "Active",
          lean: "Apply this.",
          expiresAt: "2026-07-01T00:00:00Z",
        }),
      ];
      const out = assemble(input);
      expect(out).toContain("- **Active:** Apply this.");
      expect(out).not.toContain("- **Stale:** Do not apply.");
    });
  });
});
