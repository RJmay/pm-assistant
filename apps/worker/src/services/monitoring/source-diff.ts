// ============================================================================
// Source change detection (regulatory monitoring bot, spec §12)
// ============================================================================
// "Use RSS where available; otherwise hash-and-diff the relevant page
// sections." This module is the pure, deterministic core: normalise fetched
// text, hash it, and detect whether it changed vs a previously-stored hash.
// The hash is non-cryptographic — we only need stable change detection.
// ============================================================================

/**
 * Normalise fetched text for stable diffing so trivial formatting/whitespace
 * churn doesn't trigger false positives. (HTML→text extraction is the caller's
 * job; this collapses whitespace + trims.)
 */
export function normalizeForDiff(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Deterministic, synchronous 53-bit string hash (cyrb53). Non-cryptographic;
 * sufficient for "did this section change?". Hashes the NORMALISED text so
 * whitespace-only edits don't read as a change.
 */
export function contentHash(text: string): string {
  const s = normalizeForDiff(text);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return hash.toString(16);
}

export interface ChangeResult {
  changed: boolean;
  newHash: string;
  /** the normalised text (handy to feed the LLM summary on a change) */
  normalized: string;
}

/**
 * Compare freshly-fetched content against a previously-stored hash. A null
 * previous hash (first-ever scan of a source) counts as a change so the
 * baseline is captured.
 */
export function detectChange(previousHash: string | null, newContent: string): ChangeResult {
  const newHash = contentHash(newContent);
  return {
    changed: previousHash !== newHash,
    newHash,
    normalized: normalizeForDiff(newContent),
  };
}
