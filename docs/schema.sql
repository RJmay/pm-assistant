-- ============================================================================
-- PM Assistant — Initial Schema (v1.0)
-- ============================================================================
--
-- Multi-tenant by agency_id. RLS enforced everywhere.
-- Worker uses service-role key (bypasses RLS) and must filter agency_id
-- explicitly in every query. Dashboard uses authed JWT and relies on RLS.
--
-- Conventions:
-- - snake_case
-- - All tables have id (uuid), agency_id (uuid), created_at (timestamptz)
-- - Soft delete via `archived_at` where appropriate, hard delete via cascade otherwise
--
-- ERD (text):
--   agencies 1—1 agency_config
--   agencies 1—* agency_users
--   agencies 1—* owners 1—* properties 1—* tenancies 1—* tenants
--   agencies 1—* owner_notification_preferences (owner or property scoped)
--   agencies 1—* email_threads 1—* email_messages
--   email_messages 1—1 ai_drafts (inbound only)
--   ai_drafts 1—* draft_edits
--   ai_drafts 1—* notification_log
--   agencies 1—* prompt_versions
--   agencies 1—* audit_log
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ============================================================================
-- HELPER: current agency from JWT
-- ============================================================================
create schema if not exists auth_helpers;

create or replace function auth_helpers.current_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select nullif(
    coalesce(
      (current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'agency_id'),
      (current_setting('request.jwt.claim.app_metadata', true)::jsonb->>'agency_id')
    ),
    ''
  )::uuid;
$$;

-- ============================================================================
-- ENUMS
-- ============================================================================
create type agency_status as enum ('active', 'suspended', 'archived');
create type agency_user_role as enum ('pm', 'principal', 'admin');
create type tenancy_status as enum ('draft', 'active', 'ending', 'ended');
create type rent_frequency as enum ('weekly', 'fortnightly', 'monthly');
create type agreement_type as enum ('fixed', 'periodic');

create type owner_notification_profile as enum (
  'immediate',
  'business_hours',
  'safety_critical_only',
  'email_only',
  'pm_proxy'
);

create type email_direction as enum ('inbound', 'outbound');

create type draft_category as enum (
  'MAINTENANCE','RENT','LEASE','COMPLAINT','ADMIN','OTHER'
);
create type draft_priority as enum (
  'STANDARD','PRIORITY','EMERGENCY_ALERT'
);
create type escalation_flag as enum (
  'NONE','WELFARE','LEGAL','REPUTATIONAL','INCIDENT'
);
create type confidence_level as enum ('HIGH','MEDIUM','LOW');
create type draft_status as enum (
  'pending','edited','sent','discarded','do_not_send'
);
create type match_confidence as enum ('high','medium','low','none');

create type notification_channel as enum ('sms','email','call','digest');
create type notification_status as enum (
  'queued','sent','failed','suppressed'
);

create type audit_actor_type as enum ('user','system','ai');

-- ============================================================================
-- AGENCIES
-- ============================================================================
create table agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  suburb text,
  business_hours text,
  after_hours_emergency_line text,
  principal_email text,
  status agency_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_agencies_status on agencies(status);

-- ============================================================================
-- AGENCY USERS
-- ============================================================================
create table agency_users (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  auth_user_id uuid unique,    -- references auth.users(id), enforced by trigger or app
  email text not null,
  full_name text not null,
  role agency_user_role not null,
  gmail_address text,
  gmail_oauth_vault_key text,  -- pointer to Supabase Vault secret
  signature_block text,        -- their email signature, used in drafts
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (agency_id, email)
);

create index idx_agency_users_agency on agency_users(agency_id);
create index idx_agency_users_auth on agency_users(auth_user_id);

