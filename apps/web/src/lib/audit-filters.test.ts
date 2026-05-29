import { describe, expect, it } from "vitest";
import { auditFiltersToQuery, hasActiveAuditFilter, parseAuditFilters } from "./audit-filters";

const parse = (qs: string) => parseAuditFilters(new URLSearchParams(qs));

describe("parseAuditFilters", () => {
  it("defaults to an empty filter on page 1", () => {
    expect(parse("")).toEqual({ action: null, actorType: null, from: null, page: 1 });
  });

  it("reads valid params", () => {
    expect(parse("action=draft&actor=user&from=2026-05-01&page=3")).toEqual({
      action: "draft",
      actorType: "user",
      from: "2026-05-01",
      page: 3,
    });
  });

  it("rejects an unknown actor type", () => {
    expect(parse("actor=robot").actorType).toBeNull();
  });

  it("rejects a malformed or impossible from date", () => {
    expect(parse("from=last-week").from).toBeNull();
    expect(parse("from=2026-13-45").from).toBeNull(); // syntactically ISO-ish but not a real date
    expect(parse("from=2026-05-01").from).toBe("2026-05-01");
  });

  it("clamps non-positive or non-integer pages to 1", () => {
    expect(parse("page=0").page).toBe(1);
    expect(parse("page=-2").page).toBe(1);
    expect(parse("page=abc").page).toBe(1);
  });
});

describe("auditFiltersToQuery", () => {
  it("round-trips a populated filter", () => {
    const f = { action: "gmail", actorType: "system" as const, from: "2026-05-01", page: 2 };
    expect(parse(auditFiltersToQuery(f).replace(/^\?/, ""))).toEqual(f);
  });

  it("omits empty parts and page 1", () => {
    expect(auditFiltersToQuery({ action: null, actorType: null, from: null, page: 1 })).toBe("");
  });
});

describe("hasActiveAuditFilter", () => {
  it("is false for the empty filter, true otherwise", () => {
    expect(hasActiveAuditFilter({ action: null, actorType: null, from: null, page: 5 })).toBe(
      false,
    );
    expect(hasActiveAuditFilter({ action: "x", actorType: null, from: null, page: 1 })).toBe(true);
  });
});
