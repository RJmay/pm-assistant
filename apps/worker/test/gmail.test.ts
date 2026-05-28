import { GmailApiError } from "@pm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeCode,
  refreshAccessToken,
  usersGetProfile,
  usersHistoryList,
  usersMessagesGet,
  usersWatch,
} from "../src/services/gmail";

function mockFetch(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  return vi.fn((input, init) => {
    const req =
      input instanceof Request
        ? input
        : new Request(typeof input === "string" ? input : (input as URL).toString(), init);
    return Promise.resolve(handler(req));
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TOKEN_OK = {
  access_token: "ya29.access-token",
  refresh_token: "1//refresh-token",
  expires_in: 3599,
  scope: "https://www.googleapis.com/auth/gmail.modify",
  token_type: "Bearer",
};

describe("exchangeCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs form-encoded params to oauth2.googleapis.com and parses the token response", async () => {
    let capturedBody: string | null = null;
    let capturedUrl: string | null = null;
    const fetchImpl = mockFetch(async (req) => {
      capturedUrl = req.url;
      capturedBody = await req.text();
      return jsonResponse(TOKEN_OK);
    });

    const result = await exchangeCode({
      code: "auth-code-123",
      redirectUri: "https://app.example/oauth/gmail/callback/",
      clientId: "cid",
      clientSecret: "csecret",
      fetchImpl,
    });

    expect(result.access_token).toBe("ya29.access-token");
    expect(result.refresh_token).toBe("1//refresh-token");
    expect(capturedUrl).toBe("https://oauth2.googleapis.com/token");
    expect(capturedBody).toContain("code=auth-code-123");
    expect(capturedBody).toContain("grant_type=authorization_code");
    expect(capturedBody).toContain("client_id=cid");
  });

  it("throws GmailApiError on a non-2xx response", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ error: "invalid_grant", error_description: "bad code" }, 400),
    );
    await expect(
      exchangeCode({
        code: "bad",
        redirectUri: "x",
        clientId: "cid",
        clientSecret: "csecret",
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(GmailApiError);
  });

  it("throws GmailApiError when the response body fails schema validation", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ wat: "no token here" }));
    await expect(
      exchangeCode({
        code: "x",
        redirectUri: "x",
        clientId: "cid",
        clientSecret: "csecret",
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(GmailApiError);
  });
});

describe("refreshAccessToken", () => {
  it("POSTs form-encoded params with grant_type=refresh_token", async () => {
    let capturedBody: string | null = null;
    const fetchImpl = mockFetch(async (req) => {
      capturedBody = await req.text();
      return jsonResponse(TOKEN_OK);
    });
    await refreshAccessToken({
      refreshToken: "rt",
      clientId: "cid",
      clientSecret: "csecret",
      fetchImpl,
    });
    expect(capturedBody).toContain("grant_type=refresh_token");
    expect(capturedBody).toContain("refresh_token=rt");
  });
});

describe("usersGetProfile", () => {
  it("hits /users/{mailbox}/profile with a Bearer token", async () => {
    let capturedUrl: string | null = null;
    let capturedAuth: string | null = null;
    const fetchImpl = mockFetch((req) => {
      capturedUrl = req.url;
      capturedAuth = req.headers.get("Authorization");
      return jsonResponse({
        emailAddress: "x@y.com",
        historyId: "100",
        messagesTotal: 5,
      });
    });

    const profile = await usersGetProfile("me", { accessToken: "at", fetchImpl });
    expect(profile.emailAddress).toBe("x@y.com");
    expect(profile.historyId).toBe("100");
    expect(capturedUrl).toBe("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    expect(capturedAuth).toBe("Bearer at");
  });
});

describe("usersHistoryList", () => {
  it("encodes startHistoryId and (repeated) historyTypes in the query string", async () => {
    let capturedUrl: URL | null = null;
    const fetchImpl = mockFetch((req) => {
      capturedUrl = new URL(req.url);
      return jsonResponse({ historyId: "200" });
    });
    await usersHistoryList({
      accessToken: "at",
      mailbox: "me",
      startHistoryId: "100",
      historyTypes: ["messageAdded"],
      fetchImpl,
    });
    const url = capturedUrl as unknown as URL;
    expect(url.searchParams.get("startHistoryId")).toBe("100");
    expect(url.searchParams.getAll("historyTypes")).toEqual(["messageAdded"]);
  });

  it("includes pageToken when provided", async () => {
    let capturedUrl: URL | null = null;
    const fetchImpl = mockFetch((req) => {
      capturedUrl = new URL(req.url);
      return jsonResponse({ historyId: "200" });
    });
    await usersHistoryList({
      accessToken: "at",
      mailbox: "me",
      startHistoryId: "100",
      pageToken: "next-page",
      fetchImpl,
    });
    expect((capturedUrl as unknown as URL).searchParams.get("pageToken")).toBe("next-page");
  });
});

describe("usersMessagesGet", () => {
  it("requests format=full by default and returns a parsed GmailMessage", async () => {
    let capturedUrl: URL | null = null;
    const fetchImpl = mockFetch((req) => {
      capturedUrl = new URL(req.url);
      return jsonResponse({
        id: "msg-1",
        threadId: "th-1",
        internalDate: "1700000000000",
        payload: { mimeType: "text/plain" },
      });
    });
    const msg = await usersMessagesGet({
      accessToken: "at",
      mailbox: "me",
      messageId: "msg-1",
      fetchImpl,
    });
    expect(msg.id).toBe("msg-1");
    expect((capturedUrl as unknown as URL).searchParams.get("format")).toBe("full");
  });
});

describe("usersWatch", () => {
  it("POSTs JSON body with topicName + INBOX label filter, returns expiration", async () => {
    let capturedBody: string | null = null;
    const fetchImpl = mockFetch(async (req) => {
      capturedBody = await req.text();
      return jsonResponse({ historyId: "42", expiration: "1700000000000" });
    });

    const watch = await usersWatch({
      accessToken: "at",
      mailbox: "me",
      topicName: "projects/p/topics/t",
      fetchImpl,
    });
    expect(watch.historyId).toBe("42");
    expect(watch.expiration).toBe("1700000000000");
    const body = JSON.parse(capturedBody ?? "{}");
    expect(body).toEqual({
      topicName: "projects/p/topics/t",
      labelIds: ["INBOX"],
      labelFilterAction: "include",
    });
  });
});
