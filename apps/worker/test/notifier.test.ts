import type { Client } from "@pm/db";
import { ResendApiError, TwilioApiError } from "@pm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerBindings } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import {
  dispatchOwnerNotification,
  isBusinessHours,
  type NotificationProfile,
  type NotifyInput,
  nextOwnerDigestFire,
} from "../src/services/notifier";

// ----------------------------------------------------------------------------
// Fake Supabase — only the methods notifier uses
// ----------------------------------------------------------------------------

interface PropertyRow {
  id: string;
  owner_id: string | null;
  address_line1: string;
  suburb: string | null;
}
interface OwnerRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
}
interface PrefRow {
  owner_id: string | null;
  property_id: string | null;
  profile: NotificationProfile;
}

interface MockState {
  property: PropertyRow | null;
  owner: OwnerRow | null;
  propertyPref: PrefRow | null;
  ownerPref: PrefRow | null;
  agencyName: string;
  logInserts: Array<Record<string, unknown>>;
}

let state: MockState;

function reset() {
  state = {
    property: {
      id: "prop-1",
      owner_id: "owner-1",
      address_line1: "12 Beach Parade",
      suburb: "Mooloolaba",
    },
    owner: {
      id: "owner-1",
      full_name: "Casey Brennan",
      email: "casey@example.com",
      phone: "+61400111222",
    },
    propertyPref: null,
    ownerPref: null,
    agencyName: "Sunshine Coast Test Agency",
    logInserts: [],
  };
}

