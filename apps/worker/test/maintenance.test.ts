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
import { maintenanceRoute } from "../src/routes/maintenance";
import {
  createMaintenanceJob,
  draftTradieQuoteRequests,
  MaintenanceError,
} from "../src/services/maintenance";
import { type Db, makeFakeClient, type Row } from "./helpers/fake-supabase";

const AGENCY = "11111111-1111-1111-1111-111111111111";
const PROPERTY = "44444444-4444-4444-4444-444444444401";
const PM = "22222222-2222-2222-2222-222222222201";
const NOW = new Date("2026-06-03T00:00:00Z");

function baseDb(draftBody = "The kitchen cupboard door is loose and won't close"): Db {
  return {
    agencies: [{ id: AGENCY, name: "Sunshine Coast Test Agency", status: "active" }],
    agency_config: [
      {
        agency_id: AGENCY,
        pm_signoff_default: "Kind regards,",
        approved_tradies: [
          {
            trade: "plumbing",
            name: "Coastline Plumbing",
            business_hours_contact: "quotes@coastline.example",
          },
          { trade: "plumbing", name: "No Email Plumbers", business_hours_contact: "0400 111 222" },
          { trade: "electrical", name: "Spark Co", business_hours_contact: "spark@example.com" },
        ],
      },
    ],
    ai_drafts: [
      {
        id: "draft-1",
        agency_id: AGENCY,
        email_message_id: "msg-1",
        draft_subject: "Leaking tap",
        category: "MAINTENANCE",
      },
    ],
    email_messages: [
      {
        id: "msg-1",
        agency_id: AGENCY,
        subject: "Maintenance request",
        body_plain: draftBody,
        thread_id: "thread-1",
      },
    ],
    email_threads: [{ id: "thread-1", agency_id: AGENCY, property_id: PROPERTY }],
    properties: [
      {
        id: PROPERTY,
        agency_id: AGENCY,
        address_line1: "12 Marine Parade",
        suburb: "Maroochydore",
        managing_pm_id: PM,
      },
    ],
    agency_users: [
      { id: PM, agency_id: AGENCY, full_name: "Jess Bowman", role: "pm", active: true },
    ],
    maintenance_jobs: [],
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
  fakeClientRef.current = makeFakeClient(db, {
    uniqueKeys: { maintenance_jobs: ["source_draft_id"] },
  });
}

beforeEach(() => {
  db = baseDb();
  setClient();
});

describe("createMaintenanceJob", () => {
  it("creates a routine job from a MAINTENANCE draft, resolving the property from the thread", async () => {
    const res = await createMaintenanceJob(
      fakeClientRef.current as Client,
      { agencyId: AGENCY, draftId: "draft-1", createdByPmId: PM },
      deps,
    );
    expect(res.classification).toBe("routine");
    expect(res.propertyId).toBe(PROPERTY);
    expect(res.alreadyExisted).toBe(false);

    const job = first("maintenance_jobs");
    expect(job.source_draft_id).toBe("draft-1");
    expect(job.state).toBe("new");
    expect(job.classification).toBe("routine");
    expect(job.property_id).toBe(PROPERTY);
    expect(rows("audit_log").some((r) => r.action === "maintenance.job_created")).toBe(true);
  });

  it("triages an emergency from the s214 keywords", async () => {
    db = baseDb("There is a burst pipe flooding the kitchen, water everywhere");
    setClient();
    const res = await createMaintenanceJob(
      fakeClientRef.current as Client,
      { agencyId: AGENCY, draftId: "draft-1", createdByPmId: PM },
      deps,
    );
    expect(res.classification).toBe("emergency");
    expect(first("maintenance_jobs").classification).toBe("emergency");
  });

  it("is idempotent on the source draft (second call returns the existing job)", async () => {
    const a = await createMaintenanceJob(
      fakeClientRef.current as Client,
      { agencyId: AGENCY, draftId: "draft-1", createdByPmId: PM },
      deps,
    );
    const b = await createMaintenanceJob(
      fakeClientRef.current as Client,
      { agencyId: AGENCY, draftId: "draft-1", createdByPmId: PM },
      deps,
    );
    expect(b.alreadyExisted).toBe(true);
    expect(b.jobId).toBe(a.jobId);
    expect(rows("maintenance_jobs")).toHaveLength(1);
  });

  it("refuses to create a job from a non-inbound draft", async () => {
    first("ai_drafts").email_message_id = null;
    await expect(
      createMaintenanceJob(
        fakeClientRef.current as Client,
        { agencyId: AGENCY, draftId: "draft-1", createdByPmId: PM },
        deps,
      ),
    ).rejects.toBeInstanceOf(MaintenanceError);
  });
});

describe("draftTradieQuoteRequests", () => {
  async function makeJob(body?: string): Promise<string> {
    if (body) {
      db = baseDb(body);
      setClient();
    }
    const res = await createMaintenanceJob(
      fakeClientRef.current as Client,
      { agencyId: AGENCY, draftId: "draft-1", createdByPmId: PM },
      deps,
    );
    return res.jobId;
  }

  it("drafts one request per matching tradie with an email, skipping those without", async () => {
    const jobId = await makeJob();
    const res = await draftTradieQuoteRequests(
      fakeClientRef.current as Client,
      { agencyId: AGENCY, jobId, trade: "plumbing", createdByPmId: PM },
      deps,
    );
    expect(res.tradiesMatched).toBe(2); // two plumbing tradies
    expect(res.drafted).toBe(1); // only one has an email
    expect(res.skippedNoEmail).toBe(1);

    const quoteDrafts = rows("ai_drafts").filter((d) => d.draft_source === "maintenance");
    expect(quoteDrafts).toHaveLength(1);
    const qd = quoteDrafts[0];
    expect(qd?.recipient_email).toBe("quotes@coastline.example");
    expect(qd?.category).toBe("MAINTENANCE");
    expect(qd?.maintenance_job_id).toBe(jobId);
    expect(qd?.draft_body).toContain("Coastline Plumbing");
    expect(qd?.draft_body).not.toMatch(/\{\{|\}\}/);

    // Job moved to quoting and recorded the quote.
    const job = rows("maintenance_jobs").find((j) => j.id === jobId);
    expect(job?.state).toBe("quoting");
    expect((job?.quotes as unknown[]).length).toBe(1);
    expect(rows("audit_log").some((r) => r.action === "maintenance.quote_requested")).toBe(true);
  });

  it("only asks tradies of the requested trade", async () => {
    const jobId = await makeJob();
    const res = await draftTradieQuoteRequests(
      fakeClientRef.current as Client,
      { agencyId: AGENCY, jobId, trade: "electrical", createdByPmId: PM },
      deps,
    );
    expect(res.tradiesMatched).toBe(1);
    expect(res.drafted).toBe(1);
    expect(rows("ai_drafts").find((d) => d.draft_source === "maintenance")?.recipient_email).toBe(
      "spark@example.com",
    );
  });

  it("marks an emergency quote request PRIORITY with an urgency line", async () => {
    const jobId = await makeJob("burst pipe flooding the kitchen");
    await draftTradieQuoteRequests(
      fakeClientRef.current as Client,
      { agencyId: AGENCY, jobId, trade: "plumbing", createdByPmId: PM },
      deps,
    );
    const qd = rows("ai_drafts").find((d) => d.draft_source === "maintenance");
    expect(qd?.priority).toBe("PRIORITY");
    expect(qd?.draft_body).toContain("urgent repair");
  });
});

// ---- Route (JWT auth + happy path) ---------------------------------------

const SECRET = "test-supabase-jwt-secret-0123456789";
const SUPABASE_URL = "http://127.0.0.1:54321";
const routeEnv = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-key",
  SUPABASE_JWT_SECRET: SECRET,
} as unknown as WorkerBindings;

