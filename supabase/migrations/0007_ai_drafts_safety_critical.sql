-- ============================================================================
-- 0007 — ai_drafts.safety_critical
-- ============================================================================
-- The drafter's structured output gains a `safety_critical` boolean that gates
-- the `safety_critical_only` owner notification profile (ARCHITECTURE.md
-- §"Owner notification routing"). True when the AI assesses the property as
-- unsafe / insecure / structurally compromised / insurance-relevant. Persisted
-- so the dashboard + notifier + post-hoc analytics can reason about it without
-- re-parsing the draft.
--
-- Default false so legacy rows (none yet) remain consistent. The column is
-- NOT NULL with a default; new drafter responses must include it (enforced by
-- @pm/shared submitDraftSchema).
-- ============================================================================

alter table ai_drafts
  add column safety_critical boolean not null default false;

-- Useful for the safety_critical_only suppression analysis later.
create index idx_ai_drafts_safety_critical
  on ai_drafts(agency_id, created_at desc)
  where safety_critical = true;
