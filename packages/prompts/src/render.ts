/**
 * Pure renderers for the structured fields that the prompt template needs as
 * markdown blocks. Each function is total: empty inputs render an explicit
 * placeholder note rather than silently producing an empty string, so the
 * assembled prompt always reads coherently.
 */

export interface Tradie {
  trade: string;
  name: string;
  businessHoursContact?: string;
  afterHoursContact?: string;
}

export interface VoiceSample {
  label: string;
  body: string;
}

export interface NominatedRepairer {
  name: string;
  number: string;
}

export interface Pm {
  name: string;
  email?: string;
  phone?: string;
  propertiesCovered?: string;
  coverageNotes?: string;
}

export interface PerOwnerException {
  note: string;
}

export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)}`;
}

export function renderTradies(tradies: Tradie[]): string {
  if (tradies.length === 0) {
    return "_No approved tradies on file._";
  }
  return tradies
    .map((t) => {
      const contacts: string[] = [];
      if (t.businessHoursContact) {
        contacts.push(`business hours ${t.businessHoursContact}`);
      }
      if (t.afterHoursContact) {
        contacts.push(`after hours ${t.afterHoursContact}`);
      }
      const contactStr = contacts.length > 0 ? ` — ${contacts.join(", ")}` : "";
      return `- **${t.trade}:** ${t.name}${contactStr}`;
    })
    .join("\n");
}

export function renderVoiceSamples(samples: VoiceSample[]): string {
  if (samples.length === 0) {
    return "_No voice samples on file._";
  }
  return samples.map((s) => `**${s.label}**\n\n${s.body}`).join("\n\n---\n\n");
}

export function renderNominatedRepairer(r: NominatedRepairer): string {
  return `${r.name} (${r.number})`;
}

export function renderPms(pms: Pm[]): string {
  if (pms.length === 0) {
    return "_No property managers on file._";
  }
  return pms
    .map((pm) => {
      const parts: string[] = [`**${pm.name}**`];
      if (pm.email) parts.push(`email ${pm.email}`);
      if (pm.phone) parts.push(`phone ${pm.phone}`);
      if (pm.propertiesCovered) parts.push(`covers ${pm.propertiesCovered}`);
      if (pm.coverageNotes) parts.push(pm.coverageNotes);
      return `- ${parts.join(" — ")}`;
    })
    .join("\n");
}

export function renderPerOwnerExceptions(exceptions: PerOwnerException[]): string {
  if (exceptions.length === 0) {
    return "_None._";
  }
  return exceptions.map((e) => `- ${e.note}`).join("\n");
}
