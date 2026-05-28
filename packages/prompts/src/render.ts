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

export interface LeanNote {
  id: string;
  topic: string;
  lean: string;
  /** ISO-8601 timestamp. When the lean was set, for display + audit. */
  setAt: string;
  /** agency_users.id of the PM who set it, or null when system-applied. */
  setBy: string | null;
  /** ISO-8601 timestamp. Entries with expiresAt <= now are filtered out. */
  expiresAt: string;
}

/**
 * Filter to active (non-expired) lean notes. Exposed because assemble() needs
 * the count to decide whether to keep or strip the prompt's "Current tuning
 * leans" section entirely.
 */
export function activeLeanNotes(notes: LeanNote[], now: Date): LeanNote[] {
  const cutoff = now.getTime();
  return notes.filter((n) => Date.parse(n.expiresAt) > cutoff);
}

/**
 * Render active lean notes as a markdown sublist. Caller is expected to have
 * already filtered via `activeLeanNotes` — this just formats. Returns an empty
 * string for an empty input so the section strip in assemble() is the single
 * source of truth for the "no leans" branch.
 */
export function renderLeanNotes(notes: LeanNote[]): string {
  if (notes.length === 0) return "";
  return notes.map((n) => `- **${n.topic}:** ${n.lean}`).join("\n");
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
