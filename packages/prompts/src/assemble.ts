import { MissingNominatedRepairerError } from "@pm/shared";
import {
  activeLeanNotes,
  formatCents,
  type LeanNote,
  type NominatedRepairer,
  type PerOwnerException,
  type Pm,
  renderLeanNotes,
  renderNominatedRepairer,
  renderPerOwnerExceptions,
  renderPms,
  renderTradies,
  renderVoiceSamples,
  type Tradie,
  type VoiceSample,
} from "./render";

export interface AssembleInput {
  basePrompt: string;
  agency: {
    id: string;
    name: string;
    suburb: string | null;
    businessHours: string | null;
    afterHoursLine: string | null;
    principal: string | null;
  };
  agencyConfig: {
    voiceSamples: VoiceSample[];
    approvedTradies: Tradie[];
    nominatedRepairer: NominatedRepairer | null;
    routineApprovalThresholdCents: number;
    writtenQuoteThresholdCents: number;
    perOwnerQuoteExceptions: PerOwnerException[];
    houseRules: string | null;
    leanNotes: LeanNote[];
  };
  pms: Pm[];
  runtimeContext?: {
    pmName?: string;
    propertyAddress?: string;
    tenantName?: string;
  };
  /**
   * Override for the `[DATE]` substitution AND the "is this lean expired"
   * comparison. Pass a fixed Date in tests to keep snapshots deterministic;
   * production callers omit this and get `new Date()`.
   */
  now?: Date;
}

const NOT_ON_FILE = "_Not on file._";

// Strips the whole `### Current tuning leans` block (heading + intro paragraph
// + placeholder line) when there are no active leans. Anchored on the literal
// heading text so unrelated prompt edits don't break it. The trailing `\n\n`
// is consumed so we don't leave a stray blank line between sections.
const LEAN_SECTION_RE = /### Current tuning leans\n\n[^\n]+\n\n\[LEAN_NOTES\]\n\n/;

/**
 * Pure assembly of the final system prompt. Throws `MissingNominatedRepairerError`
 * when the agency has no nominated repairer (required by RTRA s218).
 *
 * `[PM_NAME]` is only substituted when `runtimeContext.pmName` is provided;
 * otherwise it stays in the prompt as a literal for the model to leave as-is,
 * matching the prompt's own "PM signoff defaults" rules.
 */
export function assemble(input: AssembleInput): string {
  if (!input.agencyConfig.nominatedRepairer) {
    throw new MissingNominatedRepairerError(input.agency.id);
  }

  const now = input.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const activeLeans = activeLeanNotes(input.agencyConfig.leanNotes, now);

  const substitutions: Record<string, string> = {
    "[AGENCY_NAME]": input.agency.name,
    "[SUBURB]": input.agency.suburb ?? NOT_ON_FILE,
    "[BUSINESS_HOURS]": input.agency.businessHours ?? NOT_ON_FILE,
    "[AFTER_HOURS_LINE]": input.agency.afterHoursLine ?? NOT_ON_FILE,
    "[PRINCIPAL]": input.agency.principal ?? NOT_ON_FILE,
    "[PMS]": renderPms(input.pms),
    "[VOICE_SAMPLES]": renderVoiceSamples(input.agencyConfig.voiceSamples),
    "[APPROVED_TRADIES]": renderTradies(input.agencyConfig.approvedTradies),
    "[NOMINATED_REPAIRER]": renderNominatedRepairer(input.agencyConfig.nominatedRepairer),
    "[SPENDING_THRESHOLD]": formatCents(input.agencyConfig.routineApprovalThresholdCents),
    "[WRITTEN_QUOTE_THRESHOLD]": formatCents(input.agencyConfig.writtenQuoteThresholdCents),
    "[PER_OWNER_QUOTE_EXCEPTIONS]": renderPerOwnerExceptions(
      input.agencyConfig.perOwnerQuoteExceptions,
    ),
    "[HOUSE_RULES]": input.agencyConfig.houseRules ?? "_None on file._",
    "[LEAN_NOTES]": renderLeanNotes(activeLeans),
    "[DATE]": date,
  };

  if (input.runtimeContext?.pmName) {
    substitutions["[PM_NAME]"] = input.runtimeContext.pmName;
  }

  let out = input.basePrompt;
  // Strip the section entirely when there are no active leans, so the prompt
  // doesn't carry a heading with an empty body. Done before placeholder
  // substitution; if leans exist, the placeholder stays and gets filled below.
  if (activeLeans.length === 0) {
    out = out.replace(LEAN_SECTION_RE, "");
  }
  for (const [placeholder, value] of Object.entries(substitutions)) {
    out = out.replaceAll(placeholder, value);
  }
  return out;
}
