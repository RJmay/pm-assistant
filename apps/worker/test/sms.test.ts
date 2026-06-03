import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const fakeClientRef = vi.hoisted(() => ({ current: null as Client | null }));
vi.mock("../src/services/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/supabase")>();
  return { ...actual, createServiceClient: () => fakeClientRef.current };
});
vi.mock("../src/services/twilio", () => ({
  sendSms: vi.fn(async () => ({ sid: "SM-test", status: "queued" })),
}));

import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { smsRoute } from "../src/routes/sms";
import { processInboundSms, SmsError, sendSmsReply } from "../src/services/sms";
import { sendSms } from "../src/services/twilio";
import { verifyTwilioSignature } from "../src/services/twilio-inbound";
import { type Db, makeFakeClient, type Row } from "./helpers/fake-supabase";

const sendSmsMock = sendSms as Mock;

const AGENCY = "11111111-1111-1111-1111-111111111111";
const PROPERTY = "44444444-4444-4444-4444-444444444401";
const TENANCY = "55555555-5555-5555-5555-555555555501";
const TENANT_PHONE = "+61400200001";
const AGENCY_NUMBER = "+61755500000";
const AUTH_TOKEN = "test-twilio-auth-token";

function baseDb(): Db {
  return {
    agencies: [{ id: AGENCY, name: "Sunshine Coast Test Agency", status: "active" }],
    tenants: [
      {
        id: "tenant-1",
        agency_id: AGENCY,
        tenancy_id: TENANCY,
        full_name: "Alex Tan",
        phone: TENANT_PHONE,
        is_primary: true,
      },
    ],
    tenancies: [{ id: TENANCY, agency_id: AGENCY, property_id: PROPERTY, status: "active" }],
    maintenance_jobs: [
      {
        id: "job-1",
        agency_id: AGENCY,
        property_id: PROPERTY,
        trade: "plumbing",
        state: "scheduled",
        scheduled_for: "2026-06-12T00:00:00Z",
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    sms_messages: [],
    audit_log: [],
  };
}

const env = {
  TWILIO_ACCOUNT_SID: "AC-test",
  TWILIO_AUTH_TOKEN: AUTH_TOKEN,
} as unknown as WorkerBindings;
const silent = createLogger({ level: "error" });
const deps = { logger: silent };

let db: Db;
const rows = (t: string): Row[] => db[t] ?? [];

beforeEach(() => {
  db = baseDb();
  fakeClientRef.current = makeFakeClient(db);
  sendSmsMock.mockClear();
});

// ---- signature verification ----------------------------------------------

async function twilioSign(url: string, params: Record<string, string>): Promise<string> {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(AUTH_TOKEN),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  let bin = "";
  const arr = new Uint8Array(sig);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i] as number);
  return btoa(bin);
}

describe("verifyTwilioSignature", () => {
  it("accepts a correct signature and rejects a tampered one", async () => {
    const url = "https://w.example/webhook/sms/agency";
    const params = { From: "+61400000000", To: AGENCY_NUMBER, Body: "hi" };
    const sig = await twilioSign(url, params);
    expect(
      await verifyTwilioSignature({ authToken: AUTH_TOKEN, url, params, signature: sig }),
    ).toBe(true);
    expect(
      await verifyTwilioSignature({ authToken: AUTH_TOKEN, url, params, signature: `${sig}x` }),
    ).toBe(false);
    // body tampered → signature no longer matches
    expect(
      await verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url,
        params: { ...params, Body: "different" },
        signature: sig,
      }),
    ).toBe(false);
  });
});

// ---- processInboundSms ----------------------------------------------------

