import { ResendApiError } from "@pm/shared";
import { z } from "zod";

/**
 * Minimal fetch-based client for the Resend Emails API.
 *
 * POST https://api.resend.com/emails  → 200 { id } on success.
 * Errors come back as { name, message, statusCode } per Resend docs.
 * No SDK — Resend's official client pulls in node-only deps we don't want
 * in the Workers bundle.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const sendResponseSchema = z.object({ id: z.string() });
const resendErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  statusCode: z.number().optional(),
});

export interface SendEmailInput {
  /** Verified sender — bare email or `Display Name <addr>` form. */
  from: string;
  /** One or more recipient addresses. Resend accepts a single string OR array. */
  to: string | string[];
  subject: string;
  /** HTML body. At least one of `html` or `text` must be supplied. */
  html?: string;
  text?: string;
  replyTo?: string;
}

export interface ResendCredentials {
  apiKey: string;
}

export interface SendEmailResult {
  id: string;
}

export async function sendEmail(
  input: SendEmailInput,
  creds: ResendCredentials,
): Promise<SendEmailResult> {
  if (!input.html && !input.text) {
    throw new ResendApiError(`sendEmail requires either html or text body`, {
      statusCode: 0,
      endpoint: RESEND_ENDPOINT,
    });
  }

  const payload: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject,
  };
  if (input.html) payload.html = input.html;
  if (input.text) payload.text = input.text;
  if (input.replyTo) payload.reply_to = input.replyTo;

  let resp: Response;
  try {
    resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new ResendApiError(`Resend request failed: ${describeError(cause)}`, {
      statusCode: 0,
      endpoint: RESEND_ENDPOINT,
      cause,
    });
  }

  const rawBody = await resp.text();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    parsedBody = rawBody;
  }

  if (!resp.ok) {
    const errParsed = resendErrorSchema.safeParse(parsedBody);
    const name = errParsed.success ? errParsed.data.name : undefined;
    const msg = errParsed.success ? errParsed.data.message : `HTTP ${resp.status}`;
    throw new ResendApiError(`Resend ${resp.status}: ${msg}`, {
      statusCode: resp.status,
      endpoint: RESEND_ENDPOINT,
      resendErrorName: name,
      responseBody: parsedBody,
    });
  }

  const parsed = sendResponseSchema.safeParse(parsedBody);
  if (!parsed.success) {
    throw new ResendApiError(`Resend response failed schema validation`, {
      statusCode: resp.status,
      endpoint: RESEND_ENDPOINT,
      responseBody: parsedBody,
    });
  }
  return { id: parsed.data.id };
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "(unserialisable error)";
  }
}
