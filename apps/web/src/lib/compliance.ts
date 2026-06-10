import { findRule, getFormById, type RuleKey } from "@pm/rules";

// Demo compliance chips: resolve {ruleKey}/{formId} references through the
// deterministic rules engine AT RENDER TIME. Statutory numbers shown in the
// demo come from @pm/rules — never from fixture text (spec §0.3). Anything we
// can't resolve degrades to its bare label rather than guessing.

export interface ComplianceChipRef {
  ruleKey?: string;
  formId?: string;
  label: string;
}

export interface ResolvedChip {
  label: string;
  /** Engine-resolved detail, e.g. "7 days · rule qld-2025-05-01" — null when the chip is a process note. */
  detail: string | null;
}

const UNIT_PATTERNS: Array<{ regex: RegExp; unit: string }> = [
  { regex: /days?$/i, unit: "day" },
  { regex: /hours?$/i, unit: "hour" },
  { regex: /months?$/i, unit: "month" },
  { regex: /weeks?$/i, unit: "week" },
];

/** Pull human-readable durations out of a rule's value object, whatever its shape. */
function describeValue(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "number") continue;
    const match = UNIT_PATTERNS.find((p) => p.regex.test(key));
    if (match) out.push(`${v} ${match.unit}${v === 1 ? "" : "s"}`);
  }
  return out;
}

export function resolveComplianceChips(raw: unknown, asOf: string): ResolvedChip[] {
  if (!Array.isArray(raw)) return [];
  const chips: ResolvedChip[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const ref = entry as ComplianceChipRef;
    if (typeof ref.label !== "string" || ref.label.length === 0) continue;
    const details: string[] = [];
    if (ref.formId) {
      try {
        const form = getFormById(ref.formId, asOf);
        details.push(`RTA Form ${form.formId} — ${form.purpose}`);
      } catch {
        // Unknown form id: show the label alone rather than invent a form.
      }
    }
    if (ref.ruleKey) {
      const rule = findRule(ref.ruleKey as RuleKey, asOf);
      if (rule) {
        const durations = describeValue(rule.value);
        if (durations.length > 0) details.push(durations.join(" / "));
        details.push(`rule ${rule.version}`);
      }
    }
    chips.push({ label: ref.label, detail: details.length > 0 ? details.join(" · ") : null });
  }
  return chips;
}
