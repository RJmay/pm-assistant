-- ============================================================================
-- 0006 — weekly_digests
-- ============================================================================
-- Output of the weekly drift script (apps/worker/src/cron/weekly-drift.ts,
-- triggered Mondays 09:00 AEST = Sundays 23:00 UTC). The script computes
-- this-week-vs-4-week-baseline deltas on category mix, escalation rate,
-- do_not_send rate, and mean draft_confidence; when any metric shifts by
-- > 25% it writes a row here. Silent otherwise — rows only exist when
-- there's signal worth showing the PM.
--
-- The M8 dashboard subscribes to `status = 'open'` rows and surfaces them
-- as a tuning card; each `suggested_directions` entry has CTAs that, when
-- the PM clicks one, append to `agency_config.lean_notes` and flip status
-- to 'acted'. Dismiss → 'dismissed'.
-- ============================================================================

create type weekly_digest_status as enum ('open','acted','dismissed');

create table weekly_digests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  week_start_date date not null,
  -- {category_mix: {MAINTENANCE: 0.42, ...}, escalation_rate: 0.08, do_not_send_rate: 0.03,
  --  mean_draft_confidence: 0.71, baseline: { ... same shape ... },
  --  drafts_this_week: 14, drafts_baseline_per_week: 11.5}
  signals jsonb not null default '{}'::jsonb,
  -- [{topic, prompt: text, options: [{label, lean_to_apply}]}]
  suggested_directions jsonb not null default '[]'::jsonb,
  status weekly_digest_status not null default 'open',
  acted_at timestamptz,
  acted_by uuid references agency_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agency_id, week_start_date)
);

create index idx_weekly_digests_open
  on weekly_digests(agency_id, created_at desc)
  where status = 'open';

alter table weekly_digests enable row level security;

create policy tenant_isolation on weekly_digests
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());
