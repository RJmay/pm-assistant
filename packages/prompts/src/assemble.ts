import { MissingNominatedRepairerError } from "@pm/shared";
import {
  formatCents,
  type NominatedRepairer,
  type PerOwnerException,
  type Pm,
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
  };
  pms: Pm[];
  runtimeContext?: {
    pmName?: string;
    propertyAddress?: string;
    tenantName?: string;
  };
  /**
   * Override for the `[DATE]` substitution. Pass a fixed Date in tests to keep
   * snapshots deterministic; production callers omit this and get `new Date()`.
   */
  now?: Date;
}

const NOT_ON_FILE = "_Not on file._";

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

  const date = (input.now ?? new Date()).toISOString().slice(0, 10);

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
    "[DATE]": date,
  };

  if (input.runtimeContext?.pmName) {
    substitutions["[PM_NAME]"] = input.runtimeContext.pmName;
  }

  let out = input.basePrompt;
  for (const [placeholder, value] of Object.entries(substitutions)) {
    out = out.replaceAll(placeholder, value);
  }
  return out;
}
