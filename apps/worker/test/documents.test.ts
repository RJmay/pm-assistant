import type { Client } from "@pm/db";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeClientRef = vi.hoisted(() => ({ current: null as Client | null }));
vi.mock("../src/services/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/supabase")>();
  return { ...actual, createServiceClient: () => fakeClientRef.current };
});

import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { documentsRoute } from "../src/routes/documents";
import { DocumentError, generateDocument } from "../src/services/documents";
import { type Db, makeFakeClient, type Row } from "./helpers/fake-supabase";

const AGENCY = "11111111-1111-1111-1111-111111111111";
const PROPERTY = "44444444-4444-4444-4444-444444444401";
const TENANCY = "55555555-5555-5555-5555-555555555501";
const PM = "22222222-2222-2222-2222-222222222201";
const NOW = new Date("2026-06-03T00:00:00Z");

function baseDb(): Db {
  return {
    agencies: [{ id: AGENCY, name: "Sunshine Coast Test Agency", status: "active" }],
    tenancies: [
      {
        id: TENANCY,
        agency_id: AGENCY,
        property_id: PROPERTY,
        end_date: "2026-10-31",
        rent_amount_cents: 58000,
        rent_frequency: "weekly",
        last_rent_increase_date: "2025-01-01",
        last_routine_inspection_date: null,
        status: "active",
      },
    ],
    properties: [
      {
        id: PROPERTY,
        agency_id: AGENCY,
        address_line1: "12 Marine Parade",
        suburb: "Maroochydore",
      },
    ],
    tenants: [
      {
        id: "tenant-1",
        agency_id: AGENCY,
        tenancy_id: TENANCY,
        full_name: "Alex Tan",
        is_primary: true,
      },
    ],
    agency_users: [
      {
        id: PM,
        agency_id: AGENCY,
        auth_user_id: "auth-user-1",
        full_name: "Jess Bowman",
        role: "pm",
        active: true,
      },
    ],
    documents: [],
    audit_log: [],
  };
}

const silent = createLogger({ level: "error" });
const deps = { logger: silent, now: () => NOW };

let db: Db;
const rows = (t: string): Row[] => db[t] ?? [];
const first = (t: string): Row => {
  const r = rows(t)[0];
  if (!r) throw new Error(`expected at least one row in ${t}`);
  return r;
};

function setClient() {
  fakeClientRef.current = makeFakeClient(db);
}

beforeEach(() => {
  db = baseDb();
  setClient();
});

