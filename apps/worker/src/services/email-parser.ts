import type { GmailMessage } from "./gmail";

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  gmailAttachmentId?: string;
}

export interface ParsedEmail {
  from: string;
  fromName?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  references: string[];
  bodyPlain: string | null;
  bodyHtml: string | null;
  receivedAt: Date;
  attachments: ParsedAttachment[];
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size: number; attachmentId?: string };
  parts?: GmailPart[];
}

/**
 * Parse a Gmail API message payload into our canonical ParsedEmail shape.
 * Pure: takes the raw message, returns extracted data. Throws only on
 * required-field absence (missing From header, missing internalDate).
 */
export function parseGmailMessage(msg: GmailMessage): ParsedEmail {
  const headers = (msg.payload.headers ?? []) as Array<{ name: string; value: string }>;

  const fromRaw = findHeader(headers, "From");
  if (!fromRaw) {
    throw new Error("Gmail message missing From header");
  }
  const { name: fromName, address: from } = parseAddress(fromRaw);

  const to = parseAddressList(findHeader(headers, "To") ?? "");
  const cc = parseAddressList(findHeader(headers, "Cc") ?? "");
  const bcc = parseAddressList(findHeader(headers, "Bcc") ?? "");

  const subject = findHeader(headers, "Subject") ?? "";
  const messageIdHeader = findHeader(headers, "Message-ID") ?? null;
  const inReplyTo = findHeader(headers, "In-Reply-To") ?? null;
  const referencesRaw = findHeader(headers, "References");
  const references = referencesRaw
    ? referencesRaw
        .split(/\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

  // internalDate is ms-since-epoch as a string; the authoritative "Gmail
  // received this" timestamp. We prefer it over the Date header (which the
  // sender controls).
  const receivedAtMs = Number.parseInt(msg.internalDate, 10);
  if (!Number.isFinite(receivedAtMs)) {
    throw new Error(`Gmail message has invalid internalDate: ${msg.internalDate}`);
  }
  const receivedAt = new Date(receivedAtMs);

  const { bodyPlain, bodyHtml, attachments } = extractBodiesAndAttachments(
    msg.payload as GmailPart,
  );

  const result: ParsedEmail = {
    from,
    to,
    cc,
    bcc,
    subject,
    messageIdHeader,
    inReplyTo,
    references,
    bodyPlain,
    bodyHtml,
    receivedAt,
    attachments,
  };
  if (fromName) {
    result.fromName = fromName;
  }
  return result;
}

// ----------------------------------------------------------------------------
// Header parsing
// ----------------------------------------------------------------------------

function findHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() === lower) return h.value;
  }
  return undefined;
}

/**
 * Parse a single RFC 2822-ish address string. Handles:
 *   - "Alex Tan" <alex@example.com>
 *   - Alex Tan <alex@example.com>
 *   - alex@example.com
 */
export function parseAddress(raw: string): { name?: string; address: string } {
  const trimmed = raw.trim();
  const angleMatch = trimmed.match(/^(.*?)<([^>]+)>\s*$/);
  if (angleMatch) {
    const namePart = angleMatch[1]?.trim() ?? "";
    const address = (angleMatch[2] ?? "").trim();
    // Strip surrounding quotes from the display name if present
    const name = namePart.replace(/^"(.*)"$/, "$1").trim();
    return name.length > 0 ? { name, address } : { address };
  }
  return { address: trimmed };
}

/**
 * Split a comma-separated address list, accounting for commas that may appear
 * inside quoted display names. Returns a list of bare email addresses.
 */
export function parseAddressList(raw: string): string[] {
  if (!raw.trim()) return [];
  const out: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = "";
  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes) {
      if (ch === "<") depth++;
      if (ch === ">") depth--;
      if (ch === "," && depth === 0) {
        if (current.trim()) out.push(parseAddress(current).address);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) out.push(parseAddress(current).address);
  return out;
}

// ----------------------------------------------------------------------------
// Body + attachment extraction (walks the MIME tree)
// ----------------------------------------------------------------------------

interface ExtractResult {
  bodyPlain: string | null;
  bodyHtml: string | null;
  attachments: ParsedAttachment[];
}

function extractBodiesAndAttachments(part: GmailPart): ExtractResult {
  const result: ExtractResult = { bodyPlain: null, bodyHtml: null, attachments: [] };
  walk(part, result);
  return result;
}

function walk(part: GmailPart, acc: ExtractResult): void {
  const mime = (part.mimeType ?? "").toLowerCase();

  // An attachment has a filename. Record + don't descend further into its body.
  if (part.filename && part.filename.length > 0) {
    acc.attachments.push({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body?.size ?? 0,
      ...(part.body?.attachmentId ? { gmailAttachmentId: part.body.attachmentId } : {}),
    });
    return;
  }

  if (mime === "text/plain" && part.body?.data && acc.bodyPlain == null) {
    acc.bodyPlain = decodeBase64Url(part.body.data);
  } else if (mime === "text/html" && part.body?.data && acc.bodyHtml == null) {
    acc.bodyHtml = decodeBase64Url(part.body.data);
  }

  if (part.parts && part.parts.length > 0) {
    for (const child of part.parts) walk(child, acc);
  }
}

/**
 * Decode Gmail's base64url-encoded body data into a UTF-8 string.
 * Gmail uses "URL-safe" base64 (`-`/`_` instead of `+`/`/`) without padding.
 */
export function decodeBase64Url(input: string): string {
  // Convert URL-safe alphabet back to standard base64
  const standard = input.replace(/-/g, "+").replace(/_/g, "/");
  // Re-pad to a multiple of 4
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  // atob → binary string → UTF-8 via TextDecoder
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}
