// ============================================================================
// @pm/documents — deterministic QLD statutory document engine (spec §10)
// ============================================================================
// Stack-agnostic (pure TS). Builders turn property/tenancy data + the rules
// engine into a structured DocumentModel; the renderer turns a model into a
// clean, print-ready document. No statutory field is ever LLM-generated.
// ============================================================================

export const PACKAGE_NAME = "@pm/documents";

export type { EntryNoticeInput } from "./entry-notice";
export { buildEntryNoticeDocument } from "./entry-notice";
export type {
  DocumentField,
  DocumentModel,
  DocumentParty,
  DocumentSection,
} from "./model";
export {
  DocumentNotCompliantError,
  formatDollars,
  frequencyLabel,
  humanDate,
  STANDARD_DISCLAIMER,
} from "./model";
export { renderDocumentHtml } from "./render";
export type { RentIncreaseNoticeInput } from "./rent-increase";
export { buildRentIncreaseNoticeDocument } from "./rent-increase";
