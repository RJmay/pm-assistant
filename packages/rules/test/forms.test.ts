import { describe, expect, it } from "vitest";
import {
  FormNotConfiguredError,
  getFormById,
  listForms,
  NoFormForActionError,
  selectForm,
} from "../src/forms";

const ASOF = "2025-09-02";

describe("selectForm", () => {
  it("maps each action to its RTA form", () => {
    expect(selectForm("general_tenancy_agreement", ASOF).formId).toBe("18a");
    expect(selectForm("entry_notice", ASOF).formId).toBe("9");
    expect(selectForm("notice_to_remedy_breach", ASOF).formId).toBe("11");
    expect(selectForm("notice_to_leave", ASOF).formId).toBe("12");
    expect(selectForm("notice_of_intention_to_leave", ASOF).formId).toBe("13");
    expect(selectForm("disputed_bond", ASOF).formId).toBe("R12");
  });
});

describe("getFormById", () => {
  it("returns a still-flagged form (R18) without a confirmed purpose", () => {
    const r18 = getFormById("R18", ASOF);
    expect(r18.purpose).toBeNull();
    expect(r18.needsHumanConfirmation).toBe(true);
    expect(r18.updatedUnder2025Regulation).toBe(true);
  });

  it("returns Form 18b (moveable dwelling) now that it's confirmed", () => {
    const f18b = getFormById("18b", ASOF);
    expect(f18b.purpose).toBe("Moveable dwelling tenancy agreement");
    expect(f18b.needsHumanConfirmation).toBe(false);
  });

  it("throws for an unknown form id", () => {
    expect(() => getFormById("999", ASOF)).toThrow(NoFormForActionError);
  });
});

describe("listForms", () => {
  it("includes the 2025-Regulation-updated forms 18a/18b/R18", () => {
    const ids = listForms(ASOF)
      .filter((f) => f.updatedUnder2025Regulation)
      .map((f) => f.formId)
      .sort();
    expect(ids).toEqual(["18a", "18b", "R18"]);
  });
});

describe("FormNotConfiguredError", () => {
  it("is exported for callers that resolve flagged forms by action (none currently map)", () => {
    // 18b / R18 carry action: null, so they are unreachable via selectForm and
    // would surface as NoFormForActionError. This documents the guard exists.
    expect(FormNotConfiguredError).toBeTypeOf("function");
  });
});
