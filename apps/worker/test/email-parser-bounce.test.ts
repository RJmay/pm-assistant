import { describe, expect, it } from "vitest";
import { parseGmailMessage } from "../src/services/email-parser";
import type { GmailMessage } from "../src/services/gmail";

const b64 = (s: string) => btoa(s);

function dsnMessage(): GmailMessage {
  return {
    id: "bounce-1",
    threadId: "thread-dsn",
    internalDate: String(Date.parse("2026-05-29T01:00:00Z")),
    payload: {
      mimeType: "multipart/report",
      headers: [
        { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
        { name: "To", value: "rentals@agency.com.au" },
        { name: "Subject", value: "Delivery Status Notification (Failure)" },
        {
          name: "Content-Type",
          value: 'multipart/report; report-type=delivery-status; boundary="b"',
        },
        { name: "Message-ID", value: "<dsn-own@mail.gmail.com>" },
      ],
      parts: [
        { mimeType: "text/plain", body: { data: b64("Address not found."), size: 18 } },
        {
          mimeType: "message/delivery-status",
          body: {
            data: b64("Final-Recipient: rfc822; tenant@example.com\nAction: failed\n"),
            size: 50,
          },
        },
        {
          mimeType: "message/rfc822",
          parts: [
            {
              mimeType: "text/rfc822-headers",
              headers: [{ name: "Message-ID", value: "<sent-original@agency.com.au>" }],
              body: { data: b64("Message-ID: <sent-original@agency.com.au>\n"), size: 40 },
            },
          ],
        },
      ],
    },
  };
}

describe("parseGmailMessage — bounce detection", () => {
  it("flags a multipart/report DSN and recovers the failed Message-ID", () => {
    const parsed = parseGmailMessage(dsnMessage());
    expect(parsed.isBounce).toBe(true);
    expect(parsed.failedMessageId).toBe("<sent-original@agency.com.au>");
    // the human-readable part is still the body, not the original
    expect(parsed.bodyPlain).toContain("Address not found.");
  });

  it("flags a mailer-daemon sender even without a report content-type", () => {
    const msg: GmailMessage = {
      id: "b2",
      threadId: "t",
      internalDate: "1700000000000",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "mailer-daemon@googlemail.com" },
          { name: "Subject", value: "failure notice" },
        ],
        body: { data: b64("could not be delivered"), size: 10 },
      },
    };
    expect(parseGmailMessage(msg).isBounce).toBe(true);
  });

  it("does not flag an ordinary inbound email", () => {
    const msg: GmailMessage = {
      id: "n1",
      threadId: "t",
      internalDate: "1700000000000",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "Alice <alice@example.com>" },
          { name: "Subject", value: "Repair request" },
          { name: "In-Reply-To", value: "<prev@mail.example.com>" },
        ],
        body: { data: b64("the tap is leaking"), size: 10 },
      },
    };
    const parsed = parseGmailMessage(msg);
    expect(parsed.isBounce).toBe(false);
    // failedMessageId is only populated for bounces, never from normal threading
    expect(parsed.failedMessageId).toBeNull();
  });
});
