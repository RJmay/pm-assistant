import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import {
  detectMapping,
  detectPreset,
  type Mapping,
  parseAuDate,
  validateRow,
} from "./import-presets";

describe("parseCsv", () => {
  it("parses quoted fields, escaped quotes, embedded commas and CRLF", () => {
    const { headers, rows } = parseCsv(
      'Address,Owner,"Notes"\r\n"12 Banksia St, Maroochydore",Jordan,"said ""hi"""\r\n',
    );
    expect(headers).toEqual(["Address", "Owner", "Notes"]);
    expect(rows).toEqual([["12 Banksia St, Maroochydore", "Jordan", 'said "hi"']]);
  });

  it("skips blank lines and strips a BOM", () => {
    const { headers, rows } = parseCsv("﻿A,B\n\n1,2\n\n");
    expect(headers).toEqual(["A", "B"]);
    expect(rows).toEqual([["1", "2"]]);
  });
});

describe("detectMapping / detectPreset", () => {
  it("maps PropertyMe-style headers", () => {
    const headers = [
      "Property Address",
      "Suburb",
      "Postcode",
      "Owner Name",
      "Owner Email",
      "Owner Mobile",
      "Tenant Name",
      "Tenant Email",
      "Rent",
      "Lease Start",
      "Lease End",
      "Bond",
    ];
    const m = detectMapping(headers);
    expect(m.address_line1).toBe(0);
    expect(m.owner_name).toBe(3);
    expect(m.owner_phone).toBe(5);
    expect(m.rent_weekly).toBe(8);
    expect(m.bond).toBe(11);
    expect(detectPreset(headers)).toBe("propertyme");
  });

  it("maps Console Cloud-style headers", () => {
    const headers = ["Address", "Suburb", "Post Code", "Landlord", "Landlord Email", "Weekly Rent"];
    const m = detectMapping(headers);
    expect(m.address_line1).toBe(0);
    expect(m.postcode).toBe(2);
    expect(m.owner_name).toBe(3);
    expect(m.rent_weekly).toBe(5);
    expect(detectPreset(headers)).toBe("console");
  });

  it("maps VaultRE-style headers", () => {
    const headers = ["Property", "Owner", "Rental Amount", "Lease Expiry", "Bond Amount"];
    const m = detectMapping(headers);
    expect(m.address_line1).toBe(0);
    expect(m.owner_name).toBe(1);
    expect(m.rent_weekly).toBe(2);
    expect(m.lease_end).toBe(3);
    expect(detectPreset(headers)).toBe("vaultre");
  });

  it("returns null preset for unrecognised headers (manual mapping fallback)", () => {
    expect(detectPreset(["Foo", "Bar"])).toBeNull();
  });

  it("specific synonyms beat generic ones regardless of column order", () => {
    // "Email"/"Phone" are generic tenant synonyms; they must NOT steal the
    // columns when explicit tenant columns exist later in the file — and the
    // generic ones must not shadow owner fields either.
    const headers = ["Email", "Phone", "Property", "Owner", "Tenant Email", "Tenant Mobile"];
    const m = detectMapping(headers);
    expect(m.tenant_email).toBe(4); // "Tenant Email" (specific) wins over "Email"
    expect(m.tenant_phone).toBe(5); // "Tenant Mobile" wins over "Phone"
    expect(m.address_line1).toBe(2);
    expect(m.owner_name).toBe(3);
  });
});

describe("parseAuDate", () => {
  it("accepts ISO and DD/MM/YYYY, rejects garbage", () => {
    expect(parseAuDate("2026-03-12")).toBe("2026-03-12");
    expect(parseAuDate("12/03/2026")).toBe("2026-03-12");
    expect(parseAuDate("1-7-2026")).toBe("2026-07-01");
    expect(parseAuDate("")).toBeNull();
    expect(parseAuDate("32/01/2026")).toBeUndefined();
    expect(parseAuDate("soon")).toBeUndefined();
  });
});

describe("validateRow", () => {
  const mapping: Mapping = {
    address_line1: 0,
    owner_name: 1,
    owner_email: 2,
    tenant_email: 3,
    rent_weekly: 4,
    lease_start: 5,
    bond: 6,
  };

  it("coerces a clean row (AU dates, $ amounts)", () => {
    const { row, errors } = validateRow(
      [
        "12 Banksia St",
        "Jordan Reeves",
        "j@example.com",
        "t@example.com",
        "$650",
        "12/03/2026",
        "2,600",
      ],
      mapping,
    );
    expect(errors).toEqual([]);
    expect(row).toMatchObject({
      address_line1: "12 Banksia St",
      owner_email: "j@example.com",
      rent_weekly: 650,
      lease_start: "2026-03-12",
      bond: 2600,
    });
  });

  it("collects per-row errors for missing/invalid values", () => {
    const { row, errors } = validateRow(
      ["", "", "not-an-email", "", "abc", "yesterday", ""],
      mapping,
    );
    expect(row).toBeNull();
    expect(errors).toEqual(
      expect.arrayContaining([
        "Street address is required",
        "Owner name is required",
        "Owner email looks invalid",
        "Rent must be a number",
        "Lease start must be a date (DD/MM/YYYY)",
      ]),
    );
  });

  it("treats unmapped optional columns as nulls", () => {
    const { row, errors } = validateRow(["1 Test St", "Owner"], {
      address_line1: 0,
      owner_name: 1,
    });
    expect(errors).toEqual([]);
    expect(row).toMatchObject({ rent_weekly: null, tenant_email: null, bond: null });
  });
});
