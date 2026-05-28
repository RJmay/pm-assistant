import { TwilioApiError } from "@pm/shared";
import { z } from "zod";

/**
 * Minimal fetch-based client for Twilio's Messages API.
 *
 * Twilio's REST API uses HTTP Basic auth (account SID + auth token) and
 * application/x-www-form-urlencoded bodies. The `Messages.json` endpoint
 * returns 201 with `{ sid, status, ... }` on success and 4xx with
 * `{ code, message, more_info, status }` on validation/quota errors.
 *
 * No SDK — keeps the Worker bundle small and the surface obvious.
 */

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

const sendMessageResponseSchema = z.object({
  sid: z.string(),
  status: z.string(),
  // Other fields exist but we only care about sid+status for the audit trail.
});

const twilioErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  more_info: z.string().optional(),
});

export interface SendSmsInput {
  /** Destination E.164 number, e.g. `+61400000000`. */
  to: string;
  /** Sender E.164 number — must be a verified Twilio number. */
  from: string;
  /** Message body. Twilio splits >160 chars into multiple segments. */
  body: string;
}

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

export interface SendSmsResult {
  sid: string;
  status: string;
}

export async function sendSms(
  input: SendSmsInput,
  creds: TwilioCredentials,
): Promise<SendSmsResult> {
  const endpoint = `${TWILIO_BASE}/Accounts/${creds.accountSid}/Messages.json`;
  const params = new URLSearchParams({
    To: input.to,
    From: input.from,
    Body: input.body,
  });

  // Basic auth — Twilio docs literally specify it this way. btoa is available
  // in the Workers runtime (and Node 16+).
  const authHeader = `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`;

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    });
  } catch (cause) {
    throw new TwilioApiError(`Twilio request failed: ${describeError(cause)}`, {
      statusCode: 0,
      endpoint,
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
    const errParsed = twilioErrorSchema.safeParse(parsedBody);
    const code = errParsed.success ? errParsed.data.code : undefined;
    const msg = errParsed.success ? errParsed.data.message : `HTTP ${resp.status}`;
    throw new TwilioApiError(`Twilio ${resp.status}: ${msg}`, {
      statusCode: resp.status,
      endpoint,
      twilioErrorCode: code,
      responseBody: parsedBody,
    });
  }

  const parsed = sendMessageResponseSchema.safeParse(parsedBody);
  if (!parsed.success) {
    throw new TwilioApiError(`Twilio response failed schema validation`, {
      statusCode: resp.status,
      endpoint,
      responseBody: parsedBody,
    });
  }
  return { sid: parsed.data.sid, status: parsed.data.status };
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
