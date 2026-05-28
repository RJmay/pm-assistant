import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type AssembleInput, assemble, MissingNominatedRepairerError } from "../src";

const __dirname = dirname(fileURLToPath(import.meta.url));
const basePrompt = readFileSync(resolve(__dirname, "../src/base/pm-drafting-v2.1.md"), "utf-8");

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
});
