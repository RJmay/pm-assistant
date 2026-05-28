import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it } from "vitest";
import { type MatcherInput, matchEmail } from "../src/services/matcher";

// ----------------------------------------------------------------------------
// In-memory fake of the slice of Supabase the matcher actually touches.
// Each test sets the rows it wants present; the fake replays them through
// the same fluent API the matcher uses (`.eq().ilike().select().maybeSingle()`).
// ----------------------------------------------------------------------------

interface TenantRow {
  id: string;
  agency_id: string;
  tenancy_id: string | null;
  email: string | null;
}
interface OwnerRow {
  id: string;
  agency_id: string;
  email: string | null;
  archived_at: string | null;
}
interface PropertyRow {
  id: string;
  agency_id: string;
  owner_id: string | null;
  address_line1: string;
  suburb: string | null;
  archived_at: string | null;
}
interface TenancyRow {
  id: string;
  agency_id: string;
  property_id: string | null;
}
interface ThreadRow {
  agency_id: string;
  gmail_thread_id: string;
  property_id: string | null;
  property_match_confidence: "high" | "medium" | "low" | "none";
}

interface Fixtures {
  tenants: TenantRow[];
  owners: OwnerRow[];
  properties: PropertyRow[];
  tenancies: TenancyRow[];
  email_threads: ThreadRow[];
}

let fixtures: Fixtures;
function reset() {
  fixtures = { tenants: [], owners: [], properties: [], tenancies: [], email_threads: [] };
}

interface QueryState {
  table: keyof Fixtures;
  filters: Array<{ op: "eq" | "ilike" | "is"; col: string; val: unknown }>;
}

function chain(state: QueryState) {
  const addFilter = (op: "eq" | "ilike" | "is", col: string, val: unknown) => {
    state.filters.push({ op, col, val });
    return api;
  };
  const collect = (): unknown[] => {
    const rows: Record<string, unknown>[] = fixtures[state.table].slice() as unknown as Record<
      string,
      unknown
    >[];
    return rows.filter((row) =>
      state.filters.every(({ op, col, val }) => {
        const cell = row[col];
        if (op === "eq") return cell === val;
        if (op === "ilike") {
          if (typeof cell !== "string" || typeof val !== "string") return false;
          return cell.toLowerCase() === val.toLowerCase();
        }
        if (op === "is") return cell === val;
        return false;
      }),
    );
  };
  const api = {
    eq: (col: string, val: unknown) => addFilter("eq", col, val),
    ilike: (col: string, val: unknown) => addFilter("ilike", col, val),
    is: (col: string, val: unknown) => addFilter("is", col, val),
    maybeSingle: async () => {
      const rows = collect();
      if (rows.length === 0) return { data: null, error: null };
      return { data: rows[0], error: null };
    },
    // The matcher awaits the builder directly for multi-row queries (no
    // terminal method). Implement `then` so `await builder` resolves —
    // matches the supabase-js fluent-builder pattern.
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for fake supabase builder
    then: <T>(
      resolve: (v: { data: unknown[]; error: null }) => T,
      _reject: (e: unknown) => unknown,
    ) => Promise.resolve({ data: collect(), error: null }).then(resolve),
  };
  return api;
}

function fakeClient(): Client {
  return {
    from(table: keyof Fixtures) {
      return {
        select: (_cols: string) => chain({ table, filters: [] }),
      };
    },
    // biome-ignore lint/suspicious/noExplicitAny: only the fields the matcher uses are implemented
  } as any;
}

const AGENCY = "agency-aaa";

function baseInput(overrides: Partial<MatcherInput> = {}): MatcherInput {
  return {
    agencyId: AGENCY,
    fromAddress: "alex.tan@example.com",
    subject: "Routine",
    bodyPreview: "Hi, hope you're well.",
    gmailThreadId: "gmail-thread-xyz",
    ...overrides,
  };
}

beforeEach(reset);

