import { detectEscalations, triageEmergencyRepair } from "@pm/rules";
import type { DraftSubmission } from "@pm/shared";

// ============================================================================
// Deterministic compliance floor (spec §5d, §6, §13)
// ============================================================================
// Runs AFTER the LLM drafter and raises a deterministic floor under its output
// — the "deterministic backbone, AI at the edges" principle. The LLM's flags
// are never DOWNGRADED here; we only raise them when the deterministic
// detectors catch something the model missed ("when in doubt, escalate").
//
//   - Escalation safety-net (§13): when the keyword detector fires, raise the
//     flag to the MORE severe of the LLM's flag and the detected flag (never
//     downgrade) + add a PM review note. For WELFARE-class hits (self-harm /
//     DV / death) also force do_not_send — a welfare matter must never be
//     auto-sendable.
//   - Emergency triage (§6, RTRA s214): if the maintenance triage flags a
//     possible emergency, add a review note and bump STANDARD → PRIORITY.
//     We deliberately do NOT touch emergency_landlord_alert — that fires owner
//     SMS/email, too costly to trigger on a keyword; the PM decides.
//
// Pure + deterministic so it's fully unit-testable.
// ============================================================================

const FLAG_SEVERITY: Record<string, number> = {
  NONE: 0,
  REPUTATIONAL: 1,
  LEGAL: 2,
  INCIDENT: 2,
  WELFARE: 3,
};

export interface ComplianceFloorResult {
  submission: DraftSubmission;
  /** Human-readable list of what the floor changed (empty if nothing). */
  adjustments: string[];
}

/**
 * @param submission the LLM drafter's output
 * @param inboundText the inbound email text (subject + body) to scan
 * @param asOf YYYY-MM-DD used to resolve the s214 rule version
 */
export function applyComplianceFloor(
  submission: DraftSubmission,
  inboundText: string,
  asOf: string,
): ComplianceFloorResult {
  const adjustments: string[] = [];
  const notes = [...submission.pm_review_notes];
  let escalationFlag: DraftSubmission["escalation_flag"] = submission.escalation_flag;
  let doNotSend = submission.do_not_send;
  let priority: DraftSubmission["priority"] = submission.priority;

  // ---- Escalation safety-net ----
  const esc = detectEscalations(inboundText);
  if (esc.escalate) {
    const detected = [...esc.flags].sort(
      (a, b) => (FLAG_SEVERITY[b] ?? 0) - (FLAG_SEVERITY[a] ?? 0),
    )[0];
    // Raise to the MORE severe of the LLM's flag and the detected flag — never
    // downgrade. So a welfare signal under a weaker LLM flag (e.g. the model
    // said REPUTATIONAL) is still surfaced at its true severity.
    if (detected && (FLAG_SEVERITY[detected] ?? 0) > (FLAG_SEVERITY[escalationFlag] ?? 0)) {
      adjustments.push(
        `escalation_flag raised ${escalationFlag}→${detected} (deterministic safety-net)`,
      );
      escalationFlag = detected;
    }
    const triggers = [...new Set(esc.matches.map((m) => m.trigger))].join(", ");
    const flagList = [...new Set(esc.flags)].join("/");
    notes.push(
      `⚠️ Safety-net detected possible ${flagList} content (${triggers}) — verify before sending.`,
    );
    if (esc.flags.includes("WELFARE") && !doNotSend) {
      doNotSend = true;
      adjustments.push("do_not_send forced true (welfare-sensitive content detected)");
    }
  }

  // ---- s214 emergency triage ----
  // Defensive: a malformed asOf must never crash drafting — skip triage instead.
  let triage: ReturnType<typeof triageEmergencyRepair> | null = null;
  try {
    triage = triageEmergencyRepair(inboundText, asOf);
  } catch {
    triage = null;
  }
  if (triage?.isEmergency) {
    notes.push(
      `🔧 Possible RTRA s214 emergency (${triage.matchedItemKeys.join(", ")}) — verify and prioritise.`,
    );
    if (priority === "STANDARD") {
      priority = "PRIORITY";
      adjustments.push("priority raised STANDARD→PRIORITY (possible s214 emergency)");
    }
  }

  const changed =
    escalationFlag !== submission.escalation_flag ||
    doNotSend !== submission.do_not_send ||
    priority !== submission.priority ||
    notes.length !== submission.pm_review_notes.length;

  if (!changed) return { submission, adjustments };

  return {
    submission: {
      ...submission,
      escalation_flag: escalationFlag,
      do_not_send: doNotSend,
      priority,
      pm_review_notes: notes,
    },
    adjustments,
  };
}
