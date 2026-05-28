import { z } from "zod";

export const PACKAGE_NAME = "@pm/shared";

// ----------------------------------------------------------------------------
// Drafter contract — mirrors ARCHITECTURE.md's `submit_draft` tool schema and
// the `ai_drafts` table columns. Field naming stays snake_case because that's
// what Claude returns via tool use and what Postgres stores.
// ----------------------------------------------------------------------------

export const submitDraftSchema = z.object({
  category: z.enum(["MAINTENANCE", "RENT", "LEASE", "COMPLAINT", "ADMIN", "OTHER"]),
  category_confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  priority: z.enum(["STANDARD", "PRIORITY", "EMERGENCY_ALERT"]),
  escalation_flag: z.enum(["NONE", "WELFARE", "LEGAL", "REPUTATIONAL", "INCIDENT"]),
  emergency_landlord_alert: z.boolean(),
  // True when the AI assesses the property is unsafe, insecure, structurally
  // compromised, or has an insurance-relevant defect. Gates the
  // `safety_critical_only` owner notification profile (ARCHITECTURE §"Owner
  // notification routing"). Independent of emergency_landlord_alert — a tap
  // leak can be an emergency without being safety_critical, and vice versa.
  safety_critical: z.boolean(),
  do_not_send: z.boolean(),
  draft_confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  draft_subject: z.string(),
  draft_body: z.string(),
  pm_review_notes: z.array(z.string()),
});

export type DraftSubmission = z.infer<typeof submitDraftSchema>;

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

/**
 * Thrown by `@pm/prompts` `assemble()` when an agency lacks a nominated repairer.
 * The repairer is required for the RTRA s218 emergency-repair pathway (tenant
 * authorises emergency repairs themselves up to 4 weeks' rent), so refusing
 * to assemble is safer than producing a prompt that omits a legally required
 * contact.
 */
export class MissingNominatedRepairerError extends Error {
  override readonly name = "MissingNominatedRepairerError";
  readonly agencyId: string;

  constructor(agencyId: string) {
    super(
      `Cannot assemble prompt for agency ${agencyId}: nominated repairer is missing. ` +
        `Set agency_config.nominated_repairer (name + number) before drafting — ` +
        `required by RTRA s218 emergency-repair pathway.`,
    );
    this.agencyId = agencyId;
  }
}

/**
 * Thrown when the Anthropic API call itself fails (network, 5xx, rate limit,
 * malformed envelope). Wraps the upstream error with our drafting context so
 * structured logs include the model and request id.
 */
export class DrafterApiError extends Error {
  override readonly name = "DrafterApiError";
  readonly model: string;
  readonly requestId: string | undefined;
  readonly statusCode: number | undefined;

  constructor(
    message: string,
    opts: { model: string; requestId?: string; statusCode?: number; cause?: unknown },
  ) {
    super(message, { cause: opts.cause });
    this.model = opts.model;
    this.requestId = opts.requestId;
    this.statusCode = opts.statusCode;
  }
}

/**
 * Thrown when the Anthropic response is well-formed at the API level but its
 * tool_use args don't match `submitDraftSchema`. Carries the raw args + zod
 * issues for diagnosis without leaking them to callers.
 */
export class DrafterValidationError extends Error {
  override readonly name = "DrafterValidationError";
  readonly rawArgs: unknown;
  readonly issues: unknown;

  constructor(message: string, opts: { rawArgs: unknown; issues: unknown }) {
    super(message);
    this.rawArgs = opts.rawArgs;
    this.issues = opts.issues;
  }
}

/**
 * Thrown when a Pub/Sub push request fails JWT verification — bad signature,
 * wrong issuer/audience/email claim, expired token, etc. The Worker maps
 * this to an HTTP 401 response and never logs the token itself.
 */
export class PubSubVerificationError extends Error {
  override readonly name = "PubSubVerificationError";
  readonly reason: string;

  constructor(reason: string, opts?: { cause?: unknown }) {
    super(`Pub/Sub JWT verification failed: ${reason}`, { cause: opts?.cause });
    this.reason = reason;
  }
}

/**
 * Thrown when a Gmail REST call returns non-2xx or a malformed response.
 * Captures the HTTP status and Google's error body for diagnosis without
 * leaking access tokens (those live in the request, never in the error).
 */
export class GmailApiError extends Error {
  override readonly name = "GmailApiError";
  readonly statusCode: number;
  readonly endpoint: string;
  readonly responseBody: unknown;

  constructor(
    message: string,
    opts: { statusCode: number; endpoint: string; responseBody?: unknown; cause?: unknown },
  ) {
    super(message, { cause: opts.cause });
    this.statusCode = opts.statusCode;
    this.endpoint = opts.endpoint;
    this.responseBody = opts.responseBody;
  }
}

/**
 * Thrown when the OAuth state token a callback receives can't be verified —
 * bad HMAC, expired, malformed, or doesn't match a known agency. Maps to 400.
 */
export class OAuthStateError extends Error {
  override readonly name = "OAuthStateError";
  readonly reason: string;

  constructor(reason: string, opts?: { cause?: unknown }) {
    super(`OAuth state verification failed: ${reason}`, { cause: opts?.cause });
    this.reason = reason;
  }
}

/**
 * Thrown when a Twilio API call returns non-2xx or a malformed response.
 * Captures the HTTP status and Twilio's error code/body for diagnosis. Never
 * carries the auth token (it lives in the request, never the error).
 */
export class TwilioApiError extends Error {
  override readonly name = "TwilioApiError";
  readonly statusCode: number;
  readonly endpoint: string;
  readonly twilioErrorCode: number | undefined;
  readonly responseBody: unknown;

  constructor(
    message: string,
    opts: {
      statusCode: number;
      endpoint: string;
      twilioErrorCode?: number;
      responseBody?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, { cause: opts.cause });
    this.statusCode = opts.statusCode;
    this.endpoint = opts.endpoint;
    this.twilioErrorCode = opts.twilioErrorCode;
    this.responseBody = opts.responseBody;
  }
}

/**
 * Thrown when a Resend API call returns non-2xx or a malformed response.
 * Captures the HTTP status and Resend's error body for diagnosis. Never
 * carries the API key.
 */
export class ResendApiError extends Error {
  override readonly name = "ResendApiError";
  readonly statusCode: number;
  readonly endpoint: string;
  readonly resendErrorName: string | undefined;
  readonly responseBody: unknown;

  constructor(
    message: string,
    opts: {
      statusCode: number;
      endpoint: string;
      resendErrorName?: string;
      responseBody?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, { cause: opts.cause });
    this.statusCode = opts.statusCode;
    this.endpoint = opts.endpoint;
    this.resendErrorName = opts.resendErrorName;
    this.responseBody = opts.responseBody;
  }
}
