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
