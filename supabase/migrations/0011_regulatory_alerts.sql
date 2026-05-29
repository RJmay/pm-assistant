-- ============================================================================
-- 0011 — regulatory_alerts (regulatory monitoring bot, spec §12)
-- ============================================================================
-- The monitoring bot scans QLD regulatory sources (RTA, Dept of Housing, the
-- legislation register, …) on a schedule. On a DETECTED change it invokes the
-- LLM once to summarise what changed + propose updates to regulatory_rules /
-- templates, and writes one row here for an operator to review and approve.
--
-- This is jurisdiction-scoped REFERENCE data, NOT agency-owned (no agency_id) —
-- like regulatory_rules (0008). Nothing here changes a live rule: approval
-- happens in-app and appends a new versioned regulatory_rules row (§6, §12).
-- The bot NEVER auto-updates legal data without human review (hard constraint).
-- ============================================================================

create type regulatory_alert_state as enum ('open', 'approved', 'dismissed');

create table regulatory_alerts (
  id uuid primary key default gen_random_uuid(),
  source text not null,                       -- the monitored source key (see services/monitoring/sources.ts)
  source_url text not null,
  detected_at timestamptz not null default now(),
  content_hash text not null,                 -- hash of the relevant section at detection time
  change_summary text,                        -- LLM summary of what changed (null until summarised)
  effective_date date,                        -- the change's effective date, if the LLM extracted one
  affected_modules text[] not null default '{}',
  proposed_changes jsonb not null default '{}'::jsonb,  -- proposed regulatory_rules / template diffs
  operator_review_state regulatory_alert_state not null default 'open',
  reviewed_by uuid references agency_users(id) on delete set null,
  reviewed_at timestamptz,
  client_notice_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_regulatory_alerts_open
  on regulatory_alerts(detected_at desc)
  where operator_review_state = 'open';

-- Global reference data: any authenticated user may read; writes happen via the
-- service role (the bot) / operator approval flow, which bypasses RLS.
alter table regulatory_alerts enable row level security;

create policy regulatory_alerts_read on regulatory_alerts
  for select
  using (auth.uid() is not null);
