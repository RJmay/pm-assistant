import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import type { PropertyListItem } from "$lib/rent-roll";
import PropertyRow from "./PropertyRow.svelte";

const TODAY = "2026-06-09";

function item(overrides: Partial<PropertyListItem> = {}): PropertyListItem {
  return {
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
    ...overrides,
  };
}

describe("PropertyRow", () => {
  it("renders address, tenant, owner and rent, linking to the property", () => {
    render(PropertyRow, { props: { item: item(), today: TODAY } });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/properties/p1");
    expect(screen.getByText("35 Pakenham Street, Maroochydore")).toBeInTheDocument();
    expect(screen.getByText(/Ryan May/)).toBeInTheDocument();
    expect(screen.getByText(/Owner: Jordan Reeves/)).toBeInTheDocument();
    expect(screen.getByText("$600/wk")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows Vacant when there is no tenancy", () => {
    render(PropertyRow, {
      props: {
        item: item({ tenancyStatus: null, tenancyId: null, tenantNames: [] }),
        today: TODAY,
      },
    });
    expect(screen.getByText("Vacant")).toBeInTheDocument();
    expect(screen.getByText(/No tenants/)).toBeInTheDocument();
  });

  it("flags arrears and overdue inspections", () => {
    render(PropertyRow, {
      props: {
        item: item({ arrearsSince: "2026-06-01", inspectionDue: "2026-06-01" }),
        today: TODAY,
      },
    });
    expect(screen.getByText(/Arrears since 1 Jun 2026/)).toBeInTheDocument();
    expect(screen.getByText("Inspection overdue")).toBeInTheDocument();
  });

  it("shows an upcoming inspection as due, not overdue", () => {
    render(PropertyRow, {
      props: { item: item({ inspectionDue: "2026-06-20" }), today: TODAY },
    });
    expect(screen.getByText(/Inspection due 20 Jun 2026/)).toBeInTheDocument();
  });
});