-- ============================================================================
-- AGENCY CONFIG (gets templated into the prompt)
-- ============================================================================
create table agency_config (
  agency_id uuid primary key references agencies(id) on delete cascade,
  voice_samples jsonb not null default '[]'::jsonb,
  -- [{label: "Sample 1 - warm acknowledgement", body: "..."}, ...]

  approved_tradies jsonb not null default '[]'::jsonb,
  -- [{trade: "plumbing", name: "X", business_hours_contact: "...", after_hours_contact: "..."}]

  nominated_repairer jsonb,
  -- {name: "X", number: "0400..."}

  routine_approval_threshold_cents integer not null default 25000,
  written_quote_threshold_cents integer not null default 50000,

  per_owner_quote_exceptions jsonb not null default '[]'::jsonb,
  -- [{owner_id: uuid, threshold_cents: 20000, note: "..."}]

  house_rules text,
  pm_signoff_default text,

  active_prompt_version_id uuid,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- OWNERS
-- ============================================================================
create table owners (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_owners_agency on owners(agency_id) where archived_at is null;
create index idx_owners_email on owners(agency_id, lower(email)) where email is not null;

-- ============================================================================
-- PROPERTIES
-- ============================================================================
create table properties (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  owner_id uuid references owners(id) on delete set null,
  address_line1 text not null,
  address_line2 text,
  suburb text,
  postcode text,
  state text not null default 'QLD',
  body_corporate_managed boolean default false,
  body_corporate_agent text,
  managing_pm_id uuid references agency_users(id) on delete set null,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_properties_agency on properties(agency_id) where archived_at is null;
create index idx_properties_owner on properties(owner_id);
create index idx_properties_address on properties using gin (
  to_tsvector('english', address_line1 || ' ' || coalesce(suburb, ''))
);

-- ============================================================================
-- TENANCIES
-- ============================================================================
create table tenancies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  status tenancy_status not null default 'draft',
  start_date date,
  end_date date,
  rent_amount_cents integer,
  rent_frequency rent_frequency,
  agreement_type agreement_type,
  last_rent_increase_date date,
  bond_amount_cents integer,
  bond_rta_reference text,
  created_at timestamptz not null default now()
);

create index idx_tenancies_property on tenancies(property_id);
create index idx_tenancies_status on tenancies(agency_id, status);

-- ============================================================================
-- TENANTS
-- ============================================================================
create table tenants (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  tenancy_id uuid references tenancies(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  is_primary boolean default false,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_tenants_tenancy on tenants(tenancy_id);
create index idx_tenants_email on tenants(agency_id, lower(email)) where email is not null;

-- ============================================================================
-- OWNER NOTIFICATION PREFERENCES
-- ============================================================================
create table owner_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  owner_id uuid references owners(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  profile owner_notification_profile not null default 'immediate',
  notification_channels jsonb not null default '["sms","email"]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  check (owner_id is not null or property_id is not null)
);

create unique index uq_owner_prefs_owner
  on owner_notification_preferences(agency_id, owner_id)
  where property_id is null and owner_id is not null;

create unique index uq_owner_prefs_property
  on owner_notification_preferences(agency_id, property_id)
  where property_id is not null;

-- ============================================================================
-- PROMPT VERSIONS (per-agency, plus global base)
-- ============================================================================
create table prompt_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id) on delete cascade,  -- null = global base
  version text not null,                                      -- e.g., "2.1"
  content text not null,
  active_from timestamptz not null default now(),
  active_to timestamptz,
  created_by uuid references agency_users(id),
  notes text,
  created_at timestamptz not null default now()
);

create index idx_prompt_versions_active
  on prompt_versions(agency_id)
  where active_to is null;

-- FK for agency_config.active_prompt_version_id (deferred — needed because
-- prompt_versions references agency_config indirectly)
alter table agency_config
  add constraint fk_agency_config_prompt_version
  foreign key (active_prompt_version_id)
  references prompt_versions(id)
  on delete set null;

-- ============================================================================
-- EMAIL THREADS
-- ============================================================================
create table email_threads (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  gmail_thread_id text not null,
  property_id uuid references properties(id) on delete set null,
  property_match_confidence match_confidence not null default 'none',
  subject text,
  participants jsonb not null default '[]'::jsonb,
  -- [{name, email, role: 'tenant'|'owner'|'tradie'|'pm'|'other'}]
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, gmail_thread_id)
);

create index idx_email_threads_agency on email_threads(agency_id);
create index idx_email_threads_property on email_threads(property_id);
create index idx_email_threads_last_message on email_threads(agency_id, last_message_at desc);

-- ============================================================================
-- EMAIL MESSAGES
-- ============================================================================
create table email_messages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  thread_id uuid not null references email_threads(id) on delete cascade,
  gmail_message_id text not null,
  gmail_history_id bigint,
  direction email_direction not null,
  from_name text,
  from_address text not null,
  to_addresses jsonb not null default '[]'::jsonb,
  cc_addresses jsonb not null default '[]'::jsonb,
  bcc_addresses jsonb not null default '[]'::jsonb,
  subject text,
  body_plain text,
  body_html text,
  message_id_header text,           -- RFC Message-ID
  in_reply_to text,
  references_headers text[],
  attachments jsonb not null default '[]'::jsonb,
  -- [{filename, mime_type, size_bytes, gmail_attachment_id}]
  received_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, gmail_message_id)
);

