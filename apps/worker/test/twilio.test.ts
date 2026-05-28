import { TwilioApiError } from "@pm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSms } from "../src/services/twilio";

const CREDS = {
  accountSid: "AC0000000000000000000000000000test",
  authToken: "auth-token-secret-test-1234567890",
};

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Typed to (url, init?) so `mock.calls[0]` is a `[url, init?]` tuple — the
// tests need to assert against headers, body, and method.
type FetchInput = string | URL | Request;
function mockFetch(response: { status: number; body: unknown } | (() => Promise<never>)) {
  const fetchMock = vi.fn(async (_url: FetchInput, _init?: RequestInit) => {
    if (typeof response === "function") return response();
    return new Response(
      typeof response.body === "string" ? response.body : JSON.stringify(response.body),
      { status: response.status },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("sendSms", () => {
  it("hits the Twilio Messages endpoint with Basic auth + form-encoded body", async () => {
    const fetchMock = mockFetch({
      status: 201,
      body: { sid: "SM_test_123", status: "queued", account_sid: CREDS.accountSid },
    });

    const out = await sendSms({ to: "+61400000001", from: "+61400000000", body: "Hi" }, CREDS);
    expect(out).toEqual({ sid: "SM_test_123", status: "queued" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${CREDS.accountSid}/Messages.json`,
    );
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const authHeader = headers.Authorization;
    if (!authHeader) throw new Error("Authorization header missing");
    expect(authHeader).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
    // Decode and confirm "<sid>:<token>"
    const decoded = atob(authHeader.slice("Basic ".length));
    expect(decoded).toBe(`${CREDS.accountSid}:${CREDS.authToken}`);
    expect((init as RequestInit).body).toBe("To=%2B61400000001&From=%2B61400000000&Body=Hi");
  });

  it("throws TwilioApiError with the Twilio code + status on 4xx", async () => {
    mockFetch({
      status: 400,
      body: {
        code: 21211,
        message: "Invalid 'To' Phone Number",
        more_info: "https://www.twilio.com/docs/errors/21211",
        status: 400,
      },
    });
    await expect(
      sendSms({ to: "not-a-phone", from: "+61400000000", body: "Hi" }, CREDS),
    ).rejects.toMatchObject({
      name: "TwilioApiError",
      statusCode: 400,
      twilioErrorCode: 21211,
    });
  });

  it("throws TwilioApiError when the response body fails schema validation", async () => {
    mockFetch({ status: 201, body: { unexpected: "shape" } });
    await expect(
      sendSms({ to: "+61400000001", from: "+61400000000", body: "Hi" }, CREDS),
    ).rejects.toBeInstanceOf(TwilioApiError);
  });

  it("wraps fetch network failures in TwilioApiError", async () => {
    mockFetch(async () => {
      throw new TypeError("network down");
    });
    await expect(
      sendSms({ to: "+61400000001", from: "+61400000000", body: "Hi" }, CREDS),
    ).rejects.toMatchObject({ name: "TwilioApiError", statusCode: 0 });
  });
});
