export {
  DrafterApiError,
  DrafterValidationError,
  type DraftSubmission,
  MissingNominatedRepairerError,
  submitDraftSchema,
} from "@pm/shared";
export type { AssembleInput } from "./assemble";
export { assemble } from "./assemble";
export type {
  DrafterInput,
  DrafterModel,
  DrafterOpts,
  InboundEmail,
  ThreadEntry,
} from "./drafter";
export { draft } from "./drafter";
export type {
  LeanNote,
  NominatedRepairer,
  PerOwnerException,
  Pm,
  Tradie,
  VoiceSample,
} from "./render";
export { activeLeanNotes, renderLeanNotes } from "./render";
// Template engine + outbound-sequence templates (spec §5b / §8)
export {
  ARREARS_TEMPLATE,
  type ArrearsInput,
  type BuiltDraft,
  buildArrearsDraft,
  buildInspectionDraft,
  buildLeaseRenewalDraft,
  buildOwnerApprovalRequest,
  buildOwnerUpdateDraft,
  buildTradieQuoteChaser,
  buildTradieQuoteRequest,
  humanDate,
  INSPECTION_TEMPLATE,
  type InspectionInput,
  LEASE_RENEWAL_TEMPLATE,
  type LeaseRenewalInput,
  MissingTemplateVariableError,
  OWNER_APPROVAL_REQUEST_TEMPLATE,
  OWNER_UPDATE_TEMPLATE,
  type OwnerApprovalRequestInput,
  type OwnerUpdateInput,
  type RenderedTemplate,
  type RentReviewWindow,
  renderTemplate,
  type Template,
  type TemplateVars,
  TRADIE_QUOTE_CHASER_TEMPLATE,
  TRADIE_QUOTE_REQUEST_TEMPLATE,
  type TradieQuoteChaserInput,
  type TradieQuoteRequestInput,
  UnresolvedTemplateSlotError,
} from "./templates";
