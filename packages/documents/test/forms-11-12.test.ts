import { RuleNotConfiguredError } from "@pm/rules";
import { describe, expect, it } from "vitest";
import { buildNoticeToLeave, buildRemedyBreachNotice } from "../src";

const base = {
  agencyName: "Sunshine Coast Test Agency",
  tenantNames: ["Alex Tan"],
  propertyAddress: "12 Marine Parade, Maroochydore",
  noticeDate: "2026-06-03",
};

// Forms 11 & 12 pull their statutory periods from @pm/rules, which seeds them
// UNCONFIRMED — so the builders MUST refuse rather than guess. These tests pin
// that anti-invention behaviour; once the periods are confirmed in the seed,
// add positive-path assertions.
describe("Form 11 / 12 builders refuse until the period is confirmed", () => {
  it("buildRemedyBreachNotice throws RuleNotConfiguredError", () => {
    expect(() => buildRemedyBreachNotice({ ...base, amountOwedCents: 58000 })).toThrow(
      RuleNotConfiguredError,
    );
  });

  it("buildNoticeToLeave throws RuleNotConfiguredError for each ground", () => {
    expect(() => buildNoticeToLeave({ ...base, ground: "unremedied_breach" })).toThrow(
      RuleNotConfiguredError,
    );
    expect(() => buildNoticeToLeave({ ...base, ground: "end_of_fixed_term" })).toThrow(
      RuleNotConfiguredError,
    );
  });
});
