import { ResendApiError } from "@pm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "../src/services/resend";

const CREDS = { apiKey: "re_0000000000000000000000000000test" };

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(response: { status: number; body: unknown } | (() => Promise<never>)) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (typeof response === "function") return response();
    return new Response(
      typeof response.body === "string" ? response.body : JSON.stringify(response.body),
      { status: response.status },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("sendEmail", () => {
  it("posts to the Resend endpoint with Bearer auth + JSON body", async () => {
    const fetchMock = mockFetch({ status: 200, body: { id: "email-id-123" } });

    const out = await sendEmail(
      {
        from: "PM <noreply@scta-test.example>",
        to: "owner@example.com",
        subject: "URGENT",
        html: "<p>Property issue.</p>",
        text: "Property issue.",
      },
      CREDS,
    );
    expect(out).toEqual({ id: "email-id-123" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${CREDS.apiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      from: "PM <noreply@scta-test.example>",
      to: "owner@example.com",
      subject: "URGENT",
      html: "<p>Property issue.</p>",
      text: "Property issue.",
    });
  });

  it("throws ResendApiError with the resend error name on 4xx", async () => {
    mockFetch({
      status: 422,
      body: { name: "validation_error", message: "from is required", statusCode: 422 },
    });
    await expect(
      sendEmail({ from: "", to: "x@y.com", subject: "s", text: "t" }, CREDS),
    ).rejects.toMatchObject({
      name: "ResendApiError",
      statusCode: 422,
      resendErrorName: "validation_error",
    });
  });

  it("rejects when neither html nor text is supplied", async () => {
    await expect(
      sendEmail({ from: "a@b.com", to: "c@d.com", subject: "s" }, CREDS),
    ).rejects.toBeInstanceOf(ResendApiError);
  });

  it("throws ResendApiError when the response body fails schema validation", async () => {
    mockFetch({ status: 200, body: { unexpected: "shape" } });
    await expect(
      sendEmail({ from: "a@b.com", to: "c@d.com", subject: "s", text: "t" }, CREDS),
    ).rejects.toBeInstanceOf(ResendApiError);
  });

  it("wraps fetch network failures in ResendApiError", async () => {
    mockFetch(async () => {
      throw new TypeError("network down");
    });
    await expect(
      sendEmail({ from: "a@b.com", to: "c@d.com", subject: "s", text: "t" }, CREDS),
    ).rejects.toMatchObject({ name: "ResendApiError", statusCode: 0 });
  });

  it("accepts an array of recipients", async () => {
    const fetchMock = mockFetch({ status: 200, body: { id: "email-id-456" } });
    await sendEmail(
      {
        from: "a@b.com",
        to: ["x@y.com", "z@y.com"],
        subject: "s",
        text: "t",
      },
      CREDS,
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["x@y.com", "z@y.com"]);
  });
});
