-- ============================================================================
-- 0022 — Demo mode + onboarding wizard (sales enablement, not roadmap)
-- ============================================================================
-- 1. agencies.is_demo — per-tenant demo flag. A demo tenant is hermetically
--    sealed at the transport layer: the send route and the owner-notifier check
--    this flag and NEVER call Gmail/Twilio/Resend for a demo agency (the "send"
--    resolves instantly into a sandboxed outbound row). Per-tenant (not a global
--    env var) so a demo tenant coexists with real pilots in one deployment.
-- 2. demo_scenarios — the scenario library for the live demo: 10 seeded inbound
--    emails per demo agency. Injection runs the REAL ingestion + drafting
--    pipeline; `compliance` holds rule keys/form ids resolved through @pm/rules
--    at render time (never hardcoded statutory values — spec §0.3).
-- 3. onboarding_progress — server-side wizard state for real agencies so the
--    /onboarding flow is skippable + resumable across refresh and logout.
-- Additive only; no existing tables are altered destructively.
-- ============================================================================

alter table agencies add column is_demo boolean not null default false;

-- agencies has historically had only a SELECT policy (0001), which made every
-- dashboard-side UPDATE (e.g. the onboarding wizard saving business hours /
-- the after-hours line) silently match 0 rows under RLS. Allow tenants to
-- update their OWN agency row. (The id is immutable via WITH CHECK; the
-- service-role worker is unaffected.)
create policy tenant_isolation_update on agencies
  for update
  using (id = auth_helpers.current_agency_id())
  with check (id = auth_helpers.current_agency_id());

create table demo_scenarios (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  key text not null,
  title text not null,
  description text,
  from_name text not null,
  from_address text not null,
  subject text not null,
  body text not null,
  -- Array of { ruleKey?, formId?, label } — resolved via @pm/rules in the UI.
  compliance jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  -- Injection bookkeeping: when last fired + what it produced (drives the
  -- "Surprise me" unused-scenario picker and the draft-page compliance panel).
  used_at timestamptz,
  last_email_message_id uuid references email_messages(id) on delete set null,
  last_draft_id uuid references ai_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agency_id, key)
);

create index idx_demo_scenarios_agency on demo_scenarios(agency_id, sort_order);

alter table demo_scenarios enable row level security;

create policy tenant_isolation on demo_scenarios
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create table onboarding_progress (
  agency_id uuid primary key references agencies(id) on delete cascade,
  current_step text not null default 'account',
  completed_steps jsonb not null default '[]'::jsonb,
  -- Free-form per-step state (e.g. chosen email path, CSV mapping) so a half-
  -- finished step can resume. Never store secrets here.
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table onboarding_progress enable row level security;

create policy tenant_isolation on onboarding_progress
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());
