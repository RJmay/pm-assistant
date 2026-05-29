import { describe, expect, it } from "vitest";
import { buildRawMessage } from "../src/services/mime";

function decodeRaw(raw: string): string {
  const standard = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

const DATE = new Date("2026-05-29T03:00:00.000Z");

describe("buildRawMessage", () => {
  it("sets threading headers and a controlled Message-ID", () => {
    const { raw, messageId } = buildRawMessage({
      fromAddress: "rentals@agency.com.au",
      fromDisplayName: "Jess Bowman — Sunshine Coast Rentals",
      to: ["tenant@example.com"],
      subject: "Re: leaking tap",
      bodyText: "Hi there,\n\nThanks for letting us know.",
      inReplyTo: "<inbound-123@mail.example.com>",
      references: ["<thread-root@mail.example.com>", "<inbound-123@mail.example.com>"],
      messageId: "<generated-1@agency.com.au>",
      date: DATE,
    });
    const msg = decodeRaw(raw);
    expect(messageId).toBe("<generated-1@agency.com.au>");
    expect(msg).toContain("To: tenant@example.com");
    expect(msg).toContain("In-Reply-To: <inbound-123@mail.example.com>");
    expect(msg).toContain(
      "References: <thread-root@mail.example.com> <inbound-123@mail.example.com>",
    );
    expect(msg).toContain("Message-ID: <generated-1@agency.com.au>");
    expect(msg).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(msg).toContain("Thanks for letting us know.");
  });

  it("quotes a display name containing specials and keeps the address", () => {
    const { raw } = buildRawMessage({
      fromAddress: "rentals@agency.com.au",
      fromDisplayName: "Bowman, Jess (PM)",
      to: ["t@example.com"],
      subject: "Hi",
      bodyText: "x",
      messageId: "<m@a>",
      date: DATE,
    });
    expect(decodeRaw(raw)).toContain('From: "Bowman, Jess (PM)" <rentals@agency.com.au>');
  });

  it("strips CRLF from header values to prevent header injection", () => {
    const { raw } = buildRawMessage({
      fromAddress: "rentals@agency.com.au",
      to: ["t@example.com"],
      subject: "Subject\r\nBcc: victim@example.com",
      bodyText: "body",
      messageId: "<m@a>",
      date: DATE,
    });
    const msg = decodeRaw(raw);
    expect(msg).not.toMatch(/\r\nBcc: victim/);
    expect(msg).toContain("Subject: Subject Bcc: victim@example.com");
  });

  it("preserves UTF-8 body bytes through base64url", () => {
    const { raw } = buildRawMessage({
      fromAddress: "a@b.com",
      to: ["t@example.com"],
      subject: "x",
      bodyText: "Café — naïve façade 🏠",
      messageId: "<m@a>",
      date: DATE,
    });
    expect(decodeRaw(raw)).toContain("Café — naïve façade 🏠");
  });

  it("throws when there is no recipient", () => {
    expect(() =>
      buildRawMessage({
        fromAddress: "a@b.com",
        to: [],
        subject: "x",
        bodyText: "y",
        messageId: "<m@a>",
        date: DATE,
      }),
    ).toThrow();
  });
});
