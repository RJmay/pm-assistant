import { describe, expect, it } from "vitest";
import {
  applyFilters,
  filtersToQuery,
  hasActiveFilter,
  isAlert,
  parseFilters,
  sortQueue,
} from "./queue-filters";
import type { QueueItem } from "./types";

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "d1",
    draft_source: "inbound_reply",
    category: "MAINTENANCE",
    priority: "STANDARD",
    escalation_flag: "NONE",
    emergency_landlord_alert: false,
    safety_critical: false,
    do_not_send: false,
    draft_confidence: "HIGH",
    match_confidence: "high",
    status: "pending",
    assigned_pm_id: null,
    bounced_at: null,
    draft_subject: null,
    created_at: "2026-05-29T00:00:00Z",
    from_name: "Alex",
    from_address: "alex@example.com",
    subject: "Subject",
    received_at: "2026-05-29T00:00:00Z",
    ...overrides,
  };
}

describe("parseFilters", () => {
  it("parses cat/esc/pm and ignores junk values", () => {
    const f = parseFilters(
      new URLSearchParams("cat=MAINTENANCE,BOGUS,RENT&esc=LEGAL,NOPE&pm=pm-1"),
    );
    expect(f.categories).toEqual(["MAINTENANCE", "RENT"]);
    expect(f.escalations).toEqual(["LEGAL"]);
    expect(f.pmId).toBe("pm-1");
  });

  it("returns an empty filter for no params", () => {
    const f = parseFilters(new URLSearchParams(""));
    expect(f).toEqual({ categories: [], escalations: [], pmId: null });
    expect(hasActiveFilter(f)).toBe(false);
  });
});

describe("filtersToQuery", () => {
  it("round-trips through parseFilters", () => {
    const original = {
      categories: ["RENT" as const],
      escalations: ["LEGAL" as const],
      pmId: "pm-9",
    };
    const qs = filtersToQuery(original);
    const reparsed = parseFilters(new URLSearchParams(qs));
    expect(reparsed).toEqual(original);
  });

  it("is empty when no filters set", () => {
    expect(filtersToQuery({ categories: [], escalations: [], pmId: null })).toBe("");
  });
});

describe("applyFilters", () => {
  const items = [
    item({ id: "a", category: "MAINTENANCE", escalation_flag: "NONE", assigned_pm_id: "pm-1" }),
    item({ id: "b", category: "RENT", escalation_flag: "LEGAL", assigned_pm_id: "pm-2" }),
    item({ id: "c", category: "LEASE", escalation_flag: "NONE", assigned_pm_id: "pm-1" }),
  ];

  it("filters by category (OR within dimension)", () => {
    const out = applyFilters(items, { categories: ["RENT", "LEASE"], escalations: [], pmId: null });
    expect(out.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("filters by escalation", () => {
    const out = applyFilters(items, { categories: [], escalations: ["LEGAL"], pmId: null });
    expect(out.map((i) => i.id)).toEqual(["b"]);
  });

  it("ANDs across dimensions (category AND pm)", () => {
    const out = applyFilters(items, { categories: ["MAINTENANCE"], escalations: [], pmId: "pm-1" });
    expect(out.map((i) => i.id)).toEqual(["a"]);
  });

  it("returns everything when no filter is active", () => {
    expect(applyFilters(items, { categories: [], escalations: [], pmId: null })).toHaveLength(3);
  });
});

describe("sortQueue", () => {
  it("orders by priority (Emergency first) then received_at ascending", () => {
    const items = [
      item({ id: "std-old", priority: "STANDARD", received_at: "2026-05-01T00:00:00Z" }),
      item({ id: "emg", priority: "EMERGENCY_ALERT", received_at: "2026-05-29T00:00:00Z" }),
      item({ id: "pri", priority: "PRIORITY", received_at: "2026-05-10T00:00:00Z" }),
      item({ id: "std-new", priority: "STANDARD", received_at: "2026-05-20T00:00:00Z" }),
    ];
    expect(sortQueue(items).map((i) => i.id)).toEqual(["emg", "pri", "std-old", "std-new"]);
  });

  it("does not mutate the input array", () => {
    const items = [item({ id: "a" }), item({ id: "b" })];
    const copy = [...items];
    sortQueue(items);
    expect(items).toEqual(copy);
  });
});

describe("isAlert", () => {
  it("is false for a routine pending draft", () => {
    expect(isAlert(item())).toBe(false);
  });
  it("is true for escalation / emergency / safety / do-not-send", () => {
    expect(isAlert(item({ escalation_flag: "WELFARE" }))).toBe(true);
    expect(isAlert(item({ emergency_landlord_alert: true }))).toBe(true);
    expect(isAlert(item({ safety_critical: true }))).toBe(true);
    expect(isAlert(item({ do_not_send: true }))).toBe(true);
  });
});
