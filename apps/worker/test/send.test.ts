import { GmailApiError } from "@pm/shared";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// --- Module mocks -----------------------------------------------------------
vi.mock("../src/services/supabase", () => ({
  createServiceClient: vi.fn(() => currentClient),
  writeAuditLog: vi.fn(async () => undefined),
}));
vi.mock("../src/services/gmail", () => ({
  usersMessagesSend: vi.fn(async () => ({ id: "sent-gmail-id", threadId: "gmail-thread-1" })),
  refreshAccessToken: vi.fn(async () => ({
    access_token: "access-tok",
    expires_in: 3600,
    scope: "",
    token_type: "Bearer",
  })),
}));
vi.mock("../src/services/vault", () => ({
  getGmailRefreshToken: vi.fn(async () => "refresh-tok"),
}));

import type { WorkerBindings } from "../src/lib/env";
import { sendRoute } from "../src/routes/send";
import { usersMessagesSend } from "../src/services/gmail";

const usersMessagesSendMock = usersMessagesSend as Mock;

// --- Hand-rolled supabase fake (only the shapes the route uses) -------------
interface SendState {
  pm: { id: string; full_name: string; active: boolean } | null;
  draft: {
    id: string;
    email_message_id: string | null;
    draft_source: "inbound_reply" | "sequence";
    recipient_email: string | null;
    recipient_name: string | null;
    property_id: string | null;
    draft_subject: string | null;
    draft_body: string | null;
    status: string;
    assigned_pm_id: string | null;
    do_not_send: boolean;
  } | null;
  inbound: {
    thread_id: string;
    from_address: string;
    message_id_header: string | null;
    references_headers: string[] | null;
  } | null;
  agency: { name: string; is_demo?: boolean } | null;
  emailState: { mailbox_address: string } | null;
  thread: { gmail_thread_id: string } | null;
  outboundInsertError: { message: string } | null;
  editInserts: Array<Record<string, unknown>>;
  outboundInserts: Array<Record<string, unknown>>;
  threadUpserts: Array<Record<string, unknown>>;
  draftUpdates: Array<Record<string, unknown>>;
}

let state: SendState;
// biome-ignore lint/suspicious/noExplicitAny: only the touched shape is mocked
let currentClient: any;

function selectChain(result: unknown) {
  const chain = {
    eq: () => chain,
    maybeSingle: async () => result,
    single: async () => result,
  };
  return chain;
}

function updateChain(rows: unknown[]) {
  const u = {
    eq: () => u,
    in: () => u,
    select: async () => ({ data: rows, error: null }),
  };
  return u;
}

function makeClient(s: SendState) {
  return {
    from(table: string) {
      switch (table) {
        case "agency_users":
          return { select: () => selectChain({ data: s.pm, error: null }) };
        case "ai_drafts":
          return {
            select: () => selectChain({ data: s.draft, error: null }),
            update: (row: Record<string, unknown>) => {
              s.draftUpdates.push(row);
              return updateChain([{ id: "draft-1" }]);
            },
          };
        case "email_messages":
          return {
            select: () => selectChain({ data: s.inbound, error: null }),
            insert: (row: Record<string, unknown>) => {
              s.outboundInserts.push(row);
              return Promise.resolve({ error: s.outboundInsertError });
            },
          };
        case "agencies":
          return { select: () => selectChain({ data: s.agency, error: null }) };
        case "agency_email_state":
          return { select: () => selectChain({ data: s.emailState, error: null }) };
        case "email_threads":
          return {
            select: () => selectChain({ data: s.thread, error: null }),
            upsert: (row: Record<string, unknown>) => {
              s.threadUpserts.push(row);
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: { id: "new-thread-db-1" }, error: null }),
                }),
              };
            },
          };
        case "draft_edits":
          return {
            insert: (row: Record<string, unknown>) => {
              s.editInserts.push(row);
              return Promise.resolve({ error: null });
            },
          };
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  };
}

// --- Env + token helpers ----------------------------------------------------
const SECRET = "test-supabase-jwt-secret-0123456789";
const SUPABASE_URL = "http://127.0.0.1:54321";

const env = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-key-1234567890abcdef",
  SUPABASE_JWT_SECRET: SECRET,
  GMAIL_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com",
  GMAIL_OAUTH_CLIENT_SECRET: "GOCSPX-test",
} as unknown as WorkerBindings;

