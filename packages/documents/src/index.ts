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
  formatNames,
  frequencyLabel,
  humanDate,
  STANDARD_DISCLAIMER,
} from "./model";
export type { NoticeOfIntentionToLeaveInput } from "./notice-of-intention-to-leave";
export { buildNoticeOfIntentionToLeave } from "./notice-of-intention-to-leave";
export type { NoticeToLeaveInput } from "./notice-to-leave";
export { buildNoticeToLeave } from "./notice-to-leave";
export { renderDocumentPdf } from "./pdf";
export type { GeneralBreachNoticeInput, RemedyBreachNoticeInput } from "./remedy-breach";
export { buildGeneralBreachNotice, buildRemedyBreachNotice } from "./remedy-breach";
export { renderDocumentHtml } from "./render";
export type { RentIncreaseNoticeInput } from "./rent-increase";
export { buildRentIncreaseNoticeDocument } from "./rent-increase";