describe("matchEmail", () => {
  describe("Step 1: exact_email", () => {
    it("matches a unique tenant by email and chains to property via tenancy", async () => {
      fixtures.tenants = [
        { id: "t-1", agency_id: AGENCY, tenancy_id: "ten-1", email: "Alex.Tan@example.com" },
      ];
      fixtures.tenancies = [{ id: "ten-1", agency_id: AGENCY, property_id: "p-1" }];

      const out = await matchEmail(
        fakeClient(),
        baseInput({ fromAddress: "alex.tan@example.com" }),
      );
      expect(out).toEqual({
        propertyId: "p-1",
        tenantId: "t-1",
        ownerId: null,
        confidence: "high",
        source: "exact_email",
      });
    });

    it("captures tenantId at medium confidence when tenancy has no property", async () => {
      fixtures.tenants = [
        { id: "t-1", agency_id: AGENCY, tenancy_id: "ten-1", email: "alex.tan@example.com" },
      ];
      fixtures.tenancies = [{ id: "ten-1", agency_id: AGENCY, property_id: null }];

      const out = await matchEmail(fakeClient(), baseInput());
      expect(out).toMatchObject({
        propertyId: null,
        tenantId: "t-1",
        confidence: "medium",
        source: "exact_email",
      });
    });

    it("falls through past tenants when the sender matches two tenants (ambiguous)", async () => {
      fixtures.tenants = [
        { id: "t-1", agency_id: AGENCY, tenancy_id: "ten-1", email: "shared@example.com" },
        { id: "t-2", agency_id: AGENCY, tenancy_id: "ten-2", email: "shared@example.com" },
      ];
      fixtures.tenancies = [
        { id: "ten-1", agency_id: AGENCY, property_id: "p-1" },
        { id: "ten-2", agency_id: AGENCY, property_id: "p-2" },
      ];

      const out = await matchEmail(fakeClient(), baseInput({ fromAddress: "shared@example.com" }));
      // No property/owner anywhere else → fallback
      expect(out.source).toBe("fallback");
      expect(out.confidence).toBe("none");
    });

    it("matches a unique owner with exactly one property → high confidence", async () => {
      fixtures.owners = [
        {
          id: "o-1",
          agency_id: AGENCY,
          email: "casey@example.com",
          archived_at: null,
        },
      ];
      fixtures.properties = [
        {
          id: "p-1",
          agency_id: AGENCY,
          owner_id: "o-1",
          address_line1: "12 Beach Parade",
          suburb: "Mooloolaba",
          archived_at: null,
        },
      ];

      const out = await matchEmail(fakeClient(), baseInput({ fromAddress: "casey@example.com" }));
      expect(out).toMatchObject({
        propertyId: "p-1",
        ownerId: "o-1",
        confidence: "high",
        source: "exact_email",
      });
    });

    it("matches owner but leaves propertyId null when owner has multiple properties", async () => {
      fixtures.owners = [
        { id: "o-1", agency_id: AGENCY, email: "casey@example.com", archived_at: null },
      ];
      fixtures.properties = [
        {
          id: "p-1",
          agency_id: AGENCY,
          owner_id: "o-1",
          address_line1: "12 Beach Parade",
          suburb: "Mooloolaba",
          archived_at: null,
        },
        {
          id: "p-2",
          agency_id: AGENCY,
          owner_id: "o-1",
          address_line1: "9 Esplanade",
          suburb: "Caloundra",
          archived_at: null,
        },
      ];

      const out = await matchEmail(fakeClient(), baseInput({ fromAddress: "casey@example.com" }));
      expect(out).toMatchObject({
        propertyId: null,
        ownerId: "o-1",
        confidence: "medium",
        source: "exact_email",
      });
    });

    it("scopes tenant lookups by agency_id (cross-agency tenants don't match)", async () => {
      fixtures.tenants = [
        { id: "t-other", agency_id: "agency-other", tenancy_id: null, email: "alex@example.com" },
      ];
      const out = await matchEmail(fakeClient(), baseInput({ fromAddress: "alex@example.com" }));
      expect(out.source).toBe("fallback");
    });
  });

  describe("Step 2: thread_continuity", () => {
    it("inherits property_id when an existing thread already has one", async () => {
      fixtures.email_threads = [
        {
          agency_id: AGENCY,
          gmail_thread_id: "gmail-thread-xyz",
          property_id: "p-known",
          property_match_confidence: "high",
        },
      ];
      const out = await matchEmail(fakeClient(), baseInput());
      expect(out).toEqual({
        propertyId: "p-known",
        tenantId: null,
        ownerId: null,
        confidence: "high",
        source: "thread_continuity",
      });
    });

    it("respects the thread's stored confidence rather than laundering up to high", async () => {
      fixtures.email_threads = [
        {
          agency_id: AGENCY,
          gmail_thread_id: "gmail-thread-xyz",
          property_id: "p-known",
          property_match_confidence: "low",
        },
      ];
      const out = await matchEmail(fakeClient(), baseInput());
      expect(out.confidence).toBe("low");
      expect(out.source).toBe("thread_continuity");
    });

    it("does NOT match thread continuity when the thread has no property_id", async () => {
      fixtures.email_threads = [
        {
          agency_id: AGENCY,
          gmail_thread_id: "gmail-thread-xyz",
          property_id: null,
          property_match_confidence: "none",
        },
      ];
      const out = await matchEmail(fakeClient(), baseInput());
      // Falls through with no property signal anywhere else
      expect(out.source).toBe("fallback");
    });
  });

  describe("Step 3: subject_fuzzy", () => {
    it("matches when the subject overlaps strongly with one property's address", async () => {
      fixtures.properties = [
        {
          id: "p-target",
          agency_id: AGENCY,
          owner_id: null,
          address_line1: "21 Bulcock Beach Esplanade",
          suburb: "Caloundra",
          archived_at: null,
        },
        {
          id: "p-other",
          agency_id: AGENCY,
          owner_id: null,
          address_line1: "9 Lindsay Road",
          suburb: "Buderim",
          archived_at: null,
        },
      ];
      const out = await matchEmail(
        fakeClient(),
        baseInput({ subject: "Bulcock Beach Esplanade — hot water cutting out (Caloundra)" }),
      );
      expect(out).toMatchObject({
        propertyId: "p-target",
        confidence: "medium",
        source: "subject_fuzzy",
      });
    });

    it("drops to low confidence + null propertyId when two properties tie ambiguously", async () => {
      // Both addresses have the same distinctive tokens (esplanade, mooloolaba)
      // plus a unit number that doesn't appear in the subject — so the
      // overlap score is identical for both, and the ambiguity check fires.
      fixtures.properties = [
        {
          id: "p-1",
          agency_id: AGENCY,
          owner_id: null,
          address_line1: "12 Esplanade",
          suburb: "Mooloolaba",
          archived_at: null,
        },
        {
          id: "p-2",
          agency_id: AGENCY,
          owner_id: null,
          address_line1: "14 Esplanade",
          suburb: "Mooloolaba",
          archived_at: null,
        },
      ];
      const out = await matchEmail(
        fakeClient(),
        baseInput({ subject: "Esplanade question — Mooloolaba" }),
      );
      expect(out.source).toBe("subject_fuzzy");
      expect(out.confidence).toBe("low");
      expect(out.propertyId).toBeNull();
    });
  });

  describe("Step 4: body_scan", () => {
    it("matches by body when the subject is generic", async () => {
      fixtures.properties = [
        {
          id: "p-1",
          agency_id: AGENCY,
          owner_id: null,
          address_line1: "17 Lindsay Road",
          suburb: "Buderim",
          archived_at: null,
        },
      ];
      const out = await matchEmail(
        fakeClient(),
        baseInput({
          subject: "A few things",
          bodyPreview: "Hi — I'm at 17 Lindsay Road, Buderim. Quick question about rent.",
        }),
      );
      expect(out).toMatchObject({
        propertyId: "p-1",
        confidence: "low",
        source: "body_scan",
      });
    });

    it("caps body scan at the first 500 chars (later content doesn't matter)", async () => {
      fixtures.properties = [
        {
          id: "p-1",
          agency_id: AGENCY,
          owner_id: null,
          address_line1: "17 Lindsay Road",
          suburb: "Buderim",
          archived_at: null,
        },
      ];
      // Pad first 500 chars with no address signal; address only appears after.
      const padding = "padding ".repeat(80); // ~640 chars of noise
      const body = `${padding} 17 Lindsay Road Buderim`;
      const out = await matchEmail(fakeClient(), baseInput({ subject: "Hi", bodyPreview: body }));
      expect(out.source).toBe("fallback");
    });
  });

  describe("Step 5: fallback", () => {
    it("returns the all-null fallback result when nothing matches", async () => {
      const out = await matchEmail(fakeClient(), baseInput());
      expect(out).toEqual({
        propertyId: null,
        tenantId: null,
        ownerId: null,
        confidence: "none",
        source: "fallback",
      });
    });

    it("ignores archived properties in the fuzzy steps", async () => {
      fixtures.properties = [
        {
          id: "p-archived",
          agency_id: AGENCY,
          owner_id: null,
          address_line1: "21 Bulcock Beach Esplanade",
          suburb: "Caloundra",
          archived_at: "2026-01-01T00:00:00Z",
        },
      ];
      const out = await matchEmail(
        fakeClient(),
        baseInput({ subject: "Bulcock Beach Esplanade — hot water cutting out (Caloundra)" }),
      );
      expect(out.source).toBe("fallback");
    });
  });
});