async function token(agencyId = AGENCY, sub = "auth-user-1"): Promise<string> {
  return new SignJWT({ app_metadata: { agency_id: agencyId } })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setAudience("authenticated")
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

async function post(body: unknown, bearer?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return maintenanceRoute.request(
    "/api/maintenance/jobs",
    { method: "POST", headers, body: JSON.stringify(body) },
    routeEnv,
  );
}

describe("POST /api/maintenance/jobs", () => {
  beforeEach(() => {
    // The route resolves the caller via auth_user_id; wire that on the PM row.
    db = baseDb();
    first("agency_users").auth_user_id = "auth-user-1";
    setClient();
  });

  it("401s without a valid token", async () => {
    expect((await post({ sourceDraftId: "draft-1" })).status).toBe(401);
  });

  it("creates a job and drafts quote requests for the supplied trade (201)", async () => {
    const res = await post({ sourceDraftId: "draft-1", trade: "plumbing" }, await token());
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      jobId: string;
      classification: string;
      quoteRequests: { drafted: number } | null;
    };
    expect(json.classification).toBe("routine");
    expect(json.quoteRequests?.drafted).toBe(1);
    expect(rows("maintenance_jobs")).toHaveLength(1);
  });

  it("404s when the source draft doesn't exist", async () => {
    const res = await post({ sourceDraftId: "missing" }, await token());
    expect(res.status).toBe(404);
  });
});