function fakeClient(): Client {
  return {
    from(table: string) {
      if (table === "properties") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: state.property, error: null }) }),
            }),
          }),
        };
      }
      if (table === "owners") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: state.owner, error: null }) }),
            }),
          }),
        };
      }
      if (table === "owner_notification_preferences") {
        return {
          select: () => ({
            eq: (_c1: string, _v1: string) => ({
              eq: (col: string, _val: string) => {
                if (col === "property_id") {
                  return { maybeSingle: async () => ({ data: state.propertyPref, error: null }) };
                }
                // owner_id branch — must also include .is("property_id", null)
                return {
                  is: () => ({
                    maybeSingle: async () => ({ data: state.ownerPref, error: null }),
                  }),
                };
              },
            }),
          }),
        };
      }
      if (table === "agencies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { name: state.agencyName }, error: null }),
            }),
          }),
        };
      }
      if (table === "notification_log") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.logInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table} in notifier fake`);
    },
    // biome-ignore lint/suspicious/noExplicitAny: only the surface we touch is mocked
  } as any;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const env = {
  TWILIO_ACCOUNT_SID: "AC0000000000000000000000000000test",
  TWILIO_AUTH_TOKEN: "00000000000000000000000000000test",
  TWILIO_FROM_NUMBER: "+61400000000",
  RESEND_API_KEY: "re_0000000000000000000000000000test",
  RESEND_FROM_EMAIL: "noreply@scta-test.example",
} as unknown as WorkerBindings;

const silent = createLogger({ level: "error" });

function baseInput(overrides: Partial<NotifyInput> = {}): NotifyInput {
  return {
    draftId: "draft-1",
    agencyId: "agency-aaa",
    propertyId: "prop-1",
    ownerId: null,
    safetyCritical: true,
    draftSummary: {
      category: "MAINTENANCE",
      issueLine: "Water through ceiling, mains off",
    },
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<{
    sms: ReturnType<typeof vi.fn>;
    email: ReturnType<typeof vi.fn>;
    now: () => Date;
  }> = {},
) {
  const smsMock = overrides.sms ?? vi.fn(async () => ({ sid: "SM_test", status: "queued" }));
  const emailMock = overrides.email ?? vi.fn(async () => ({ id: "email_test" }));
  return {
    env,
    logger: silent,
    now: overrides.now ?? (() => new Date("2026-05-28T03:00:00Z")), // = 13:00 AEST, business hours
    // biome-ignore lint/suspicious/noExplicitAny: mock cast
    sms: smsMock as any,
    // biome-ignore lint/suspicious/noExplicitAny: mock cast
    email: emailMock as any,
  };
}

beforeEach(reset);

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("dispatchOwnerNotification", () => {
  describe("profile: immediate (default)", () => {
    it("sends both SMS and email and logs 2 'sent' rows", async () => {
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result).toMatchObject({ dispatched: 2, queued: 0, suppressed: 0, failed: 0 });
      expect(deps.sms).toHaveBeenCalledTimes(1);
      expect(deps.email).toHaveBeenCalledTimes(1);
      expect(state.logInserts).toHaveLength(2);
      const channels = state.logInserts.map((r) => r.channel).sort();
      expect(channels).toEqual(["email", "sms"]);
      expect(state.logInserts.every((r) => r.status === "sent")).toBe(true);
      expect(state.logInserts.every((r) => r.profile_applied === "immediate")).toBe(true);
    });

    it("suppresses SMS when owner has no phone, still sends email", async () => {
      if (state.owner) state.owner.phone = null;
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result).toMatchObject({ dispatched: 1, suppressed: 1 });
      const smsRow = state.logInserts.find((r) => r.channel === "sms");
      expect(smsRow?.status).toBe("suppressed");
      expect(smsRow?.suppression_reason).toBe("owner_has_no_phone");
    });

    it("marks SMS as failed when Twilio throws", async () => {
      const deps = makeDeps({
        sms: vi.fn(async () => {
          throw new TwilioApiError("Twilio 401: unauthorized", {
            statusCode: 401,
            endpoint: "x",
          });
        }),
      });
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result.dispatched).toBe(1); // email still sent
      expect(result.failed).toBe(1);
      const smsRow = state.logInserts.find((r) => r.channel === "sms");
      expect(smsRow?.status).toBe("failed");
    });
  });

  describe("profile: business_hours", () => {
    beforeEach(() => {
      state.propertyPref = { owner_id: null, property_id: "prop-1", profile: "business_hours" };
    });

    it("dispatches in-hours (Wed 13:00 AEST)", async () => {
      const deps = makeDeps({ now: () => new Date("2026-05-27T03:00:00Z") }); // Wed 13:00 AEST
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result.dispatched).toBe(2);
      expect(result.queued).toBe(0);
    });

    it("queues out-of-hours (Sun 23:00 AEST)", async () => {
      const deps = makeDeps({ now: () => new Date("2026-05-31T13:00:00Z") }); // Sun 23:00 AEST
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result.dispatched).toBe(0);
      expect(result.queued).toBe(1);
      const row = state.logInserts[0];
      expect(row?.channel).toBe("digest");
      expect(row?.status).toBe("queued");
      expect(row?.suppression_reason).toBe("business_hours_outside_window");
    });

    it("queues on weekends regardless of time-of-day", async () => {
      const deps = makeDeps({ now: () => new Date("2026-05-30T03:00:00Z") }); // Sat 13:00 AEST
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result.queued).toBe(1);
    });
  });

  describe("profile: safety_critical_only", () => {
    beforeEach(() => {
      state.propertyPref = {
        owner_id: null,
        property_id: "prop-1",
        profile: "safety_critical_only",
      };
    });

    it("dispatches when safetyCritical is true", async () => {
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(
        fakeClient(),
        baseInput({ safetyCritical: true }),
        deps,
      );
      expect(result.dispatched).toBe(2);
      expect(result.suppressed).toBe(0);
    });

    it("suppresses + queues to digest when safetyCritical is false", async () => {
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(
        fakeClient(),
        baseInput({ safetyCritical: false }),
        deps,
      );
      expect(result.dispatched).toBe(0);
      expect(result.suppressed).toBe(2); // sms + email both suppressed
      expect(result.queued).toBe(1);
      const suppRows = state.logInserts.filter((r) => r.status === "suppressed");
      expect(suppRows).toHaveLength(2);
      expect(
        suppRows.every((r) => r.suppression_reason === "non_safety_critical_under_profile"),
      ).toBe(true);
    });
  });

  describe("profile: email_only", () => {
    beforeEach(() => {
      state.propertyPref = { owner_id: null, property_id: "prop-1", profile: "email_only" };
    });

    it("sends email only, no SMS attempted", async () => {
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result.dispatched).toBe(1);
      expect(deps.sms).not.toHaveBeenCalled();
      expect(deps.email).toHaveBeenCalledTimes(1);
      expect(state.logInserts).toHaveLength(1);
      expect(state.logInserts[0]?.channel).toBe("email");
    });

    it("logs failed when Resend throws", async () => {
      const deps = makeDeps({
        email: vi.fn(async () => {
          throw new ResendApiError("Resend 422", { statusCode: 422, endpoint: "x" });
        }),
      });
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result.failed).toBe(1);
    });
  });

  describe("profile: pm_proxy", () => {
    it("queues only, no live dispatch", async () => {
      state.propertyPref = { owner_id: null, property_id: "prop-1", profile: "pm_proxy" };
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result.dispatched).toBe(0);
      expect(result.queued).toBe(1);
      expect(deps.sms).not.toHaveBeenCalled();
      expect(deps.email).not.toHaveBeenCalled();
      expect(state.logInserts[0]?.suppression_reason).toBe("pm_proxy_profile");
    });
  });

  describe("preference resolution", () => {
    it("prefers a property-level preference over an owner-level one", async () => {
      state.propertyPref = { owner_id: null, property_id: "prop-1", profile: "pm_proxy" };
      state.ownerPref = { owner_id: "owner-1", property_id: null, profile: "immediate" };
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      // pm_proxy profile → queue only
      expect(result.queued).toBe(1);
      expect(result.dispatched).toBe(0);
    });

    it("falls back to owner-level preference when no property-level row exists", async () => {
      state.propertyPref = null;
      state.ownerPref = { owner_id: "owner-1", property_id: null, profile: "email_only" };
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result.dispatched).toBe(1);
      expect(deps.sms).not.toHaveBeenCalled();
    });

    it("defaults to immediate when no preferences exist", async () => {
      state.propertyPref = null;
      state.ownerPref = null;
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(fakeClient(), baseInput(), deps);
      expect(result.dispatched).toBe(2);
    });
  });

  describe("no owner resolved", () => {
    it("aborts with reason=no_owner_resolved when property has no owner", async () => {
      if (state.property) state.property.owner_id = null;
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(
        fakeClient(),
        baseInput({ ownerId: null }),
        deps,
      );
      expect(result.abortReason).toBe("no_owner_resolved");
      expect(state.logInserts).toHaveLength(0);
      expect(deps.sms).not.toHaveBeenCalled();
    });

    it("uses input.ownerId as fallback when matcher set it but propertyId is null", async () => {
      const deps = makeDeps();
      const result = await dispatchOwnerNotification(
        fakeClient(),
        baseInput({ propertyId: null, ownerId: "owner-1" }),
        deps,
      );
      expect(result.dispatched).toBe(2);
    });
  });
});

describe("isBusinessHours (QLD AEST Mon-Fri 09:00-17:00)", () => {
  it("Mon 09:00 AEST → true", () => {
    expect(isBusinessHours(new Date("2026-05-24T23:00:00Z"))).toBe(true); // Mon 09:00 AEST
  });
  it("Fri 16:59 AEST → true", () => {
    expect(isBusinessHours(new Date("2026-05-29T06:59:00Z"))).toBe(true);
  });
  it("Fri 17:00 AEST → false", () => {
    expect(isBusinessHours(new Date("2026-05-29T07:00:00Z"))).toBe(false);
  });
  it("Sat 13:00 AEST → false", () => {
    expect(isBusinessHours(new Date("2026-05-30T03:00:00Z"))).toBe(false);
  });
  it("Sun 13:00 AEST → false", () => {
    expect(isBusinessHours(new Date("2026-05-31T03:00:00Z"))).toBe(false);
  });
  it("Mon 08:59 AEST → false", () => {
    expect(isBusinessHours(new Date("2026-05-24T22:59:00Z"))).toBe(false);
  });
});

describe("nextOwnerDigestFire (07:00 AEST daily)", () => {
  it("returns today's 07:00 AEST when called before 07:00 AEST", () => {
    // 06:00 AEST Wed = 20:00 UTC Tue
    const now = new Date("2026-05-26T20:00:00Z");
    const target = nextOwnerDigestFire(now);
    // 07:00 AEST Wed = 21:00 UTC Tue
    expect(target.toISOString()).toBe("2026-05-26T21:00:00.000Z");
  });
  it("returns tomorrow's 07:00 AEST when called after 07:00 AEST", () => {
    // 08:00 AEST Wed = 22:00 UTC Tue
    const now = new Date("2026-05-26T22:00:00Z");
    const target = nextOwnerDigestFire(now);
    // 07:00 AEST Thu = 21:00 UTC Wed
    expect(target.toISOString()).toBe("2026-05-27T21:00:00.000Z");
  });
});
