import { describe, expect, it } from "vitest";
import {
  aestToday,
  buildRentRoll,
  inspectionState,
  matchesSearch,
  nextInspectionDue,
  type PropertyListItem,
  pickCurrentTenancy,
  type RentRollTenancyRow,
} from "./rent-roll";

function tenancy(overrides: Partial<RentRollTenancyRow> = {}): RentRollTenancyRow {
  return {
    id: "t1",
    property_id: "p1",
    status: "active",
    start_date: "2025-06-01",
    end_date: null,
    rent_amount_cents: 60000,
    rent_frequency: "weekly",
    arrears_since: null,
    last_routine_inspection_date: null,
    ...overrides,
  };
}

describe("pickCurrentTenancy", () => {
  it("returns null for no tenancies", () => {
    expect(pickCurrentTenancy([])).toBeNull();
  });

  it("prefers active over ending over draft over ended", () => {
    const rows = [
      tenancy({ id: "ended", status: "ended" }),
      tenancy({ id: "draft", status: "draft" }),
      tenancy({ id: "active", status: "active" }),
      tenancy({ id: "ending", status: "ending" }),
    ];
    expect(pickCurrentTenancy(rows)?.id).toBe("active");
    expect(pickCurrentTenancy(rows.filter((r) => r.id !== "active"))?.id).toBe("ending");
  });

  it("breaks ties by newest start_date", () => {
    const rows = [
      tenancy({ id: "old", status: "ended", start_date: "2023-01-01" }),
      tenancy({ id: "new", status: "ended", start_date: "2025-01-01" }),
    ];
    expect(pickCurrentTenancy(rows)?.id).toBe("new");
  });

  it("does not mutate the input", () => {
    const rows = [tenancy({ id: "a", status: "ended" }), tenancy({ id: "b" })];
    pickCurrentTenancy(rows);
    expect(rows[0].id).toBe("a");
  });
});

describe("aestToday", () => {
  it("returns Queensland's calendar date, not UTC's", () => {
    // 23:00 UTC on the 9th = 09:00 AEST on the 10th.
    expect(aestToday(new Date("2026-06-09T23:00:00Z"))).toBe("2026-06-10");
    expect(aestToday(new Date("2026-06-09T13:59:00Z"))).toBe("2026-06-09");
  });
});

describe("nextInspectionDue", () => {
  it("anchors on the last inspection when present", () => {
    expect(
      nextInspectionDue({ last_routine_inspection_date: "2026-01-15", start_date: "2025-06-01" }),
    ).toBe("2026-07-15");
  });

  it("clamps to month-end like the worker scanner (31 Aug + 6mo = 28 Feb)", () => {
    expect(
      nextInspectionDue({ last_routine_inspection_date: "2025-08-31", start_date: null }),
    ).toBe("2026-02-28");
    expect(
      nextInspectionDue({ last_routine_inspection_date: "2025-10-31", start_date: null }),
    ).toBe("2026-04-30");
    // Leap year: 31 Aug 2027 + 6mo clamps to 29 Feb 2028.
    expect(
      nextInspectionDue({ last_routine_inspection_date: "2027-08-31", start_date: null }),
    ).toBe("2028-02-29");
  });

  it("falls back to the tenancy start when never inspected", () => {
    expect(
      nextInspectionDue({ last_routine_inspection_date: null, start_date: "2025-06-01" }),
    ).toBe("2025-12-01");
  });

  it("is null when there is no anchor date", () => {
    expect(nextInspectionDue({ last_routine_inspection_date: null, start_date: null })).toBeNull();
  });

  it("rolls across year boundaries", () => {
    expect(
      nextInspectionDue({ last_routine_inspection_date: "2025-09-10", start_date: null }),
    ).toBe("2026-03-10");
  });
});

