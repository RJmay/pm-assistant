-- ============================================================================
-- 0015 — draft_source += 'maintenance' (Phase 3, spec §9)
-- ============================================================================
-- Maintenance coordination produces outbound drafts too (tradie quote requests,
-- owner-approval requests). They reuse the ai_drafts outbound mechanism, so they
-- need a distinct `draft_source` value. Postgres requires a new enum value to be
-- committed before it can be USED — so this is its own migration (its own
-- transaction), separate from 0016 which references the value.
-- ============================================================================

alter type draft_source add value if not exists 'maintenance';
