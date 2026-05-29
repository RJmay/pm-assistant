import { getRule } from "./engine";
import { type FormAction, type FormDefinition, formsValueSchema } from "./schema";

// ============================================================================
// Form selection (spec §6 "Form selection") — deterministic
// ============================================================================
// Given an action, return the correct current RTA form. The LLM never selects
// a statutory form. Forms 18b / R18 are seeded without a stated purpose, so
// they aren't reachable by action and resolving them requires confirmation.
// ============================================================================

export class FormNotConfiguredError extends Error {
  override readonly name = "FormNotConfiguredError";
  constructor(formId: string) {
    super(
      `Form ${formId} is seeded without a confirmed purpose — confirm from the RTA before use.`,
    );
  }
}

export class NoFormForActionError extends Error {
  override readonly name = "NoFormForActionError";
  constructor(action: string) {
    super(`No RTA form is mapped to action '${action}'.`);
  }
}

function allForms(asOf: string): FormDefinition[] {
  const rule = getRule("forms", asOf);
  return formsValueSchema.parse(rule.value).forms;
}

/** All seeded forms in force on `asOf`. */
export function listForms(asOf: string): FormDefinition[] {
  return allForms(asOf);
}

/** The form serving a given action. Throws if none is mapped. */
export function selectForm(action: FormAction, asOf: string): FormDefinition {
  const match = allForms(asOf).find((f) => f.action === action);
  if (match === undefined) throw new NoFormForActionError(action);
  if (match.needsHumanConfirmation || match.purpose === null) {
    throw new FormNotConfiguredError(match.formId);
  }
  return match;
}

/** Look up a form by its identifier (e.g. "9", "18a", "R12"). */
export function getFormById(formId: string, asOf: string): FormDefinition {
  const match = allForms(asOf).find((f) => f.formId === formId);
  if (match === undefined) throw new NoFormForActionError(formId);
  return match;
}