create index idx_email_messages_thread on email_messages(thread_id);
create index idx_email_messages_agency on email_messages(agency_id, received_at desc);
create index idx_email_messages_from on email_messages(agency_id, lower(from_address));

-- ============================================================================
-- AGENCY EMAIL STATE (Gmail watch + history tracking)
-- ============================================================================
create table agency_email_state (
  agency_id uuid primary key references agencies(id) on delete cascade,
  mailbox_address text not null,
  last_history_id bigint,
  watch_expires_at timestamptz,
  pubsub_subscription text,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- AI DRAFTS
-- ============================================================================
create table ai_drafts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  email_message_id uuid not null references email_messages(id) on delete cascade,

  -- structured output from Claude
  category draft_category not null,
  category_confidence confidence_level not null,
  priority draft_priority not null,
  escalation_flag escalation_flag not null default 'NONE',
  emergency_landlord_alert boolean not null default false,
  do_not_send boolean not null default false,
  draft_confidence confidence_level not null,

  -- draft content
  draft_subject text,
  draft_body text,
  pm_review_notes jsonb not null default '[]'::jsonb,    -- array of strings

  -- metadata
  model_used text not null,
  prompt_version_id uuid references prompt_versions(id),
  raw_response jsonb,                                     -- full Claude response for audit
  status draft_status not null default 'pending',
  assigned_pm_id uuid references agency_users(id),
  sent_at timestamptz,
  sent_gmail_message_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_message_id)                               -- one draft per inbound
);

create index idx_ai_drafts_queue
  on ai_drafts(agency_id, priority, created_at)
  where status = 'pending';
create index idx_ai_drafts_escalation
  on ai_drafts(agency_id, escalation_flag)
  where escalation_flag <> 'NONE';
create index idx_ai_drafts_assigned on ai_drafts(assigned_pm_id, status);

-- ============================================================================
-- DRAFT EDITS (diff history)
-- ============================================================================
create table draft_edits (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  draft_id uuid not null references ai_drafts(id) on delete cascade,
  edited_by uuid not null references agency_users(id),
  previous_subject text,
  new_subject text,
  previous_body text,
  new_body text,
  edited_at timestamptz not null default now()
);

create index idx_draft_edits_draft on draft_edits(draft_id, edited_at desc);

