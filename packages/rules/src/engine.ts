import { compareIso, parseIsoDate } from "./dates";
import type { RegulatoryRule, RuleKey } from "./schema";
import { QLD_RULES } from "./seed";

// ============================================================================
// Rule resolution — pick the version of a rule in force on a given date
// ============================================================================
// `getRule(key, asOf)` mirrors the spec's `getRule(key, asOfDate)` (§6). A rule
// version is in force on `asOf` when `effectiveFrom <= asOf` (null == since
// inception) AND (`effectiveTo` is null OR `asOf <= effectiveTo`). If more than
// one version qualifies (shouldn't happen in a clean seed) the latest
// `effectiveFrom` wins, surfaced via `getRuleVersions` for auditing.
// ============================================================================

export class RuleNotFoundError extends Error {
  override readonly name = "RuleNotFoundError";
  constructor(key: RuleKey, asOf: string) {
    super(`No '${key}' rule version is in force on ${asOf}.`);
  }
}

/**
 * Thrown when a rule exists but its value was deliberately left unset because
 * the spec did not state it (`needsHumanConfirmation: true`). The engine
 * refuses to guess a regulatory fact (spec §0.3).
 */
export class RuleNotConfiguredError extends Error {
  override readonly name = "RuleNotConfiguredError";
  readonly key: RuleKey;
  constructor(rule: RegulatoryRule) {
    super(
      `Rule '${rule.key}' (version ${rule.version}) needs human confirmation before use — ` +
        `${rule.notes ?? rule.sourceNote}`,
    );
    this.key = rule.key;
  }
}

function isInForce(rule: RegulatoryRule, asOf: string): boolean {
  if (rule.effectiveFrom !== null && compareIso(asOf, rule.effectiveFrom) < 0) return false;
  if (rule.effectiveTo !== null && compareIso(asOf, rule.effectiveTo) > 0) return false;
  return true;
}

/** All versions of a key, newest `effectiveFrom` first (nulls last). */
export function getRuleVersions(
  key: RuleKey,
  source: readonly RegulatoryRule[] = QLD_RULES,
): RegulatoryRule[] {
  return source
    .filter((r) => r.key === key)
    .slice()
    .sort((a, b) => {
      if (a.effectiveFrom === b.effectiveFrom) return 0;
      if (a.effectiveFrom === null) return 1;
      if (b.effectiveFrom === null) return -1;
      return compareIso(b.effectiveFrom, a.effectiveFrom);
    });
}

/** The rule version in force on `asOf`, or null if none. */
export function findRule(
  key: RuleKey,
  asOf: string,
  source: readonly RegulatoryRule[] = QLD_RULES,
): RegulatoryRule | null {
  parseIsoDate(asOf);
  const candidates = getRuleVersions(key, source).filter((r) => isInForce(r, asOf));
  return candidates[0] ?? null;
}

/** The rule version in force on `asOf`. Throws `RuleNotFoundError` if none. */
export function getRule(
  key: RuleKey,
  asOf: string,
  source: readonly RegulatoryRule[] = QLD_RULES,
): RegulatoryRule {
  const rule = findRule(key, asOf, source);
  if (rule === null) throw new RuleNotFoundError(key, asOf);
  return rule;
}

/** Like `getRule` but also refuses rules whose value needs human confirmation. */
export function getConfiguredRule(
  key: RuleKey,
  asOf: string,
  source: readonly RegulatoryRule[] = QLD_RULES,
): RegulatoryRule {
  const rule = getRule(key, asOf, source);
  if (rule.needsHumanConfirmation || rule.value === null) throw new RuleNotConfiguredError(rule);
  return rule;
}

/** Every rule in force on `asOf` (one current version per key, where one exists). */
export function getActiveRules(
  asOf: string,
  source: readonly RegulatoryRule[] = QLD_RULES,
): RegulatoryRule[] {
  parseIsoDate(asOf);
  const keys = new Set(source.map((r) => r.key));
  const active: RegulatoryRule[] = [];
  for (const key of keys) {
    const rule = findRule(key, asOf, source);
    if (rule !== null) active.push(rule);
  }
  return active;
}
