import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const fakeClientRef = vi.hoisted(() => ({ current: null as Client | null }));
vi.mock("../src/services/supabase", () => ({
  createServiceClient: () => fakeClientRef.current,
}));
vi.mock("../src/services/resend", () => ({ sendEmail: vi.fn() }));

import { runOwnerDigest } from "../src/cron/owner-digest";
import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { sendEmail } from "../src/services/resend";

const sendEmailMock = sendEmail as Mock;

// ----------------------------------------------------------------------------
// Fake supabase — only the methods owner-digest uses
// ----------------------------------------------------------------------------

interface QueuedRow {
  id: string;
  agency_id: string;
  owner_id: string | null;
  property_id: string | null;
  body: string | null;
  triggered_by_draft_id: string | null;
  scheduled_for: string | null;
  channel: "digest";
  status: "queued" | "sent";
}
interface OwnerRow {
  id: string;
  full_name: string;
  email: string | null;
}
interface AgencyRow {
  id: string;
  name: string;
  status: "active";
}

interface State {
  agencies: AgencyRow[];
  queued: QueuedRow[];
  owners: OwnerRow[];
  updates: Array<{ ids: string[]; status: string; sent_at: string }>;
  updateError: { message: string } | null;
  failScanForAgency?: string;
}

let state: State;

function reset() {
  state = {
    agencies: [],
    queued: [],
    owners: [],
    updates: [],
    updateError: null,
  };
}

function fakeClient(): Client {
  return {
    from(table: string) {
      if (table === "agencies") return agenciesBuilder();
      if (table === "notification_log") return notificationBuilder();
      if (table === "owners") return ownersBuilder();
      throw new Error(`unexpected table ${table}`);
    },
    // biome-ignore lint/suspicious/noExplicitAny: only the surface we touch is mocked
  } as any;
}

function agenciesBuilder() {
  return {
    select: () => ({
      eq: async () => ({ data: state.agencies, error: null }),
    }),
  };
}

interface NotifyQuery {
  agency_id?: string;
  channel?: string;
  status?: string;
  lte?: string;
}
function notificationBuilder() {
  const q: NotifyQuery = {};
  const finish = async () => {
    if (state.failScanForAgency && q.agency_id === state.failScanForAgency) {
      return { data: null, error: { message: "simulated scan failure" } };
    }
    const data = state.queued.filter((r) => {
      if (q.agency_id && r.agency_id !== q.agency_id) return false;
      if (q.channel && r.channel !== q.channel) return false;
      if (q.status && r.status !== q.status) return false;
      if (q.lte && r.scheduled_for && r.scheduled_for > q.lte) return false;
      return true;
    });
    return { data, error: null };
  };
  const selectChain = {
    eq: (col: string, val: string) => {
      if (col === "agency_id") q.agency_id = val;
      if (col === "channel") q.channel = val;
      if (col === "status") q.status = val;
      return selectChain;
    },
    lte: (_col: string, val: string) => {
      q.lte = val;
      return selectChain;
    },
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for fake supabase builder
    then: <T>(resolve: (v: unknown) => T) => finish().then(resolve),
  };
  const updateChain = (newValues: { status: string; sent_at: string }) => {
    const u: { agencyId?: string; ids?: string[] } = {};
    const updFinish = async () => {
      if (state.updateError) return { error: state.updateError };
      const ids = u.ids ?? [];
      state.updates.push({ ids, status: newValues.status, sent_at: newValues.sent_at });
      for (const r of state.queued) {
        if (ids.includes(r.id)) r.status = "sent";
      }
      return { error: null };
    };
    const upd = {
      eq: (col: string, val: string) => {
        if (col === "agency_id") u.agencyId = val;
        return upd;
      },
      in: (_col: string, vals: string[]) => {
        u.ids = vals;
        return upd;
      },
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable for fake supabase builder
      then: <T>(resolve: (v: unknown) => T) => updFinish().then(resolve),
    };
    return upd;
  };
  return {
    select: () => selectChain,
    update: (newValues: { status: string; sent_at: string }) => updateChain(newValues),
  };
}