-- ============================================================================
-- NOTIFICATION LOG
-- ============================================================================
create table notification_log (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  owner_id uuid references owners(id),
  property_id uuid references properties(id),
  triggered_by_draft_id uuid references ai_drafts(id),
  channel notification_channel not null,
  recipient text not null,
  body text,
  status notification_status not null,
  suppression_reason text,
  profile_applied owner_notification_profile,
  provider_message_id text,                              -- Twilio SID, Resend id, etc.
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_agency on notification_log(agency_id, created_at desc);
create index idx_notifications_owner on notification_log(owner_id, created_at desc);
create index idx_notifications_scheduled
  on notification_log(scheduled_for)
  where status = 'queued';

-- ============================================================================
-- MODEL CALLS (raw Claude request/response storage for audit + drift detection)
-- ============================================================================
create table model_calls (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  draft_id uuid references ai_drafts(id) on delete set null,
  model text not null,
  prompt_version_id uuid references prompt_versions(id),
  request jsonb not null,
  response jsonb not null,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index idx_model_calls_agency on model_calls(agency_id, created_at desc);
create index idx_model_calls_draft on model_calls(draft_id);

-- Retention: delete after 90 days. Add a Cron Trigger or pg_cron job to enforce.

-- ============================================================================
-- AUDIT LOG
-- ============================================================================
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  actor_type audit_actor_type not null,
  actor_id text,                                          -- user uuid, "system", "ai"
  action text not null,                                   -- e.g., "draft.sent"
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_log_agency on audit_log(agency_id, created_at desc);
create index idx_audit_log_entity on audit_log(entity_type, entity_id);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
create or replace function tg_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_agencies_updated_at
  before update on agencies
  for each row execute function tg_set_updated_at();

create trigger trg_agency_config_updated_at
  before update on agency_config
  for each row execute function tg_set_updated_at();

create trigger trg_ai_drafts_updated_at
  before update on ai_drafts
  for each row execute function tg_set_updated_at();

create trigger trg_agency_email_state_updated_at
  before update on agency_email_state
  for each row execute function tg_set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Enable RLS on every business table. Service-role bypasses; authed users
-- are scoped to their agency via the JWT claim.

alter table agencies enable row level security;
alter table agency_users enable row level security;
alter table agency_config enable row level security;
alter table owners enable row level security;
alter table properties enable row level security;
alter table tenancies enable row level security;
alter table tenants enable row level security;
alter table owner_notification_preferences enable row level security;
alter table prompt_versions enable row level security;
alter table email_threads enable row level security;
alter table email_messages enable row level security;
alter table agency_email_state enable row level security;
alter table ai_drafts enable row level security;
alter table draft_edits enable row level security;
alter table notification_log enable row level security;
alter table model_calls enable row level security;
alter table audit_log enable row level security;

-- Standard policy generator (macro-ish — just write them out):
create policy tenant_isolation_select on agencies
  for select using (id = auth_helpers.current_agency_id());

create policy tenant_isolation on agency_users
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on agency_config
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on owners
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on properties
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on tenancies
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on tenants
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on owner_notification_preferences
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on prompt_versions
  for all
  using (agency_id is null or agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on email_threads
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on email_messages
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on agency_email_state
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on ai_drafts
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on draft_edits
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on notification_log
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on model_calls
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

create policy tenant_isolation on audit_log
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

-- ============================================================================
-- REALTIME PUBLICATION (for the dashboard)
-- ============================================================================
-- Enable realtime on ai_drafts so the dashboard updates without polling.
alter publication supabase_realtime add table ai_drafts;
alter publication supabase_realtime add table notification_log;

-- ============================================================================
-- END
-- ============================================================================

-- ============================================================================
-- AGENCY GMAIL SECRETS (added in migration 0002)
-- ============================================================================
-- Maps agency_id → vault.secrets.id for per-agency Gmail refresh tokens.
-- The actual token lives in vault.secrets, encrypted at rest.
-- ============================================================================
create table agency_gmail_secrets (
  agency_id uuid primary key references agencies(id) on delete cascade,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_agency_gmail_secrets_updated_at
  before update on agency_gmail_secrets
  for each row execute function tg_set_updated_at();

alter table agency_gmail_secrets enable row level security;

create policy tenant_isolation on agency_gmail_secrets
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

-- ============================================================================
-- VAULT HELPER FUNCTIONS (added in migration 0003)
-- ============================================================================
-- Public-schema SECURITY DEFINER wrappers around vault.* so the Worker
-- (service-role) can call them via supabase-js .rpc(). Execute granted only
-- to service_role.
-- ============================================================================

create extension if not exists supabase_vault;

create or replace function public.store_gmail_refresh_token(
  p_agency_id uuid,
  p_token text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing_secret_id uuid;
  new_secret_id uuid;
  secret_name text := 'gmail_refresh_token:' || p_agency_id::text;
  secret_description text := 'Gmail refresh token for agency ' || p_agency_id::text;
begin
  select vault_secret_id into existing_secret_id
    from public.agency_gmail_secrets
    where agency_id = p_agency_id;
  if existing_secret_id is not null then
    perform vault.update_secret(existing_secret_id, p_token, secret_name, secret_description);
    update public.agency_gmail_secrets set updated_at = now() where agency_id = p_agency_id;
  else
    new_secret_id := vault.create_secret(p_token, secret_name, secret_description);
    insert into public.agency_gmail_secrets (agency_id, vault_secret_id)
      values (p_agency_id, new_secret_id);
  end if;
end;
$$;

create or replace function public.get_gmail_refresh_token(p_agency_id uuid) returns text
language sql security definer set search_path = public, vault
as $$
  select v.decrypted_secret
    from public.agency_gmail_secrets s
    join vault.decrypted_secrets v on v.id = s.vault_secret_id
    where s.agency_id = p_agency_id;
$$;

create or replace function public.delete_gmail_refresh_token(p_agency_id uuid) returns void
language plpgsql security definer set search_path = public, vault
as $$
declare existing_secret_id uuid;
begin
  select vault_secret_id into existing_secret_id
    from public.agency_gmail_secrets where agency_id = p_agency_id;
  if existing_secret_id is not null then
    delete from public.agency_gmail_secrets where agency_id = p_agency_id;
    delete from vault.secrets where id = existing_secret_id;
  end if;
end;
$$;

revoke execute on function public.store_gmail_refresh_token(uuid, text) from public;
revoke execute on function public.get_gmail_refresh_token(uuid) from public;
revoke execute on function public.delete_gmail_refresh_token(uuid) from public;
grant execute on function public.store_gmail_refresh_token(uuid, text) to service_role;
grant execute on function public.get_gmail_refresh_token(uuid) to service_role;
grant execute on function public.delete_gmail_refresh_token(uuid) to service_role;

-- ============================================================================
-- AI_DRAFTS MATCH CONFIDENCE (added in migration 0004)
-- ============================================================================
-- The matcher service records its cascade outcome on the draft so the
-- dashboard can surface low-confidence matches for PM triage. match_confidence
-- reuses the enum already defined for email_threads.property_match_confidence.
-- ============================================================================

create type match_source as enum (
  'exact_email',
  'thread_continuity',
  'subject_fuzzy',
  'body_scan',
  'fallback'
);

alter table ai_drafts
  add column match_confidence match_confidence not null default 'none',
  add column matched_via match_source;

create index idx_ai_drafts_low_match
  on ai_drafts(agency_id, created_at desc)
  where match_confidence in ('low','none');

-- ============================================================================
-- AGENCY_CONFIG.LEAN_NOTES (added in migration 0005)
-- ============================================================================
-- PM-authored directional notes templated into the system prompt at draft
-- time. Populated by the weekly digest flow → M8 dashboard card → PM clicks
-- a suggested direction. assemble() filters entries by expires_at.
--
-- Each entry: {id, topic, lean, set_at, set_by, expires_at}.
-- Default expiry is 60 days; leans decay rather than silently distorting
-- drafts months later.
-- ============================================================================

alter table agency_config
  add column lean_notes jsonb not null default '[]'::jsonb;

-- ============================================================================
-- WEEKLY_DIGESTS (added in migration 0006)
-- ============================================================================
-- Output of the weekly drift script (cron: Mon 09:00 AEST). Compares this
-- week's draft signals against a 4-week baseline; rows are only inserted
-- when at least one metric shifts >25%. The M8 dashboard surfaces open
-- rows as tuning cards.
-- ============================================================================

create type weekly_digest_status as enum ('open','acted','dismissed');

create table weekly_digests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  week_start_date date not null,
  signals jsonb not null default '{}'::jsonb,
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

-- ============================================================================
-- AI_DRAFTS.SAFETY_CRITICAL (added in migration 0007)
-- ============================================================================
-- Boolean from the drafter's structured output. Gates the
-- `safety_critical_only` owner notification profile: when set, the alert
-- fires; when unset, the alert is suppressed (and logged in notification_log).
-- ============================================================================

alter table ai_drafts
  add column safety_critical boolean not null default false;

create index idx_ai_drafts_safety_critical
  on ai_drafts(agency_id, created_at desc)
  where safety_critical = true;

-- ============================================================================
-- REGULATORY_RULES (added in migration 0008)
-- ============================================================================
-- Deterministic, versioned QLD compliance data backing @pm/rules
-- (PM-Manager_Build_Spec.md §4, §6). Jurisdiction-scoped REFERENCE data, NOT
-- agency-owned (no agency_id) — every agency reads the same rules. Versioning
-- is append-only: a changed rule is a new row with a new effective_from;
-- existing rows are never overwritten (the monitoring bot proposes, a human
-- approves, the service role inserts). `value` is nullable: where the spec
-- named a change but withheld the number, the row carries value = null +
-- needs_human_confirmation = true so nothing downstream guesses a regulatory
-- fact (spec §0.3). Canonical seed: packages/rules/src/seed.ts.
-- ============================================================================

create table regulatory_rules (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null default 'QLD',
  key text not null,
  version text not null,
  value jsonb,
  effective_from date,
  effective_to date,
  source_url text,
  source_note text not null,
  needs_human_confirmation boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (jurisdiction, key, version)
);

create index idx_regulatory_rules_lookup
  on regulatory_rules(jurisdiction, key, effective_from);

alter table regulatory_rules enable row level security;

create policy regulatory_rules_read on regulatory_rules
  for select
  using (auth.uid() is not null);

-- ============================================================================
-- BOUNCE / DSN TRACKING (added in migration 0009)
-- ============================================================================
-- A bounced reply's DSN lands in the watched agency mailbox and is ingested by
-- the inbound pipeline. We detect it, link it to the originating draft via the
-- sent message id, mark the draft bounced, and skip drafting on the DSN itself.
-- ============================================================================

alter table ai_drafts
  add column bounced_at timestamptz,
  add column bounce_detail text;

create index idx_ai_drafts_bounced
  on ai_drafts(agency_id, bounced_at desc)
  where bounced_at is not null;

alter table email_messages
  add column is_bounce boolean not null default false,
  add column bounce_of_email_message_id uuid references email_messages(id) on delete set null;

-- ============================================================================
-- PROMPT_VERSIONS active-uniqueness (added in migration 0010)
-- ============================================================================
-- At most one active prompt version per agency. The M10 activation flow closes
-- the current active row (active_to = now()) and appends a new one; this index
-- stops two concurrent activations leaving an agency with two active rows.
-- Global base rows (agency_id null) are unconstrained (NULLs are distinct).
-- ============================================================================

create unique index uniq_prompt_versions_active_per_agency
  on prompt_versions(agency_id)
  where active_to is null;

-- ============================================================================
-- REGULATORY_ALERTS (added in migration 0011) — monitoring bot, spec §12
-- ============================================================================
-- Jurisdiction-scoped REFERENCE data (no agency_id). The monitoring bot writes
-- one row per detected QLD regulatory-source change with an LLM summary +
-- proposed rule/template diffs; an operator reviews + approves (which appends a
-- new versioned regulatory_rules row). Never auto-updates live legal data.
-- ============================================================================

create type regulatory_alert_state as enum ('open', 'approved', 'dismissed');

create table regulatory_alerts (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_url text not null,
  detected_at timestamptz not null default now(),
  content_hash text not null,
  change_summary text,
  effective_date date,
  affected_modules text[] not null default '{}',
  proposed_changes jsonb not null default '{}'::jsonb,
  operator_review_state regulatory_alert_state not null default 'open',
  reviewed_by uuid references agency_users(id) on delete set null,
  reviewed_at timestamptz,
  client_notice_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_regulatory_alerts_open
  on regulatory_alerts(detected_at desc)
  where operator_review_state = 'open';

alter table regulatory_alerts enable row level security;

create policy regulatory_alerts_read on regulatory_alerts
  for select
  using (auth.uid() is not null);

-- ============================================================================
-- OUTBOUND SEQUENCES (added in migration 0012) — Phase 2, spec §8
-- ============================================================================
-- Proactive outbound work (arrears, lease renewals, inspections, owner
-- updates) is detected on a schedule and drafted into the SAME review queue
-- as inbound replies — still human-sent (§13). An outbound draft is an
-- ai_drafts row with no inbound email_message_id and a recipient of its own.
-- `sequences` holds per-agency enablement/config; `sequence_runs` is one
-- durable, idempotent run per detected cycle (unique on dedupe_key).
-- ============================================================================

create type draft_source as enum ('inbound_reply', 'sequence');

alter table ai_drafts
  alter column email_message_id drop not null;

alter table ai_drafts
  add column draft_source draft_source not null default 'inbound_reply',
  add column sequence_run_id uuid,
  add column recipient_email text,
  add column recipient_name text,
  add column tenancy_id uuid references tenancies(id) on delete set null,
  add column property_id uuid references properties(id) on delete set null;

alter table ai_drafts
  add constraint ai_drafts_source_shape check (
    (draft_source = 'inbound_reply' and email_message_id is not null)
    or (draft_source = 'sequence' and recipient_email is not null)
  );

create index idx_ai_drafts_sequence_run on ai_drafts(sequence_run_id)
  where sequence_run_id is not null;

create type sequence_type as enum (
  'arrears',
  'lease_renewal',
  'inspection',
  'owner_update'
);

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
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, type)
);

create index idx_sequences_agency_active on sequences(agency_id) where is_active;

create table sequence_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  sequence_id uuid references sequences(id) on delete set null,
  type sequence_type not null,
  tenancy_id uuid references tenancies(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  owner_id uuid references owners(id) on delete cascade,
  dedupe_key text not null,
  state sequence_run_state not null default 'pending',
  step integer not null default 0,
  next_action_at timestamptz,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, dedupe_key)
);

create index idx_sequence_runs_agency_state on sequence_runs(agency_id, state);
create index idx_sequence_runs_next_action on sequence_runs(next_action_at)
  where state in ('active', 'awaiting_response');

alter table ai_drafts
  add constraint ai_drafts_sequence_run_id_fkey
  foreign key (sequence_run_id) references sequence_runs(id) on delete set null;

create trigger trg_sequences_updated_at
  before update on sequences
  for each row execute function tg_set_updated_at();

create trigger trg_sequence_runs_updated_at
  before update on sequence_runs
  for each row execute function tg_set_updated_at();

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

-- ============================================================================
-- ROUTINE INSPECTION TRACKING (added in migration 0013) — Phase 2, spec §8
-- ============================================================================
-- Last routine-inspection date per tenancy, so the inspection-scheduling
-- sequence can detect the next inspection falling due. Null → the scanner
-- uses the tenancy start_date as the baseline.
-- ============================================================================

alter table tenancies
  add column last_routine_inspection_date date;

create index idx_tenancies_inspection_due
  on tenancies(agency_id, last_routine_inspection_date)
  where status = 'active';

-- ============================================================================
-- ARREARS FLAG (added in migration 0014) — Phase 2, spec §8
-- ============================================================================
-- Manual arrears flag (no payment feed yet). A PM sets `arrears_since` to the
-- date rent fell into arrears; the arrears sequence drafts a courtesy reminder.
-- The statutory Form 11 threshold is intentionally NOT encoded (not in the
-- rules-engine seed) — escalation stays a PM decision.
-- ============================================================================

alter table tenancies
  add column arrears_since date;

create index idx_tenancies_arrears
  on tenancies(agency_id, arrears_since)
  where arrears_since is not null;

-- ============================================================================
-- MAINTENANCE JOBS (added in migrations 0015 + 0016) — Phase 3, spec §9
-- ============================================================================
-- Durable workflow state for a maintenance request: triage (s214) → tradie
-- quote requests → owner approval (spending-authority gated) → scheduling →
-- close-out. Created PM-initiated from a MAINTENANCE draft. Every outbound
-- message a job produces is an ai_drafts row linked via maintenance_job_id.
-- 0015 adds the 'maintenance' draft_source value (separate migration so PG can
-- commit the enum value before 0016 uses it).
-- ============================================================================

alter type draft_source add value if not exists 'maintenance';

create type maintenance_classification as enum ('emergency', 'routine', 'other');

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

create type maintenance_owner_approval as enum ('not_required', 'pending', 'approved', 'declined');

create table maintenance_jobs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  tenancy_id uuid references tenancies(id) on delete set null,
  source_draft_id uuid references ai_drafts(id) on delete set null,
  source_email_message_id uuid references email_messages(id) on delete set null,
  issue text not null,
  classification maintenance_classification not null default 'routine',
  trade text,
  state maintenance_job_state not null default 'new',
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

alter table ai_drafts
  add column maintenance_job_id uuid references maintenance_jobs(id) on delete set null;

create index idx_ai_drafts_maintenance_job on ai_drafts(maintenance_job_id)
  where maintenance_job_id is not null;

alter table ai_drafts drop constraint ai_drafts_source_shape;
alter table ai_drafts
  add constraint ai_drafts_source_shape check (
    (draft_source = 'inbound_reply' and email_message_id is not null)
    or (draft_source in ('sequence', 'maintenance') and recipient_email is not null)
  );

alter publication supabase_realtime add table maintenance_jobs;
