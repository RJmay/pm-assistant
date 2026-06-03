-- ============================================================================
-- 0018 — more document types (Phase 4, spec §10)
-- ============================================================================
-- Forms 11 (Notice to Remedy Breach) and 12 (Notice to Leave). Their statutory
-- notice/remedy periods are seeded UNCONFIRMED in @pm/rules — the document
-- builders throw until a human confirms the current RTA value, so these types
-- exist but won't generate a document until the periods are confirmed.
-- (Adding enum values in their own migration; PG can't use a new enum value in
-- the same transaction it's added.)
-- ============================================================================

alter type document_type add value if not exists 'notice_to_remedy_breach';
alter type document_type add value if not exists 'notice_to_leave';