describe("generateDocument", () => {
  it("generates a Form 9 entry notice, stores content + rule versions, audits", async () => {
    const res = await generateDocument(
      fakeClientRef.current as Client,
      { agencyId: AGENCY, type: "entry_notice", tenancyId: TENANCY, createdByPmId: PM },
      deps,
    );
    expect(res.formId).toBe("9");
    expect(res.type).toBe("entry_notice");

    const doc = first("documents");
    expect(doc.type).toBe("entry_notice");
    expect(doc.form_id).toBe("9");
    expect(doc.tenancy_id).toBe(TENANCY);
    expect(doc.content).toContain("Entry Notice (Form 9)");
    expect(doc.content).toContain("10 June 2026"); // notice + 7 days
    expect((doc.rule_versions as string[]).length).toBeGreaterThan(0);
    // A rendered PDF is stored alongside the HTML (0021). base64 of "%PDF" → "JVBER…".
    expect(typeof doc.pdf_base64).toBe("string");
    expect((doc.pdf_base64 as string).startsWith("JVBER")).toBe(true);
    expect(rows("audit_log").some((r) => r.action === "document.generated")).toBe(true);
  });

  it("generates a compliant rent-increase notice", async () => {
    const res = await generateDocument(
      fakeClientRef.current as Client,
      {
        agencyId: AGENCY,
        type: "rent_increase_notice",
        tenancyId: TENANCY,
        newRentCents: 62000,
        createdByPmId: PM,
      },
      deps,
    );
    expect(res.formId).toBeNull();
    const doc = first("documents");
    expect(doc.content).toContain("$620.00");
    expect(doc.content).toContain("3 August 2026"); // notice + 2 months
  });

  it("refuses a non-compliant rent increase (not higher than current)", async () => {
    await expect(
      generateDocument(
        fakeClientRef.current as Client,
        {
          agencyId: AGENCY,
          type: "rent_increase_notice",
          tenancyId: TENANCY,
          newRentCents: 58000,
          createdByPmId: PM,
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(DocumentError);
    expect(rows("documents")).toHaveLength(0);
  });

  it("throws tenancy_not_found for an unknown tenancy", async () => {
    await expect(
      generateDocument(
        fakeClientRef.current as Client,
        { agencyId: AGENCY, type: "entry_notice", tenancyId: "missing", createdByPmId: PM },
        deps,
      ),
    ).rejects.toMatchObject({ code: "tenancy_not_found" });
  });

  it("generates a Form 11 (remedy breach) with the RTA-confirmed 7-day period", async () => {
    const res = await generateDocument(
      fakeClientRef.current as Client,
      {
        agencyId: AGENCY,
        type: "notice_to_remedy_breach",
        tenancyId: TENANCY,
        amountOwedCents: 116000,
        createdByPmId: PM,
      },
      deps,
    );
    expect(res.formId).toBe("11");
    const doc = first("documents");
    expect(doc.content).toContain("Notice to Remedy Breach (Form 11)");
    expect(doc.content).toContain("10 June 2026"); // notice 2026-06-03 + 7 days
    expect(doc.content).toContain("$1,160.00");
  });

  it("generates a Form 11 general (non-rent) breach (7 days) with the described breach", async () => {
    const res = await generateDocument(
      fakeClientRef.current as Client,
      {
        agencyId: AGENCY,
        type: "notice_to_remedy_breach",
        tenancyId: TENANCY,
        breach: "general",
        breachDescription: "Unapproved pet kept at the premises",
        createdByPmId: PM,
      },
      deps,
    );
    expect(res.formId).toBe("11");
    const doc = first("documents");
    expect(doc.content).toContain("Unapproved pet kept at the premises");
    expect(doc.content).toContain("10 June 2026"); // notice + 7 days
  });

  it("generates a Form 11 moveable-dwelling rent breach (5 days)", async () => {
    const res = await generateDocument(
      fakeClientRef.current as Client,
      {
        agencyId: AGENCY,
        type: "notice_to_remedy_breach",
        tenancyId: TENANCY,
        breach: "rent",
        dwelling: "moveable",
        amountOwedCents: 50000,
        createdByPmId: PM,
      },
      deps,
    );
    expect(res.formId).toBe("11");
    expect(first("documents").content).toContain("8 June 2026"); // notice + 5 days
  });

  it("generates a Form 12 unremedied general breach (14 days)", async () => {
    const res = await generateDocument(
      fakeClientRef.current as Client,
      {
        agencyId: AGENCY,
        type: "notice_to_leave",
        tenancyId: TENANCY,
        ground: "unremedied_general_breach",
        createdByPmId: PM,
      },
      deps,
    );
    expect(res.formId).toBe("12");
    const doc = first("documents");
    expect(doc.content).toContain("14 days");
    expect(doc.content).toContain("17 June 2026"); // notice + 14 days
  });

  it("refuses a general breach with no description (missing_data)", async () => {
    await expect(
      generateDocument(
        fakeClientRef.current as Client,
        {
          agencyId: AGENCY,
          type: "notice_to_remedy_breach",
          tenancyId: TENANCY,
          breach: "general",
          createdByPmId: PM,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "missing_data" });
    expect(rows("documents")).toHaveLength(0);
  });

  it("refuses a rent breach with no amount (missing_data)", async () => {
    await expect(
      generateDocument(
        fakeClientRef.current as Client,
        {
          agencyId: AGENCY,
          type: "notice_to_remedy_breach",
          tenancyId: TENANCY,
          breach: "rent",
          createdByPmId: PM,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "missing_data" });
  });

  it("generates a Form 13 (notice of intention to leave) with the tenant as sender", async () => {
    const res = await generateDocument(
      fakeClientRef.current as Client,
      {
        agencyId: AGENCY,
        type: "notice_of_intention_to_leave",
        tenancyId: TENANCY,
        ground: "periodic",
        createdByPmId: PM,
      },
      deps,
    );
    expect(res.formId).toBe("13");
    expect(res.type).toBe("notice_of_intention_to_leave");
    const doc = first("documents");
    expect(doc.type).toBe("notice_of_intention_to_leave");
    expect(doc.content).toContain("Notice of Intention to Leave (Form 13)");
    expect(doc.content).toContain("17 June 2026"); // notice + 14 days
  });

  it("generates a Form 12 end-of-fixed-term notice (2 months, handover = later of notice+2mo / lease end)", async () => {
    const res = await generateDocument(
      fakeClientRef.current as Client,
      {
        agencyId: AGENCY,
        type: "notice_to_leave",
        tenancyId: TENANCY,
        ground: "end_of_fixed_term",
        createdByPmId: PM,
      },
      deps,
    );
    expect(res.formId).toBe("12");
    const doc = first("documents");
    expect(doc.content).toContain("Notice to Leave (Form 12)");
    expect(doc.content).toContain("2 months");
    // lease ends 2026-10-31, later than notice+2mo (2026-08-03)
    expect(doc.content).toContain("31 October 2026");
  });
});

// ---- Route ----------------------------------------------------------------

const SECRET = "test-supabase-jwt-secret-0123456789";
const SUPABASE_URL = "http://127.0.0.1:54321";
const routeEnv = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-key",
  SUPABASE_JWT_SECRET: SECRET,
} as unknown as WorkerBindings;

async function token(): Promise<string> {
  return new SignJWT({ app_metadata: { agency_id: AGENCY } })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("auth-user-1")
    .setAudience("authenticated")
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

async function post(body: unknown, bearer?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return documentsRoute.request(
    "/api/documents",
    { method: "POST", headers, body: JSON.stringify(body) },
    routeEnv,
  );
}

describe("POST /api/documents", () => {
  it("401s without a token", async () => {
    expect((await post({ type: "entry_notice", tenancyId: TENANCY })).status).toBe(401);
  });

  it("generates a document (201)", async () => {
    const res = await post({ type: "entry_notice", tenancyId: TENANCY }, await token());
    expect(res.status).toBe(201);
    const json = (await res.json()) as { formId: string | null };
    expect(json.formId).toBe("9");
    expect(rows("documents")).toHaveLength(1);
  });

  it("409s a non-compliant request and surfaces the reason", async () => {
    const res = await post(
      { type: "rent_increase_notice", tenancyId: TENANCY, newRentCents: 58000 },
      await token(),
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe("not_compliant");
  });

  it("generates a general-breach Form 11 (201)", async () => {
    const res = await post(
      {
        type: "notice_to_remedy_breach",
        tenancyId: TENANCY,
        breach: "general",
        breachDescription: "Unapproved pet kept at the premises",
      },
      await token(),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { formId: string | null };
    expect(json.formId).toBe("11");
  });

  it("409s a general breach with no description (missing_data)", async () => {
    const res = await post(
      { type: "notice_to_remedy_breach", tenancyId: TENANCY, breach: "general" },
      await token(),
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe("missing_data");
  });

  it("generates a Form 13 notice of intention to leave (201)", async () => {
    const res = await post(
      { type: "notice_of_intention_to_leave", tenancyId: TENANCY, ground: "periodic" },
      await token(),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { formId: string | null };
    expect(json.formId).toBe("13");
  });

  it("generates a Form 13 with an additional ground (201)", async () => {
    const res = await post(
      {
        type: "notice_of_intention_to_leave",
        tenancyId: TENANCY,
        ground: "compulsory_acquisition",
      },
      await token(),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { formId: string | null }).formId).toBe("13");
  });
});