async function token(overrides: { agencyId?: string; sub?: string } = {}): Promise<string> {
  return new SignJWT({ app_metadata: { agency_id: overrides.agencyId ?? "agency-aaa" } })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(overrides.sub ?? "auth-user-1")
    .setAudience("authenticated")
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

async function post(draftId: string, body: unknown, bearer?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return sendRoute.request(
    `/api/drafts/${draftId}/send`,
    { method: "POST", headers, body: JSON.stringify(body) },
    env,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  usersMessagesSendMock.mockResolvedValue({ id: "sent-gmail-id", threadId: "gmail-thread-1" });
  state = {
    pm: { id: "pm-1", full_name: "Jess Bowman", active: true },
    draft: {
      id: "draft-1",
      email_message_id: "msg-1",
      draft_source: "inbound_reply",
      recipient_email: null,
      recipient_name: null,
      property_id: null,
      draft_subject: "Re: leaking tap",
      draft_body: "Original body",
      status: "pending",
      assigned_pm_id: null,
      do_not_send: false,
    },
    inbound: {
      thread_id: "thread-1",
      from_address: "tenant@example.com",
      message_id_header: "<inbound-1@mail.example.com>",
      references_headers: ["<root@mail.example.com>"],
    },
    agency: { name: "Sunshine Coast Rentals" },
    emailState: { mailbox_address: "rentals@agency.com.au" },
    thread: { gmail_thread_id: "gmail-thread-1" },
    outboundInsertError: null,
    editInserts: [],
    outboundInserts: [],
    threadUpserts: [],
    draftUpdates: [],
  };
  currentClient = makeClient(state);
});

describe("POST /api/drafts/:id/send", () => {
  it("sends the draft, records the outbound message, and marks it sent", async () => {
    const res = await post(
      "draft-1",
      { subject: "Re: leaking tap", body: "Edited reply" },
      await token(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; gmailMessageId: string };
    expect(json).toMatchObject({ id: "draft-1", gmailMessageId: "sent-gmail-id" });

    // sent in-thread
    expect(usersMessagesSendMock).toHaveBeenCalledTimes(1);
    expect(usersMessagesSendMock.mock.calls[0]?.[0]).toMatchObject({ threadId: "gmail-thread-1" });

    // outbound row written before status flip, with our identity + threading
    expect(state.outboundInserts).toHaveLength(1);
    expect(state.outboundInserts[0]).toMatchObject({
      direction: "outbound",
      gmail_message_id: "sent-gmail-id",
      from_address: "rentals@agency.com.au",
      in_reply_to: "<inbound-1@mail.example.com>",
    });

    // draft marked sent + claimed by the sender (was unassigned)
    expect(state.draftUpdates).toHaveLength(1);
    expect(state.draftUpdates[0]).toMatchObject({
      status: "sent",
      sent_gmail_message_id: "sent-gmail-id",
      assigned_pm_id: "pm-1",
    });

    // body changed on send -> a draft_edits row captured
    expect(state.editInserts).toHaveLength(1);
  });

  // --- Demo sandbox: the hermetic seal (acceptance criterion) ---------------
  describe("demo sandbox", () => {
    it("a demo agency send NEVER reaches Gmail — it is intercepted into a sandboxed outbound row", async () => {
      state.agency = { name: "Coastline Property Management (Demo)", is_demo: true };
      // Demo tenants have no mailbox identity at all (defense in depth).
      state.emailState = null;

      const res = await post(
        "draft-1",
        { subject: "Re: leaking tap", body: "Edited reply" },
        await token(),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { sandbox?: boolean; gmailMessageId: string };
      expect(json.sandbox).toBe(true);
      expect(json.gmailMessageId).toMatch(/^demo-sent-/);

      // THE assertion: the real transport was never touched.
      expect(usersMessagesSendMock).not.toHaveBeenCalled();

      // The full send lifecycle still happened, sandboxed: outbound row,
      // status flip with optimistic lock, edit capture.
      expect(state.outboundInserts).toHaveLength(1);
      expect(state.outboundInserts[0]).toMatchObject({ direction: "outbound" });
      expect(String(state.outboundInserts[0]?.gmail_message_id)).toMatch(/^demo-sent-/);
      expect(state.draftUpdates).toHaveLength(1);
      expect(state.draftUpdates[0]).toMatchObject({ status: "sent", assigned_pm_id: "pm-1" });
      expect(state.editInserts).toHaveLength(1);
    });

    it("a demo send still honours the do_not_send hard gate", async () => {
      state.agency = { name: "Demo", is_demo: true };
      state.emailState = null;
      if (state.draft) state.draft.do_not_send = true;
      const res = await post("draft-1", { subject: "s", body: "b" }, await token());
      expect(res.status).toBe(409);
      expect(usersMessagesSendMock).not.toHaveBeenCalled();
      expect(state.outboundInserts).toHaveLength(0);
    });

    it("a real agency (is_demo false) still sends via Gmail", async () => {
      state.agency = { name: "Sunshine Coast Rentals", is_demo: false };
      const res = await post("draft-1", { subject: "s", body: "b" }, await token());
      expect(res.status).toBe(200);
      expect(usersMessagesSendMock).toHaveBeenCalledTimes(1);
    });
  });

  it("does not write a draft_edits row when nothing changed", async () => {
    await post("draft-1", { subject: "Re: leaking tap", body: "Original body" }, await token());
    expect(state.editInserts).toHaveLength(0);
  });

  it("rejects a missing/invalid token with 401", async () => {
    expect((await post("draft-1", { subject: "s", body: "b" })).status).toBe(401);
    expect((await post("draft-1", { subject: "s", body: "b" }, "garbage")).status).toBe(401);
  });

  it("returns 403 when the caller has no active agency user", async () => {
    state.pm = null;
    expect((await post("draft-1", { subject: "s", body: "b" }, await token())).status).toBe(403);
  });

  it("returns 403 when the draft is assigned to another PM", async () => {
    if (state.draft) state.draft.assigned_pm_id = "pm-other";
    expect((await post("draft-1", { subject: "s", body: "b" }, await token())).status).toBe(403);
    expect(state.draftUpdates).toHaveLength(0);
  });

  it("returns 404 when the draft does not exist", async () => {
    state.draft = null;
    expect((await post("nope", { subject: "s", body: "b" }, await token())).status).toBe(404);
  });

  it("returns 409 when the draft is not in a sendable state", async () => {
    if (state.draft) state.draft.status = "sent";
    expect((await post("draft-1", { subject: "s", body: "b" }, await token())).status).toBe(409);
    expect(usersMessagesSendMock).not.toHaveBeenCalled();
  });

  it("returns 409 and never sends a do_not_send draft", async () => {
    if (state.draft) state.draft.do_not_send = true;
    const res = await post("draft-1", { subject: "s", body: "b" }, await token());
    expect(res.status).toBe(409);
    expect(usersMessagesSendMock).not.toHaveBeenCalled();
    expect(state.draftUpdates).toHaveLength(0);
    expect(state.outboundInserts).toHaveLength(0);
  });

  it("returns 502 and does NOT flip status when Gmail send fails", async () => {
    usersMessagesSendMock.mockRejectedValueOnce(
      new GmailApiError("boom", { statusCode: 500, endpoint: "send" }),
    );
    const res = await post("draft-1", { subject: "s", body: "b" }, await token());
    expect(res.status).toBe(502);
    expect(state.draftUpdates).toHaveLength(0);
    expect(state.outboundInserts).toHaveLength(0);
  });

  it("allows sending a draft already assigned to the caller", async () => {
    if (state.draft) state.draft.assigned_pm_id = "pm-1";
    const res = await post("draft-1", { subject: "s", body: "b" }, await token());
    expect(res.status).toBe(200);
  });

  // --- Outbound (sequence) drafts -------------------------------------------

  it("sends an outbound sequence draft as a new email (new thread, no In-Reply-To)", async () => {
    state.draft = {
      id: "draft-1",
      email_message_id: null,
      draft_source: "sequence",
      recipient_email: "alex.tan@example.com",
      recipient_name: "Alex Tan",
      property_id: "prop-1",
      draft_subject: "Your tenancy — renewal",
      draft_body: "Hi Alex, your lease is ending…",
      status: "pending",
      assigned_pm_id: null,
      do_not_send: false,
    };
    const res = await post(
      "draft-1",
      { subject: "Your tenancy — renewal", body: "Hi Alex, your lease is ending…" },
      await token(),
    );
    expect(res.status).toBe(200);

    // New email: no threadId passed to Gmail (it starts a fresh thread).
    expect(usersMessagesSendMock).toHaveBeenCalledTimes(1);
    expect(usersMessagesSendMock.mock.calls[0]?.[0]?.threadId).toBeUndefined();

    // A thread row is upserted on the Gmail thread id Gmail just assigned.
    expect(state.threadUpserts).toHaveLength(1);
    expect(state.threadUpserts[0]).toMatchObject({
      gmail_thread_id: "gmail-thread-1",
      property_id: "prop-1",
    });

    // Outbound message filed under the new thread, addressed to the recipient,
    // with no In-Reply-To (it's not a reply).
    expect(state.outboundInserts).toHaveLength(1);
    expect(state.outboundInserts[0]).toMatchObject({
      direction: "outbound",
      thread_id: "new-thread-db-1",
      to_addresses: ["alex.tan@example.com"],
      in_reply_to: null,
    });

    expect(state.draftUpdates[0]).toMatchObject({ status: "sent" });
  });

  it("409s an outbound sequence draft that has no recipient address", async () => {
    state.draft = {
      id: "draft-1",
      email_message_id: null,
      draft_source: "sequence",
      recipient_email: null,
      recipient_name: null,
      property_id: null,
      draft_subject: "s",
      draft_body: "b",
      status: "pending",
      assigned_pm_id: null,
      do_not_send: false,
    };
    const res = await post("draft-1", { subject: "s", body: "b" }, await token());
    expect(res.status).toBe(409);
    expect(usersMessagesSendMock).not.toHaveBeenCalled();
    expect(state.outboundInserts).toHaveLength(0);
  });
});
