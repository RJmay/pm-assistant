export interface DraftFields {
  subject: string | null;
  body: string | null;
}

export interface DraftDiff {
  subjectChanged: boolean;
  bodyChanged: boolean;
  previous_subject: string | null;
  new_subject: string | null;
  previous_body: string | null;
  new_body: string | null;
}

/** Normalise for comparison: trim, treat empty string and null as equal. */
function norm(v: string | null): string {
  return (v ?? "").trim();
}

/**
 * Compute the diff between the original draft and the PM's edits. Returns
 * null when nothing meaningful changed, so the caller can skip writing a
 * `draft_edits` row.
 */
export function computeDraftDiff(original: DraftFields, edited: DraftFields): DraftDiff | null {
  const subjectChanged = norm(original.subject) !== norm(edited.subject);
  const bodyChanged = norm(original.body) !== norm(edited.body);
  if (!subjectChanged && !bodyChanged) return null;
  return {
    subjectChanged,
    bodyChanged,
    previous_subject: original.subject,
    new_subject: edited.subject,
    previous_body: original.body,
    new_body: edited.body,
  };
}
