// ============================================================================
// Escalation pre-classifier (spec §13) — deterministic safety net
// ============================================================================
// The spec requires an escalation check on EVERY inbound item, independent of
// category, that produces only a brief acknowledgement and routes to a human
// with a prominent flag (spec §5d, §13). This is a deterministic, recall-
// oriented detector that runs BEFORE / ALONGSIDE the LLM classifier — a
// keyword safety net so a sensitive case is never silently auto-handled even
// if the model misses it. "When in doubt, escalate" (spec §13).
//
// It is NOT the sole determination — the LLM's own escalation_flag still
// applies; this is the floor, not the ceiling. The mapped `flag` values align
// with @pm/shared's `escalation_flag` enum (WELFARE | LEGAL | REPUTATIONAL).
// ============================================================================

export type EscalationFlag = "WELFARE" | "LEGAL" | "REPUTATIONAL";

export type EscalationTrigger =
  | "self_harm_or_harm_to_others"
  | "domestic_violence"
  | "legal_qcat_rta_or_lawyer"
  | "death"
  | "media_or_police"
  | "staff_misconduct"
  | "discrimination";

interface TriggerDef {
  trigger: EscalationTrigger;
  flag: EscalationFlag;
  /** lower-cased substrings; recall-oriented, intentionally broad */
  phrases: string[];
}

const TRIGGERS: TriggerDef[] = [
  {
    trigger: "self_harm_or_harm_to_others",
    flag: "WELFARE",
    phrases: [
      "suicide",
      "kill myself",
      "end my life",
      "self-harm",
      "self harm",
      "harm myself",
      "hurt myself",
      "harm to others",
      "hurt someone",
      "kill him",
      "kill her",
      "kill them",
    ],
  },
  {
    trigger: "domestic_violence",
    flag: "WELFARE",
    phrases: [
      "domestic violence",
      "dv order",
      "dvo",
      "violent partner",
      "violent ex",
      "abusive partner",
      "afraid for my safety",
      "scared for my safety",
      "restraining order",
      "protection order",
      "fleeing violence",
    ],
  },
  {
    trigger: "legal_qcat_rta_or_lawyer",
    flag: "LEGAL",
    phrases: [
      "qcat",
      "rta dispute",
      "dispute resolution",
      "tribunal",
      "lawyer",
      "solicitor",
      "legal action",
      "take legal",
      "sue you",
      "take you to court",
      "court order",
      "breach notice",
    ],
  },
  {
    trigger: "death",
    flag: "WELFARE",
    phrases: ["passed away", "deceased", "has died", "death of", "found dead"],
  },
  {
    trigger: "media_or_police",
    flag: "REPUTATIONAL",
    phrases: [
      "the media",
      "journalist",
      "news story",
      "current affair",
      "the police",
      "police report",
      "police are involved",
      "reported to police",
    ],
  },
  {
    trigger: "staff_misconduct",
    flag: "REPUTATIONAL",
    phrases: [
      "staff misconduct",
      "your staff member",
      "the property manager was",
      "harassed by",
      "your agent was",
      "complaint about your",
    ],
  },
  {
    trigger: "discrimination",
    flag: "REPUTATIONAL",
    phrases: [
      "discrimination",
      "discriminated",
      "racist",
      "racism",
      "because of my race",
      "because of my disability",
      "disability discrimination",
    ],
  },
];

export interface EscalationDetection {
  /** true if any trigger fired — caller should route to human review */
  escalate: boolean;
  /** distinct flags raised, aligned with the shared escalation_flag enum */
  flags: EscalationFlag[];
  /** every match, for audit + PM review notes */
  matches: Array<{ trigger: EscalationTrigger; flag: EscalationFlag; matchedPhrase: string }>;
}

/**
 * Scan free text for escalation triggers. Deterministic, case-insensitive,
 * recall-oriented. Returns all matches so the caller can surface them in PM
 * review notes and the audit log.
 */
export function detectEscalations(text: string): EscalationDetection {
  const haystack = text.toLowerCase();
  const matches: EscalationDetection["matches"] = [];

  for (const def of TRIGGERS) {
    for (const phrase of def.phrases) {
      if (haystack.includes(phrase)) {
        matches.push({ trigger: def.trigger, flag: def.flag, matchedPhrase: phrase });
        break; // one match per trigger is enough to escalate
      }
    }
  }

  const flags = [...new Set(matches.map((m) => m.flag))];
  return { escalate: matches.length > 0, flags, matches };
}
