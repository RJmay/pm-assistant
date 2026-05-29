// ============================================================================
// RFC 5322 message builder for Gmail users.messages.send (M9 send path)
// ============================================================================
// Produces the base64url-encoded `raw` payload Gmail expects, with the headers
// that keep a reply attached to its thread (In-Reply-To + References) and a
// Message-ID we control (so a later bounce/DSN can be matched back to the
// sent message). Header values are sanitised against CRLF injection.
//
// Body is emitted as UTF-8 with Content-Transfer-Encoding: 8bit; the whole
// message is then byte-encoded to base64url, so non-ASCII content survives.
// ============================================================================

export interface BuildRawMessageInput {
  fromAddress: string;
  fromDisplayName?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  /** RFC Message-ID of the message being replied to (for In-Reply-To). */
  inReplyTo?: string | null;
  /** Accumulated References chain (already includes the parent message id). */
  references?: string[];
  /** Our generated Message-ID, including angle brackets. */
  messageId: string;
  date: Date;
}

export interface BuiltMessage {
  /** base64url of the full RFC 5322 message, for Gmail's `raw` field. */
  raw: string;
  /** echoed back so callers persist exactly what was sent */
  messageId: string;
}

/** Strip CR/LF so a header value can't inject extra headers. */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Quote a display name if it contains RFC 5322 specials. */
function formatDisplayName(name: string): string {
  const clean = sanitizeHeaderValue(name);
  if (/[(),:;<>@[\]"]/.test(clean)) {
    return `"${clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return clean;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildRawMessage(input: BuildRawMessageInput): BuiltMessage {
  const cleanFromAddress = sanitizeHeaderValue(input.fromAddress);
  const from = input.fromDisplayName
    ? `${formatDisplayName(input.fromDisplayName)} <${cleanFromAddress}>`
    : cleanFromAddress;

  const to = input.to.map(sanitizeHeaderValue).filter((a) => a.length > 0);
  if (to.length === 0) throw new Error("buildRawMessage: at least one recipient is required");
  const cc = (input.cc ?? []).map(sanitizeHeaderValue).filter((a) => a.length > 0);

  const headers: string[] = [`From: ${from}`, `To: ${to.join(", ")}`];
  if (cc.length > 0) headers.push(`Cc: ${cc.join(", ")}`);
  headers.push(`Subject: ${sanitizeHeaderValue(input.subject)}`);
  headers.push(`Date: ${input.date.toUTCString()}`);
  headers.push(`Message-ID: ${sanitizeHeaderValue(input.messageId)}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${sanitizeHeaderValue(input.inReplyTo)}`);
  const references = (input.references ?? []).map(sanitizeHeaderValue).filter((r) => r.length > 0);
  if (references.length > 0) headers.push(`References: ${references.join(" ")}`);
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: 8bit");

  const normalisedBody = input.bodyText.replace(/\r?\n/g, "\r\n");
  const message = `${headers.join("\r\n")}\r\n\r\n${normalisedBody}`;
  const bytes = new TextEncoder().encode(message);

  return { raw: encodeBase64Url(bytes), messageId: input.messageId };
}