function ownersBuilder() {
  return {
    select: () => ({
      eq: (_c1: string, _v1: string) => ({
        eq: (_c2: string, val: string) => ({
          maybeSingle: async () => {
            const found = state.owners.find((o) => o.id === val);
            return { data: found ?? null, error: null };
          },
        }),
      }),
    }),
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const env = {
  RESEND_API_KEY: "re_test",
  RESEND_FROM_EMAIL: "noreply@scta-test.example",
} as unknown as WorkerBindings;
const silent = createLogger({ level: "error" });

beforeEach(() => {
  reset();
  fakeClientRef.current = fakeClient();
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ id: "email-xyz" });
});

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("runOwnerDigest", () => {
  it("does nothing when no agencies are active", async () => {
    const result = await runOwnerDigest(env, silent, new Date());
    expect(result).toEqual({
      agenciesInspected: 0,
      ownersDigested: 0,
      rowsMarkedSent: 0,
      failures: 0,
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does nothing when there are no queued rows for an agency", async () => {
    state.agencies = [{ id: "a-1", name: "Sunshine Coast Test", status: "active" }];
    const result = await runOwnerDigest(env, silent, new Date());
    expect(result.ownersDigested).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("aggregates rows by owner, sends one email, marks rows sent", async () => {
    state.agencies = [{ id: "a-1", name: "Sunshine Coast Test", status: "active" }];
    state.owners = [
      { id: "o-1", full_name: "Casey Brennan", email: "casey@example.com" },
      { id: "o-2", full_name: "Pat Nguyen", email: "pat@example.com" },
    ];
    state.queued = [
      queuedRow({ id: "n-1", agency_id: "a-1", owner_id: "o-1", body: "Roof leak — Buderim" }),
      queuedRow({
        id: "n-2",
        agency_id: "a-1",
        owner_id: "o-1",
        body: "Door lock broken — Buderim",
      }),
      queuedRow({ id: "n-3", agency_id: "a-1", owner_id: "o-2", body: "Tap leak — Mooloolaba" }),
    ];

    const result = await runOwnerDigest(env, silent, new Date("2026-05-29T21:00:00Z"));
    expect(result.ownersDigested).toBe(2);
    expect(result.rowsMarkedSent).toBe(3);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);

    // Owner Casey received an email with both items in the body
    const callCasey = sendEmailMock.mock.calls.find((c) => c[0].to === "casey@example.com");
    expect(callCasey).toBeDefined();
    expect(callCasey?.[0].subject).toContain("2 items");
    expect(callCasey?.[0].text).toContain("Roof leak");
    expect(callCasey?.[0].text).toContain("Door lock broken");

    // Owner Pat received an email with one item
    const callPat = sendEmailMock.mock.calls.find((c) => c[0].to === "pat@example.com");
    expect(callPat?.[0].text).toContain("Tap leak");

    // Rows flipped to sent
    expect(state.queued.every((r) => r.status === "sent")).toBe(true);
    expect(state.updates.length).toBe(2);
  });

  it("does not include rows scheduled for the future", async () => {
    state.agencies = [{ id: "a-1", name: "X", status: "active" }];
    state.owners = [{ id: "o-1", full_name: "Owner", email: "o@example.com" }];
    state.queued = [
      queuedRow({
        id: "future",
        agency_id: "a-1",
        owner_id: "o-1",
        scheduled_for: "2026-06-01T00:00:00Z",
      }),
    ];
    const result = await runOwnerDigest(env, silent, new Date("2026-05-29T21:00:00Z"));
    expect(result.ownersDigested).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips owners with no email and counts neither a digest nor a failure", async () => {
    state.agencies = [{ id: "a-1", name: "X", status: "active" }];
    state.owners = [{ id: "o-1", full_name: "Casey", email: null }];
    state.queued = [queuedRow({ id: "n-1", agency_id: "a-1", owner_id: "o-1", body: "x" })];
    const result = await runOwnerDigest(env, silent, new Date());
    expect(result.ownersDigested).toBe(0);
    expect(result.failures).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("counts a failure but keeps going when Resend throws for one owner", async () => {
    state.agencies = [{ id: "a-1", name: "X", status: "active" }];
    state.owners = [
      { id: "o-1", full_name: "A", email: "a@x.com" },
      { id: "o-2", full_name: "B", email: "b@x.com" },
    ];
    state.queued = [
      queuedRow({ id: "n-1", agency_id: "a-1", owner_id: "o-1", body: "x" }),
      queuedRow({ id: "n-2", agency_id: "a-1", owner_id: "o-2", body: "y" }),
    ];
    sendEmailMock.mockReset();
    sendEmailMock.mockImplementationOnce(async () => {
      throw new Error("resend 500");
    });
    sendEmailMock.mockResolvedValueOnce({ id: "ok" });
    const result = await runOwnerDigest(env, silent, new Date());
    expect(result.ownersDigested).toBe(1);
    expect(result.failures).toBe(1);
  });

  it("recovers when one agency's scan errors, continues with others", async () => {
    state.agencies = [
      { id: "a-bad", name: "Bad", status: "active" },
      { id: "a-good", name: "Good", status: "active" },
    ];
    state.failScanForAgency = "a-bad";
    state.owners = [{ id: "o-1", full_name: "X", email: "x@x.com" }];
    state.queued = [queuedRow({ id: "n-1", agency_id: "a-good", owner_id: "o-1", body: "z" })];
    const result = await runOwnerDigest(env, silent, new Date());
    expect(result.failures).toBe(1);
    expect(result.ownersDigested).toBe(1);
  });

  it("re-queues for next run when the post-send update fails (logs but doesn't crash)", async () => {
    state.agencies = [{ id: "a-1", name: "X", status: "active" }];
    state.owners = [{ id: "o-1", full_name: "A", email: "a@x.com" }];
    state.queued = [queuedRow({ id: "n-1", agency_id: "a-1", owner_id: "o-1", body: "x" })];
    state.updateError = { message: "update failed" };
    const result = await runOwnerDigest(env, silent, new Date());
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(result.failures).toBe(1);
    expect(result.ownersDigested).toBe(0); // we don't count this as digested because update failed
    expect(result.rowsMarkedSent).toBe(0);
  });
});

function queuedRow(o: Partial<QueuedRow>): QueuedRow {
  return {
    id: o.id ?? `row-${Math.random()}`,
    agency_id: o.agency_id ?? "a-1",
    owner_id: o.owner_id ?? "o-1",
    property_id: o.property_id ?? null,
    body: o.body ?? "(body)",
    triggered_by_draft_id: o.triggered_by_draft_id ?? null,
    scheduled_for: o.scheduled_for ?? "2026-05-28T00:00:00Z",
    channel: "digest",
    status: o.status ?? "queued",
  };
}
