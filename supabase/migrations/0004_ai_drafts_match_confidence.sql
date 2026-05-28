-- ============================================================================
-- 0004 — ai_drafts.match_confidence + matched_via
-- ============================================================================
-- The matcher (apps/worker/src/services/matcher.ts) resolves an inbound
-- email's property/tenant/owner via a 5-step cascade. Per ARCHITECTURE.md
-- §"Property/tenant matcher", the result's confidence is recorded on the
-- draft so the dashboard (M8) can surface low-confidence matches for PM
-- disambiguation, and so post-hoc analysis can correlate match quality
-- with draft quality.
--
-- `match_confidence` reuses the existing enum (also used by
-- email_threads.property_match_confidence).
-- `matched_via` is a new enum naming the cascade step that produced the
-- match (or `fallback` when no step matched).
-- ============================================================================

create type match_source as enum (
  'exact_email',         -- step 1: sender address → tenants/owners.email
  'thread_continuity',   -- step 2: existing email_threads row with property_id
  'subject_fuzzy',       -- step 3: subject token overlap with properties.address_line1
  'body_scan',           -- step 4: same approach on first 500 chars of body
  'fallback'             -- step 5: no confident match, needs PM triage
);

alter table ai_drafts
  add column match_confidence match_confidence not null default 'none',
  add column matched_via match_source;

-- Surface low-confidence matches in dashboard queries. Partial index keeps
-- it cheap since most drafts will be `high` (thread continuity).
create index idx_ai_drafts_low_match
  on ai_drafts(agency_id, created_at desc)
  where match_confidence in ('low','none');
