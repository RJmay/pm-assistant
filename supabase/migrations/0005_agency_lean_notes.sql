-- ============================================================================
-- 0005 — agency_config.lean_notes
-- ============================================================================
-- PM-authored "leans" — short directional notes that get templated into the
-- system prompt at draft time. Populated by the weekly digest flow
-- (apps/worker/src/cron/weekly-drift.ts → M8 dashboard card → PM clicks a
-- suggested direction → writes a lean_notes entry).
--
-- Shape (each entry):
--   {
--     id: uuid,
--     topic: text,          -- short label, e.g. "maintenance assertiveness"
--     lean: text,           -- the directive, e.g. "Be slightly more assertive about quoting timeframes"
--     set_at: timestamptz,
--     set_by: uuid | null,  -- agency_users.id (null when system-suggested + auto-applied)
--     expires_at: timestamptz  -- assemble() filters out expired entries
--   }
--
-- assemble() (packages/prompts/src/assemble.ts) renders active (non-expired)
-- entries as a markdown sublist under `[LEAN_NOTES]` in v2.2 of the base
-- prompt. Default expiry is 60 days from set_at, chosen so leans decay
-- automatically rather than silently distorting drafts months later.
-- ============================================================================

alter table agency_config
  add column lean_notes jsonb not null default '[]'::jsonb;
