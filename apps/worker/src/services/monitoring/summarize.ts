import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { MonitoredSource } from "./sources";

// ============================================================================
// Regulatory change assessment (spec §12) — invoked ONLY on a detected diff
// ============================================================================
// Compares the previous vs current text of a monitored source and returns a
// structured assessment: what changed, the effective date (if stated), which
// rules/modules are affected, and proposed updates to the regulatory_rules
// data. The LLM only SUMMARISES + PROPOSES; a human approves before anything
// touches live rules (hard constraint). Mirrors the drafter's forced-tool-use
// + zod-validation pattern.
// ============================================================================

export const regulatoryAssessmentSchema = z.object({
  change_summary: z.string(),
  /** ISO date (YYYY-MM-DD) if the change states one, else null. */
  effective_date: z.string().nullable(),
  /**
   * Affected rule keys (e.g. rent_increase_frequency, entry_notice_routine,
   * emergency_repairs_s214, forms, house_rules_transition) and/or "templates".
   */
  affected_modules: z.array(z.string()),
  proposed_changes: z.array(z.object({ module: z.string(), description: z.string() })),
});
export type RegulatoryAssessment = z.infer<typeof regulatoryAssessmentSchema>;

const TOOL_NAME = "submit_regulatory_assessment";
const MODEL = "claude-sonnet-4-6";
const MAX_INPUT_CHARS = 12000;

const SYSTEM_PROMPT = `You monitor Queensland residential tenancy regulation (RTRA Act 2008 + the 2025 Regulation, RTA, QCAT) for a property-management product. You are given the PREVIOUS and CURRENT text of a monitored source page that has changed.

Identify only SUBSTANTIVE regulatory changes (new/changed notice periods, frequency caps, rent rules, forms, emergency-repair provisions, house-rules, effective dates). Ignore cosmetic, navigation, or boilerplate changes.

If there is no substantive regulatory change, set change_summary to "No substantive regulatory change detected" and return an empty proposed_changes array.

Affected modules should use these rule keys where relevant: rent_increase_frequency, rent_increase_min_notice, rent_bidding_ban, minimum_housing_standards, entry_notice_routine, entry_frequency_cap, emergency_repairs_s214, forms, house_rules_transition; or "templates". Never invent a value you cannot see in the text. Always answer by calling the ${TOOL_NAME} tool.`;

const TOOL_DEFINITION: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Submit the structured assessment of the regulatory source change. Always call this tool; never reply in free text.",
  input_schema: z.toJSONSchema(regulatoryAssessmentSchema) as Anthropic.Tool["input_schema"],
};

export interface SummarizeInput {
  source: MonitoredSource;
  previousText: string;
  currentText: string;
}

export interface SummarizeOpts {
  apiKey: string;
  model?: string;
  client?: Anthropic;
  maxTokens?: number;
}

export async function summarizeRegulatoryChange(
  input: SummarizeInput,
  opts: SummarizeOpts,
): Promise<RegulatoryAssessment> {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  const userMessage = [
    `## Source: ${input.source.name} (${input.source.url})`,
    "",
    "### PREVIOUS text",
    input.previousText.slice(0, MAX_INPUT_CHARS),
    "",
    "### CURRENT text",
    input.currentText.slice(0, MAX_INPUT_CHARS),
    "",
    `Call ${TOOL_NAME} with your assessment.`,
  ].join("\n");

  const response = await client.messages.create({
    model: opts.model ?? MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: [TOOL_DEFINITION],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use" || toolUse.name !== TOOL_NAME) {
    throw new Error(`monitoring summary: model did not emit a ${TOOL_NAME} tool_use block`);
  }
  const parsed = regulatoryAssessmentSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`monitoring summary: tool args failed schema validation`);
  }
  return parsed.data;
}
