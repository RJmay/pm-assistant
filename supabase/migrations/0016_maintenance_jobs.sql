-- ============================================================================
-- 0016 — maintenance jobs (Phase 3, spec §9 "Maintenance coordination agent")
-- ============================================================================
-- A maintenance job is the durable workflow state for one maintenance request:
-- triage (EMERGENCY vs routine via the rules engine s214 list) → tradie quote
-- requests → owner approval (gated by the spending-authority threshold) →
-- scheduling → close-out. The agent runs the coordination and drafts every
-- message; the PM makes the judgement calls and approvals. Jobs are created
-- PM-initiated from a MAINTENANCE draft. Every outbound message a job produces
-- is an ai_drafts row linked back via `maintenance_job_id` — still human-sent.
-- ============================================================================

create type maintenance_classification as enum ('emergency', 'routine', 'other');

-- Coarse state machine. 'quoting' = quote requests out; 'awaiting_owner_approval'
-- = above the spending threshold, owner asked; 'scheduling'/'scheduled' = a tradie
-- is being / has been booked.
create type maintenance_job_state as enum (
  'new',
  'quoting',
  'awaiting_owner_approval',
  'approved',
  'scheduling',
  'scheduled',
  'completed',
  'cancelled'
);

-- 'not_required' when the (estimated) spend is within the PM's routine-approval
-- authority; otherwise the owner is asked and this tracks their answer.
create type maintenance_owner_approval as enum ('not_required', 'pending', 'approved', 'declined');

create table maintenance_jobs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  tenancy_id uuid references tenancies(id) on delete set null,
  -- The MAINTENANCE draft / inbound message the job was created from.
  source_draft_id uuid references ai_drafts(id) on delete set null,
  source_email_message_id uuid references email_messages(id) on delete set null,
  issue text not null,
  classification maintenance_classification not null default 'routine',
  -- e.g. "plumbing" — matched to agency_config.approved_tradies.
  trade text,
  state maintenance_job_state not null default 'new',
  -- [{id, tradie_name, trade, amount_cents?, status, requested_at, draft_id?}]
  quotes jsonb not null default '[]'::jsonb,
  owner_approval_state maintenance_owner_approval not null default 'not_required',
  approved_spend_cents integer,
  scheduled_for timestamptz,
  created_by uuid references agency_users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_maintenance_jobs_state on maintenance_jobs(agency_id, state);
create index idx_maintenance_jobs_property on maintenance_jobs(agency_id, property_id);
create index idx_maintenance_jobs_emergency
  on maintenance_jobs(agency_id, created_at desc)
  where classification = 'emergency';
-- At most one open job per source draft (a draft creates one job).
create unique index uniq_maintenance_jobs_source_draft
  on maintenance_jobs(source_draft_id)
  where source_draft_id is not null;

create trigger trg_maintenance_jobs_updated_at
  before update on maintenance_jobs
  for each row execute function tg_set_updated_at();

alter table maintenance_jobs enable row level security;

create policy tenant_isolation on maintenance_jobs
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

-- ----------------------------------------------------------------------------
-- ai_drafts: link a maintenance message back to its job + allow the new source
-- ----------------------------------------------------------------------------
alter table ai_drafts
  add column maintenance_job_id uuid references maintenance_jobs(id) on delete set null;

create index idx_ai_drafts_maintenance_job on ai_drafts(maintenance_job_id)
  where maintenance_job_id is not null;

-- Widen the source-shape guard: maintenance outbound drafts carry a recipient
-- like sequence drafts do.
alter table ai_drafts drop constraint ai_drafts_source_shape;
alter table ai_drafts
  add constraint ai_drafts_source_shape check (
    (draft_source = 'inbound_reply' and email_message_id is not null)
    or (draft_source in ('sequence', 'maintenance') and recipient_email is not null)
  );

alter publication supabase_realtime add table maintenance_jobs;
