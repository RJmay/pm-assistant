import { getRule } from "./engine";
import { type EmergencyRepairItem, emergencyRepairsValueSchema } from "./schema";

// ============================================================================
// Emergency-repair triage (RTRA s214) — spec §6 + §9
// ============================================================================
// The statutory list (seeded faithfully) drives a deterministic FIRST-PASS
// triage of a maintenance request: EMERGENCY vs routine. A keyword hit is a
// FLAG for human/LLM review, never a legal determination — the matcher is
// recall-oriented (better to flag a non-emergency than miss a real one). The
// LLM and the PM make the final call.
// ============================================================================

export interface EmergencyTriageResult {
  isEmergency: boolean;
  /** statutory item keys that matched */
  matchedItemKeys: string[];
  /** the matched item labels + the substring that triggered them */
  matches: Array<{ key: string; label: string; matchedKeyword: string }>;
  statute: string;
}

function emergencyItems(asOf: string): { statute: string; items: EmergencyRepairItem[] } {
  const rule = getRule("emergency_repairs_s214", asOf);
  return emergencyRepairsValueSchema.parse(rule.value);
}

/** The seeded RTRA s214 statutory items in force on `asOf`. */
export function listEmergencyRepairItems(asOf: string): EmergencyRepairItem[] {
  return emergencyItems(asOf).items;
}

/**
 * First-pass triage of free text against the s214 list. Case-insensitive
 * substring match on the (non-statutory) keyword heuristics.
 */
export function triageEmergencyRepair(text: string, asOf: string): EmergencyTriageResult {
  const haystack = text.toLowerCase();
  const { statute, items } = emergencyItems(asOf);

  const matches: EmergencyTriageResult["matches"] = [];
  for (const item of items) {
    for (const keyword of item.keywords) {
      if (haystack.includes(keyword.toLowerCase())) {
        matches.push({ key: item.key, label: item.label, matchedKeyword: keyword });
        break; // one match per item is enough
      }
    }
  }

  return {
    isEmergency: matches.length > 0,
    matchedItemKeys: matches.map((m) => m.key),
    matches,
    statute,
  };
}