describe("inspectionState", () => {
  const today = "2026-06-09";
  it("classifies overdue / due_soon / ok", () => {
    expect(inspectionState("2026-06-08", today)).toBe("overdue");
    expect(inspectionState("2026-06-20", today)).toBe("due_soon");
    expect(inspectionState("2026-07-09", today)).toBe("due_soon");
    expect(inspectionState("2026-07-10", today)).toBe("ok");
    expect(inspectionState(null, today)).toBeNull();
  });
});

describe("buildRentRoll", () => {
  const properties = [
    {
      id: "p2",
      address_line1: "9 Beach Rd",
      suburb: "Mooloolaba",
      postcode: "4557",
      owner_id: "o1",
    },
    {
      id: "p1",
      address_line1: "35 Pakenham Street",
      suburb: "Maroochydore",
      postcode: "4558",
      owner_id: "o1",
    },
    { id: "p3", address_line1: "1 Vacant Way", suburb: null, postcode: null, owner_id: null },
  ];
  const owners = [{ id: "o1", full_name: "Jordan Reeves" }];
  const tenancies = [
    tenancy({ id: "t1", property_id: "p1", arrears_since: "2026-06-01" }),
    tenancy({ id: "t-old", property_id: "p1", status: "ended", start_date: "2022-01-01" }),
    tenancy({ id: "t2", property_id: "p2", status: "ended" }),
  ];
  const tenants = [
    { tenancy_id: "t1", full_name: "Casey Co-tenant", email: null, is_primary: false },
    { tenancy_id: "t1", full_name: "Ryan May", email: "ryan@example.com", is_primary: true },
    { tenancy_id: "t-old", full_name: "Old Tenant", email: null, is_primary: true },
  ];

  it("assembles rows sorted by address with the current tenancy's data", () => {
    const roll = buildRentRoll(properties, owners, tenancies, tenants);
    expect(roll.map((r) => r.addressLine1)).toEqual([
      "1 Vacant Way",
      "35 Pakenham Street",
      "9 Beach Rd",
    ]);
    const pakenham = roll.find((r) => r.id === "p1");
    expect(pakenham).toMatchObject({
      ownerName: "Jordan Reeves",
      tenancyId: "t1",
      tenancyStatus: "active",
      rentCents: 60000,
      arrearsSince: "2026-06-01",
    });
    // Primary tenant listed first; the old tenancy's tenant is not shown.
    expect(pakenham?.tenantNames).toEqual(["Ryan May", "Casey Co-tenant"]);
    expect(pakenham?.inspectionDue).toBe("2025-12-01");
  });

  it("handles vacant properties and ended tenancies", () => {
    const roll = buildRentRoll(properties, owners, tenancies, tenants);
    const vacant = roll.find((r) => r.id === "p3");
    expect(vacant).toMatchObject({ ownerName: null, tenancyId: null, tenantNames: [] });
    // Inspection-due indicator only applies to active tenancies.
    const ended = roll.find((r) => r.id === "p2");
    expect(ended?.tenancyStatus).toBe("ended");
    expect(ended?.inspectionDue).toBeNull();
  });
});

describe("matchesSearch", () => {
  const item: PropertyListItem = {
    id: "p1",
    addressLine1: "35 Pakenham Street",
    suburb: "Maroochydore",
    postcode: "4558",
    ownerName: "Jordan Reeves",
    tenancyId: "t1",
    tenancyStatus: "active",
    rentCents: 60000,
    rentFrequency: "weekly",
    endDate: null,
    arrearsSince: null,
    inspectionDue: null,
    tenantNames: ["Ryan May"],
  };

  it("matches address, suburb, owner, tenant — case-insensitively", () => {
    expect(matchesSearch(item, "pakenham")).toBe(true);
    expect(matchesSearch(item, "MAROOCH")).toBe(true);
    expect(matchesSearch(item, "reeves")).toBe(true);
    expect(matchesSearch(item, "ryan may")).toBe(true);
    expect(matchesSearch(item, "4558")).toBe(true);
    expect(matchesSearch(item, "noosa")).toBe(false);
  });

  it("empty query matches everything", () => {
    expect(matchesSearch(item, "  ")).toBe(true);
  });
});
