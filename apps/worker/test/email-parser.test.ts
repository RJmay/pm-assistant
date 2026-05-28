import { describe, expect, it } from "vitest";
import {
  decodeBase64Url,
  parseAddress,
  parseAddressList,
  parseGmailMessage,
} from "../src/services/email-parser";
import type { GmailMessage } from "../src/services/gmail";

function gmailBase64Url(input: string): string {
  // Replicate Gmail's URL-safe base64 (no padding) used in payload bodies.
  // btoa() requires a Latin-1 string, so we first encode the input as UTF-8
  // bytes and then map each byte to its char code.
  const bytes = new TextEncoder().encode(input);
  let latin1 = "";
  for (const b of bytes) latin1 += String.fromCharCode(b);
  return btoa(latin1).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("parseAddress", () => {
  it("parses a bare email address", () => {
    expect(parseAddress("alex@example.com")).toEqual({ address: "alex@example.com" });
  });

  it("parses an angle-bracket form with display name", () => {
    expect(parseAddress("Alex Tan <alex@example.com>")).toEqual({
      name: "Alex Tan",
      address: "alex@example.com",
    });
  });

  it("strips surrounding quotes from the display name", () => {
    expect(parseAddress('"Alex, Tan" <alex@example.com>')).toEqual({
      name: "Alex, Tan",
      address: "alex@example.com",
    });
  });

  it("returns just the address when display name is empty", () => {
    expect(parseAddress("<alex@example.com>")).toEqual({ address: "alex@example.com" });
  });
});

describe("parseAddressList", () => {
  it("returns an empty array for empty input", () => {
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList("   ")).toEqual([]);
  });

  it("parses a single address", () => {
    expect(parseAddressList("alex@example.com")).toEqual(["alex@example.com"]);
  });

  it("parses multiple comma-separated addresses", () => {
    expect(parseAddressList("a@x.com, b@y.com, c@z.com")).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
  });

  it("preserves commas inside quoted display names", () => {
    expect(parseAddressList('"Tan, Alex" <alex@x.com>, ben@y.com')).toEqual([
      "alex@x.com",
      "ben@y.com",
    ]);
  });
});

describe("decodeBase64Url", () => {
  it("decodes Gmail's URL-safe base64 without padding", () => {
    expect(decodeBase64Url(gmailBase64Url("hello world"))).toBe("hello world");
  });

  it("decodes UTF-8 multibyte characters", () => {
    expect(decodeBase64Url(gmailBase64Url("café — résumé"))).toBe("café — résumé");
  });
});

describe("parseGmailMessage", () => {
  function baseHeaders() {
    return [
      { name: "From", value: "Alice <alice@example.com>" },
      { name: "To", value: "agency@example.com, helper@example.com" },
      { name: "Cc", value: "boss@example.com" },
      { name: "Subject", value: "Tap is leaking" },
      { name: "Message-ID", value: "<abc123@mail.example>" },
      { name: "In-Reply-To", value: "<prev@mail.example>" },
      { name: "References", value: "<a@x> <b@x>" },
    ];
  }

  it("extracts headers and a single text/plain body", () => {
    const msg: GmailMessage = {
      id: "m1",
      threadId: "t1",
      internalDate: String(Date.parse("2026-05-28T09:00:00Z")),
      payload: {
        mimeType: "text/plain",
        headers: baseHeaders(),
        body: { data: gmailBase64Url("Please fix the tap"), size: 18 },
      },
    };

    const parsed = parseGmailMessage(msg);
    expect(parsed.from).toBe("alice@example.com");
    expect(parsed.fromName).toBe("Alice");
    expect(parsed.to).toEqual(["agency@example.com", "helper@example.com"]);
    expect(parsed.cc).toEqual(["boss@example.com"]);
    expect(parsed.bcc).toEqual([]);
    expect(parsed.subject).toBe("Tap is leaking");
    expect(parsed.messageIdHeader).toBe("<abc123@mail.example>");
    expect(parsed.inReplyTo).toBe("<prev@mail.example>");
    expect(parsed.references).toEqual(["<a@x>", "<b@x>"]);
    expect(parsed.bodyPlain).toBe("Please fix the tap");
    expect(parsed.bodyHtml).toBeNull();
    expect(parsed.attachments).toEqual([]);
    expect(parsed.receivedAt.toISOString()).toBe("2026-05-28T09:00:00.000Z");
  });

  it("walks a multipart/alternative tree and picks both plain and html bodies", () => {
    const msg: GmailMessage = {
      id: "m2",
      threadId: "t2",
      internalDate: String(Date.parse("2026-05-28T10:00:00Z")),
      payload: {
        mimeType: "multipart/alternative",
        headers: baseHeaders(),
        parts: [
          {
            mimeType: "text/plain",
            body: { data: gmailBase64Url("Plain body"), size: 10 },
          },
          {
            mimeType: "text/html",
            body: { data: gmailBase64Url("<p>HTML body</p>"), size: 16 },
          },
        ],
      },
    };

    const parsed = parseGmailMessage(msg);
    expect(parsed.bodyPlain).toBe("Plain body");
    expect(parsed.bodyHtml).toBe("<p>HTML body</p>");
  });

  it("collects attachments without consuming their body as a text part", () => {
    const msg: GmailMessage = {
      id: "m3",
      threadId: "t3",
      internalDate: String(Date.parse("2026-05-28T10:00:00Z")),
      payload: {
        mimeType: "multipart/mixed",
        headers: baseHeaders(),
        parts: [
          {
            mimeType: "text/plain",
            body: { data: gmailBase64Url("body text"), size: 9 },
          },
          {
            mimeType: "application/pdf",
            filename: "report.pdf",
            body: { size: 1234 },
          },
        ],
      },
    };

    const parsed = parseGmailMessage(msg);
    expect(parsed.bodyPlain).toBe("body text");
    expect(parsed.attachments).toEqual([
      { filename: "report.pdf", mimeType: "application/pdf", size: 1234 },
    ]);
  });

  it("throws when the From header is missing", () => {
    const msg = {
      id: "m4",
      threadId: "t4",
      internalDate: "1700000000000",
      payload: {
        headers: [{ name: "Subject", value: "x" }],
      },
    } as unknown as GmailMessage;
    expect(() => parseGmailMessage(msg)).toThrow(/missing From/i);
  });

  it("throws when internalDate is not numeric", () => {
    const msg = {
      id: "m5",
      threadId: "t5",
      internalDate: "not-a-number",
      payload: { headers: [{ name: "From", value: "a@b.com" }] },
    } as unknown as GmailMessage;
    expect(() => parseGmailMessage(msg)).toThrow(/invalid internalDate/i);
  });
});