describe("processInboundSms", () => {
  it("drafts a status reply from the tenant's open job", async () => {
    const res = await processInboundSms(
      fakeClientRef.current as Client,
      {
        agencyId: AGENCY,
        fromNumber: TENANT_PHONE,
        toNumber: AGENCY_NUMBER,
        body: "any update on my repair?",
      },
      deps,
    );
    expect(res.classification.intent).toBe("status_query");
    expect(res.status).toBe("drafted");
    const row = rows("sms_messages")[0];
    expect(row?.direction).toBe("inbound");
    expect(row?.tenant_id).toBe("tenant-1");
    expect(row?.maintenance_job_id).toBe("job-1");
    expect(row?.draft_reply).toContain("plumbing");
    expect(row?.draft_reply).toContain("scheduled");
    expect(rows("audit_log").some((r) => r.action === "sms.received")).toBe(true);
  });

  it("flags an escalation and does NOT draft a reply", async () => {
    const res = await processInboundSms(
      fakeClientRef.current as Client,
      {
        agencyId: AGENCY,
        fromNumber: TENANT_PHONE,
        toNumber: AGENCY_NUMBER,
        body: "I'm taking you to QCAT",
      },
      deps,
    );
    expect(res.status).toBe("escalated");
    const row = rows("sms_messages")[0];
    expect(row?.escalation_flag).toBe("LEGAL");
    expect(row?.draft_reply ?? null).toBeNull();
  });

  it("still drafts a holding reply for an unknown sender", async () => {
    const res = await processInboundSms(
      fakeClientRef.current as Client,
      { agencyId: AGENCY, fromNumber: "+61499999999", toNumber: AGENCY_NUMBER, body: "status?" },
      deps,
    );
    expect(res.status).toBe("drafted");
    expect(rows("sms_messages")[0]?.tenant_id ?? null).toBeNull();
    expect(rows("sms_messages")[0]?.draft_reply).toContain("don't have an open job");
  });
});

// ---- sendSmsReply ---------------------------------------------------------

describe("sendSmsReply", () => {
  it("sends via Twilio, records the outbound row, marks the inbound sent", async () => {
    rows("sms_messages").push({
      id: "in-1",
      agency_id: AGENCY,
      direction: "inbound",
      from_number: TENANT_PHONE,
      to_number: AGENCY_NUMBER,
      body: "status?",
      status: "drafted",
    });
    const res = await sendSmsReply(
      fakeClientRef.current as Client,
      env,
      { agencyId: AGENCY, smsId: "in-1", body: "Your job is scheduled.", sentByPmId: "pm-1" },
      deps,
    );
    expect(res.providerSid).toBe("SM-test");
    expect(sendSmsMock).toHaveBeenCalledWith(
      { to: TENANT_PHONE, from: AGENCY_NUMBER, body: "Your job is scheduled." },
      expect.anything(),
    );
    const outbound = rows("sms_messages").find((r) => r.direction === "outbound");
    expect(outbound?.reply_to_sms_id).toBe("in-1");
    expect(rows("sms_messages").find((r) => r.id === "in-1")?.status).toBe("sent");
  });

  it("refuses to re-send an already-sent reply", async () => {
    rows("sms_messages").push({
      id: "in-2",
      agency_id: AGENCY,
      direction: "inbound",
      from_number: TENANT_PHONE,
      to_number: AGENCY_NUMBER,
      body: "x",
      status: "sent",
    });
    await expect(
      sendSmsReply(
        fakeClientRef.current as Client,
        env,
        { agencyId: AGENCY, smsId: "in-2", body: "hi", sentByPmId: "pm-1" },
        deps,
      ),
    ).rejects.toBeInstanceOf(SmsError);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});

// ---- webhook route --------------------------------------------------------

describe("POST /webhook/sms/:agencyId", () => {
  async function postSigned(body: Record<string, string>, sign = true) {
    const url = `https://w.example/webhook/sms/${AGENCY}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (sign) headers["X-Twilio-Signature"] = await twilioSign(url, body);
    return smsRoute.request(
      url,
      { method: "POST", headers, body: new URLSearchParams(body).toString() },
      env,
    );
  }

  it("captures a signed inbound message and returns empty TwiML", async () => {
    const res = await postSigned({
      From: TENANT_PHONE,
      To: AGENCY_NUMBER,
      Body: "any update?",
      MessageSid: "SM-in-1",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<Response></Response>");
    expect(rows("sms_messages")).toHaveLength(1);
    expect(rows("sms_messages")[0]?.intent).toBe("status_query");
  });

  it("rejects an unsigned / bad-signature request with 403", async () => {
    const res = await postSigned({ From: TENANT_PHONE, To: AGENCY_NUMBER, Body: "hi" }, false);
    expect(res.status).toBe(403);
    expect(rows("sms_messages")).toHaveLength(0);
  });
});
