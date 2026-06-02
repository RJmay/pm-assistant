-- ============================================================================
-- 0012 — outbound sequences foundation (Phase 2)
-- ============================================================================
-- PM-Manager_Build_Spec.md §8: proactive outbound work (arrears, lease
-- renewals, inspections, owner updates) is detected on a schedule and drafted
-- into the SAME review queue as inbound replies — still human-sent, never
-- auto-sent (§13). To reuse the entire ai_drafts → review → edit → send →
-- audit → realtime stack rather than duplicating it, an outbound draft is just
-- an `ai_drafts` row with no inbound `email_message_id` and a `recipient_email`
-- of its own. The spec's data model (§4) anticipates this:
-- "drafts — inbound_email_id (nullable for outbound)".
--
-- This migration:
--   1. Loosens ai_drafts so a draft can be outbound (no inbound message), and
--      carries its own recipient + the entity it concerns + a sequence link.
--   2. Adds `sequences` (per-agency enablement/config) and `sequence_runs`
--      (one durable run per detected cycle, idempotent via a dedupe_key).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ai_drafts — support outbound (sequence) drafts
-- ----------------------------------------------------------------------------
create type draft_source as enum ('inbound_reply', 'sequence');

alter table ai_drafts
  -- An outbound draft has no inbound message to reply to.
  alter column email_message_id drop not null;

alter table ai_drafts
  add column draft_source draft_source not null default 'inbound_reply',
  add column sequence_run_id uuid,          -- FK added once sequence_runs exists
  add column recipient_email text,          -- who an outbound draft is addressed to
  add column recipient_name text,
  add column tenancy_id uuid references tenancies(id) on delete set null,
  add column property_id uuid references properties(id) on delete set null;

-- Every draft is either an inbound reply (has an inbound message) or a sequence
-- draft (has its own recipient). Belt-and-braces against a malformed insert —
-- existing rows are all inbound_reply with a non-null email_message_id, so they
-- satisfy this immediately.
alter table ai_drafts
  add constraint ai_drafts_source_shape check (
    (draft_source = 'inbound_reply' and email_message_id is not null)
    or (draft_source = 'sequence' and recipient_email is not null)
  );

create index idx_ai_drafts_sequence_run on ai_drafts(sequence_run_id)
  where sequence_run_id is not null;

-- ----------------------------------------------------------------------------
-- 2. sequences — per-agency enablement + config
-- ----------------------------------------------------------------------------
create type sequence_type as enum (
  'arrears',
  'lease_renewal',
  'inspection',
  'owner_update'
);

-- A run's lifecycle. A scan opens a run ('pending'), queues the first draft and
-- moves it to 'awaiting_response'; chasers/closeout advance it; an escalation
-- diverts it to 'escalated' for the PM. 'completed'/'cancelled' are terminal.
create type sequence_run_state as enum (
  'pending',
  'active',
  'awaiting_response',
  'completed',
  'cancelled',
  'escalated'
);

create table sequences (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  type sequence_type not null,
  -- e.g. {lead_days: 90} for lease_renewal. Defaults live in code; this is the
  -- per-agency override. Absence of a row means "use code defaults, enabled".
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, type)
);

create index idx_sequences_agency_active on sequences(agency_id) where is_active;

-- ----------------------------------------------------------------------------
-- 3. sequence_runs — one durable run per detected cycle
-- ----------------------------------------------------------------------------
create table sequence_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  sequence_id uuid references sequences(id) on delete set null,
  type sequence_type not null,
  -- The entity the run is about. tenancy for renewal/arrears/inspection;
  -- owner for owner_update. Both nullable so each type fills what it needs.
  tenancy_id uuid references tenancies(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  owner_id uuid references owners(id) on delete cascade,
  -- Deterministic per-(entity, cycle) key so a re-scan never opens a second run
  -- for the same cycle. e.g. 'lease_renewal:<tenancy_id>:<lease_end_date>'.
  dedupe_key text not null,
  state sequence_run_state not null default 'pending',
  step integer not null default 0,
  next_action_at timestamptz,
  -- Append-only step log: [{at, step, action, draft_id?, note?}]
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, dedupe_key)
);

create index idx_sequence_runs_agency_state on sequence_runs(agency_id, state);
create index idx_sequence_runs_next_action on sequence_runs(next_action_at)
  where state in ('active', 'awaiting_response');

-- Now that sequence_runs exists, link drafts back to their run.
alter table ai_drafts
  add constraint ai_drafts_sequence_run_id_fkey
  foreign key (sequence_run_id) references sequence_runs(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 4. updated_at triggers
-- ----------------------------------------------------------------------------
create trigger trg_sequences_updated_at
  before update on sequences
  for each row execute function tg_set_updated_at();

create trigger trg_sequence_runs_updated_at
  before update on sequence_runs
  for each row execute function tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. RLS — same tenant-isolation pattern as every business table
-- ----------------------------------------------------------------------------
alter table sequences enable row level security;
alter table sequence_runs enable row level security;

create policy tenant_isolation on sequences
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on sequence_runs
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());
