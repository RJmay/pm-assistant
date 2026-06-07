-- ============================================================================
-- 0020 — Form 13 document type (Phase 4 follow-up, spec §10)
-- ============================================================================
-- Notice of intention to leave (Form 13) — the TENANT's notice to the
-- lessor/agent. Its statutory notice periods are RTA-confirmed in @pm/rules.
-- (Adding the enum value in its own migration; PG can't use a new enum value
-- in the same transaction it's added.)
-- ============================================================================

alter type document_type add value if not exists 'notice_of_intention_to_leave';
