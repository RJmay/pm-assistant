-- ============================================================================
-- 0010 — at most one active prompt version per agency
-- ============================================================================
-- The M10 prompt-version management UI activates a version by closing the
-- current active row (active_to = now()) and appending a new active row
-- (active_to = null). Two concurrent activations could otherwise both insert,
-- leaving an agency with two simultaneously-active rows. This partial UNIQUE
-- index makes that impossible: at most one row per agency may have
-- active_to IS NULL, so the second concurrent insert fails loudly.
--
-- Global base rows (agency_id IS NULL) are not constrained here — NULLs are
-- distinct in a unique index — which is fine; the activate action only ever
-- inserts agency-scoped rows. (Supersedes the non-unique idx_prompt_versions_
-- active lookup index, which is left in place harmlessly.)
-- ============================================================================

create unique index uniq_prompt_versions_active_per_agency
  on prompt_versions(agency_id)
  where active_to is null;
