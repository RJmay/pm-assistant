// ============================================================================
// Template engine (spec §5b) — deterministic, NOT AI
// ============================================================================
// The routine outbound work (lease-renewal offers, inspection notices, arrears
// reminders, owner updates) is ~15-20 recurring patterns. For these we merge a
// pre-vetted template with variables drawn from the data model + rules engine —
// no LLM call, so they can't hallucinate and they encode compliant language.
//
// A template references variables as `{{name}}` slots. Rendering is total and
// strict: a missing REQUIRED variable throws, and ANY `{{slot}}` left
// unresolved after substitution throws — so a half-merged "Hi {{tenant_name}}"
// can never reach a tenant. Optional slots must still be supplied (as an empty
// string) by the caller; this keeps "did the author forget a variable?" a
// loud failure rather than a silent blank.
// ============================================================================

import type { DraftSubmission } from "@pm/shared";

export interface Template {
  /** Stable identifier, also stored on the draft as `template:<key>`. */
  key: string;
  category: DraftSubmission["category"];
  /** Subject line with `{{slot}}` variables. */
  subject: string;
  /** Body with `{{slot}}` variables. Plain text (Australian English). */
  body: string;
  /** Variables that must be present AND non-empty. */
  requiredVariables: string[];
}

export interface RenderedTemplate {
  subject: string;
  body: string;
}

/** A rendered draft plus the PM review notes a template builder produces. */
export interface BuiltDraft {
  subject: string;
  body: string;
  reviewNotes: string[];
}

export type TemplateVars = Record<string, string | number>;

const SLOT_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** A required variable was missing or blank when rendering a template. */
export class MissingTemplateVariableError extends Error {
  override readonly name = "MissingTemplateVariableError";
  readonly templateKey: string;
  readonly variable: string;
  constructor(templateKey: string, variable: string) {
    super(`Template '${templateKey}' is missing required variable '${variable}'.`);
    this.templateKey = templateKey;
    this.variable = variable;
  }
}

/** A `{{slot}}` remained after substitution — the caller didn't supply it. */
export class UnresolvedTemplateSlotError extends Error {
  override readonly name = "UnresolvedTemplateSlotError";
  readonly templateKey: string;
  readonly variable: string;
  constructor(templateKey: string, variable: string) {
    super(
      `Template '${templateKey}' references '{{${variable}}}' but no value was supplied — ` +
        `refusing to render a partially-merged message.`,
    );
    this.templateKey = templateKey;
    this.variable = variable;
  }
}

function substitute(text: string, vars: TemplateVars, templateKey: string): string {
  return text.replace(SLOT_RE, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      throw new UnresolvedTemplateSlotError(templateKey, name);
    }
    return String(value);
  });
}

/**
 * Merge `vars` into a template. Throws `MissingTemplateVariableError` for a
 * blank required variable and `UnresolvedTemplateSlotError` for any slot the
 * caller didn't supply — so the result is always fully merged or it throws.
 */
export function renderTemplate(template: Template, vars: TemplateVars): RenderedTemplate {
  for (const key of template.requiredVariables) {
    const value = vars[key];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new MissingTemplateVariableError(template.key, key);
    }
  }
  return {
    subject: substitute(template.subject, vars, template.key),
    body: substitute(template.body, vars, template.key),
  };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Format an ISO `YYYY-MM-DD` calendar date as a human, Australian-style date
 * ("1 November 2025"). Operates on the string parts only — no `Date` — so it
 * never drifts across a timezone boundary. Returns the input unchanged if it
 * isn't a well-formed ISO date (the caller decides what to do with that).
 */
export function humanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
