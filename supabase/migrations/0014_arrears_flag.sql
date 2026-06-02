-- ============================================================================
-- 0014 — arrears flag (Phase 2, spec §8 "Arrears sequence")
-- ============================================================================
-- We have no payment feed yet (CRM integration is Phase 2+ adapter work), so
-- arrears are flagged MANUALLY: a PM sets `arrears_since` to the date rent fell
-- into arrears. The arrears sequence drafts a courtesy reminder per episode and
-- flags the PM to consider escalation. Clearing `arrears_since` (rent caught
-- up) closes the episode; a fresh arrears date opens a new one.
--
-- NOTE: the statutory arrears threshold for a Notice to Remedy Breach (Form 11)
-- is deliberately NOT encoded here — it isn't in the rules-engine seed, and we
-- never assert a regulatory fact the engine can't source. The reminder is a
-- courtesy; the Form 11 decision stays with the PM (and, later, the rules
-- engine once that threshold is seeded + confirmed).
-- ============================================================================

alter table tenancies
  add column arrears_since date;

create index idx_tenancies_arrears
  on tenancies(agency_id, arrears_since)
  where arrears_since is not null;
