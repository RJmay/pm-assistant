export const PACKAGE_NAME = "@pm/shared";

/**
 * Thrown by `@pm/prompts` `assemble()` when an agency lacks a nominated repairer.
 * The repairer is required for the RTRA s218 emergency-repair pathway (tenant
 * authorises emergency repairs themselves up to 4 weeks' rent), so refusing
 * to assemble is safer than producing a prompt that omits a legally required
 * contact.
 */
export class MissingNominatedRepairerError extends Error {
  override readonly name = "MissingNominatedRepairerError";
  readonly agencyId: string;

  constructor(agencyId: string) {
    super(
      `Cannot assemble prompt for agency ${agencyId}: nominated repairer is missing. ` +
        `Set agency_config.nominated_repairer (name + number) before drafting — ` +
        `required by RTRA s218 emergency-repair pathway.`,
    );
    this.agencyId = agencyId;
  }
}
