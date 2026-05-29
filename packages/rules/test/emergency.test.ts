import { describe, expect, it } from "vitest";
import { listEmergencyRepairItems, triageEmergencyRepair } from "../src/emergency";

const ASOF = "2025-09-02";

describe("triageEmergencyRepair", () => {
  it("flags a burst pipe as an emergency", () => {
    const r = triageEmergencyRepair("There is a burst pipe under the kitchen sink", ASOF);
    expect(r.isEmergency).toBe(true);
    expect(r.matchedItemKeys).toContain("burst_water_service");
  });

  it("flags a gas leak", () => {
    const r = triageEmergencyRepair("I think there's a gas leak in the laundry", ASOF);
    expect(r.isEmergency).toBe(true);
    expect(r.matchedItemKeys).toContain("gas_leak");
  });

  it("flags no hot water as an essential-service failure", () => {
    const r = triageEmergencyRepair("We've had no hot water for three days", ASOF);
    expect(r.isEmergency).toBe(true);
    expect(r.matchedItemKeys).toContain("essential_service_failure");
  });

  it("is case-insensitive", () => {
    expect(triageEmergencyRepair("BURST PIPE!!", ASOF).isEmergency).toBe(true);
  });

  it("matches multiple distinct items", () => {
    const r = triageEmergencyRepair("There's a gas leak and no power to the unit", ASOF);
    expect(r.matchedItemKeys).toContain("gas_leak");
    expect(r.matchedItemKeys).toContain("essential_supply_failure");
  });

  it("does not flag routine maintenance", () => {
    const r = triageEmergencyRepair("The hallway light bulb needs replacing", ASOF);
    expect(r.isEmergency).toBe(false);
    expect(r.matches).toHaveLength(0);
  });

  it("reports the statute and matched keyword for audit", () => {
    const r = triageEmergencyRepair("serious roof leak after the storm", ASOF);
    expect(r.statute).toMatch(/s214/);
    expect(r.matches[0]?.matchedKeyword).toBeTruthy();
  });

  it("does not false-trigger on near-miss phrasing", () => {
    // "broke the law" must not trip the "broken toilet" keyword; "the lawn" must
    // not trip anything; full keyword phrases are required, not loose tokens.
    for (const text of [
      "The tenant says we broke the law on entry notices",
      "The lawn needs mowing and a hedge trim",
      "Requesting a quote to repaint the fence",
    ]) {
      expect(triageEmergencyRepair(text, ASOF).isEmergency, text).toBe(false);
    }
  });
});

describe("listEmergencyRepairItems", () => {
  it("exposes the full statutory list", () => {
    const items = listEmergencyRepairItems(ASOF);
    expect(items).toHaveLength(9);
    expect(items.map((i) => i.key)).toContain("unsafe_or_insecure");
  });
});
