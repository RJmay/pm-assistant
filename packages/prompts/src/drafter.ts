import Anthropic from "@anthropic-ai/sdk";
import {
  DrafterApiError,
  DrafterValidationError,
  type DraftSubmission,
  submitDraftSchema,
} from "@pm/shared";
import { z } from "zod";

export type DrafterModel = "claude-sonnet-4-6" | "claude-opus-4-7";

export interface InboundEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: string;
}

export interface ThreadEntry {
  direction: "inbound" | "outbound";
  from: string;
  body: string;
  timestamp: string;
}

export interface DrafterInput {
  systemPrompt: string;
  inboundEmail: InboundEmail;
  threadHistory?: ThreadEntry[];
  model?: DrafterModel;
}

export interface DrafterOpts {
  apiKey: string;
  /** Maximum response tokens. Default 4096. */
  maxTokens?: number;
  /** Test seam: inject a constructed (or mocked) Anthropic client. */
  client?: Anthropic;
  /**
   * How many times to call the model when it returns an unusable response
   * (no `submit_draft` tool_use block, or args that fail `submitDraftSchema`).
   * Tool output is occasionally malformed; a fresh attempt almost always yields
   * a valid call. Transport/API errors are NOT retried here (the SDK does that).
   * Default 2.
   */
  maxAttempts?: number;
}

const DEFAULT_MODEL: DrafterModel = "claude-sonnet-4-6";
const TOOL_NAME = "submit_draft";

const TOOL_DEFINITION: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Submit the structured draft reply for property-manager review. Always call this tool to return output — never reply in free text.",
  input_schema: z.toJSONSchema(submitDraftSchema) as Anthropic.Tool["input_schema"],
};

/**
 * Pure-ish wrapper around the Anthropic messages API that forces a single
 * `submit_draft` tool call and validates the args with `submitDraftSchema`.
 *
 * Throws `DrafterApiError` on transport/API failure and
 * `DrafterValidationError` when the model returns something we can't trust
 * (no tool_use block, wrong tool name, or args that fail zod validation).
 */
export async function draft(input: DrafterInput, opts: DrafterOpts): Promise<DraftSubmission> {
  const model = input.model ?? DEFAULT_MODEL;
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  const maxTokens = opts.maxTokens ?? 4096;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);

  const userMessage = formatUserMessage(input.inboundEmail, input.threadHistory);

  // Retry only on an unusable model response (malformed tool args / no tool_use).
  // Such failures are intermittent — the model usually produces a valid call on
  // a fresh attempt. Transport/API errors propagate immediately (the SDK retries
  // those itself), so they're thrown inside the loop, not caught and retried.
  let lastValidationError: DrafterValidationError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: input.systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        tools: [TOOL_DEFINITION],
        tool_choice: { type: "tool", name: TOOL_NAME },
      });
    } catch (cause) {
      throw new DrafterApiError(`Anthropic API call failed: ${describeError(cause)}`, {
        model,
        cause,
        requestId: extractRequestId(cause),
        statusCode: extractStatusCode(cause),
      });
    }

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use" || toolUse.name !== TOOL_NAME) {
      lastValidationError = new DrafterValidationError(
        `Model did not emit a ${TOOL_NAME} tool_use block. Stop reason: ${response.stop_reason ?? "unknown"}`,
        { rawArgs: response.content, issues: [] },
      );
      continue;
    }

    const parsed = submitDraftSchema.safeParse(coerceBooleanishFields(toolUse.input));
    if (!parsed.success) {
      lastValidationError = new DrafterValidationError(
        `Model emitted ${TOOL_NAME} with args that don't match submitDraftSchema`,
        { rawArgs: toolUse.input, issues: parsed.error.issues },
      );
      continue;
    }
    return parsed.data;
  }

  // Exhausted every attempt without a valid tool call.
  throw (
    lastValidationError ??
    new DrafterValidationError("Drafter exhausted all attempts with no valid response", {
      rawArgs: null,
      issues: [],
    })
  );
}

// The system prompt documents the boolean flags in a human-readable `[YES | NO]`
// format, so the model frequently returns the literal strings "YES"/"NO" for
// these fields instead of JSON booleans (most often on the escalation/DO-NOT-SEND
// templates). Bridge that convention to the boolean contract at the parse
// boundary rather than letting validation fail. Unrecognised values are left
// untouched so zod still reports a real type error.
const BOOLEANISH_FIELDS = ["emergency_landlord_alert", "safety_critical", "do_not_send"] as const;

function coerceBooleanishFields(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const obj = { ...(input as Record<string, unknown>) };
  for (const field of BOOLEANISH_FIELDS) {
    const value = obj[field];
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase();
    if (normalized === "yes" || normalized === "true") obj[field] = true;
    else if (normalized === "no" || normalized === "false") obj[field] = false;
  }
  return obj;
}

function formatUserMessage(inbound: InboundEmail, thread?: ThreadEntry[]): string {
  const parts: string[] = [];
  if (thread && thread.length > 0) {
    parts.push("## Prior exchanges on this thread (oldest first)");
    for (const entry of thread) {
      const label = entry.direction === "inbound" ? "Inbound" : "Outbound";
      parts.push(`**${label}** from ${entry.from} · ${entry.timestamp}`);
      parts.push(entry.body);
      parts.push("---");
    }
    parts.push("");
  }
  parts.push("## Inbound email to draft a reply to");
  parts.push(`**From:** ${inbound.from}`);
  parts.push(`**To:** ${inbound.to}`);
  parts.push(`**Subject:** ${inbound.subject}`);
  parts.push(`**Received at:** ${inbound.receivedAt}`);
  parts.push("");
  parts.push(inbound.body);
  parts.push("");
  parts.push(`Call the ${TOOL_NAME} tool with your structured draft.`);
  return parts.join("\n");
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

function extractRequestId(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  if ("request_id" in err && typeof (err as { request_id: unknown }).request_id === "string") {
    return (err as { request_id: string }).request_id;
  }
  if ("requestID" in err && typeof (err as { requestID: unknown }).requestID === "string") {
    return (err as { requestID: string }).requestID;
  }
  return undefined;
}

function extractStatusCode(err: unknown): number | undefined {
  if (
    err &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return undefined;
}
