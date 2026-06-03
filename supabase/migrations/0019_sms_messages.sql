-- ============================================================================
-- 0019 — SMS messages (Phase 5, spec §11 "Voice/SMS front door")
-- ============================================================================
-- Inbound SMS to an agency's number is captured here, classified (status query
-- vs general vs escalation), linked to the tenant/property/job when we can, and
-- given a DRAFTED reply. Per the hard rule (§13) nothing is auto-sent: the PM
-- reviews + sends the reply (which writes an outbound row). Escalation cases
-- (DV, self-harm, QCAT, etc.) are flagged and NOT auto-drafted — a human takes
-- them. Full transcript is retained for audit (§11 DoD).
-- ============================================================================

create type sms_direction as enum ('inbound', 'outbound');

-- received: just captured. drafted: a reply is queued for the PM. sent: the PM
-- sent the reply. escalated: flagged for a human, no auto-draft. ignored: PM
-- dismissed it.
create type sms_status as enum ('received', 'drafted', 'sent', 'escalated', 'ignored');

create type sms_intent as enum ('status_query', 'maintenance', 'general', 'escalation', 'unknown');

create table sms_messages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  direction sms_direction not null,
  from_number text not null,
  to_number text not null,
  body text not null,
  provider_sid text, -- Twilio MessageSid
  -- inbound classification + resolved context
  intent sms_intent,
  escalation_flag escalation_flag not null default 'NONE',
  tenant_id uuid references tenants(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  maintenance_job_id uuid references maintenance_jobs(id) on delete set null,
  -- the drafted reply (inbound) awaiting PM review + send
  draft_reply text,
  status sms_status not null default 'received',
  -- outbound rows link back to the inbound they answer
  reply_to_sms_id uuid references sms_messages(id) on delete set null,
  sent_by uuid references agency_users(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_sms_messages_agency on sms_messages(agency_id, created_at desc);
create index idx_sms_messages_review
  on sms_messages(agency_id, created_at desc)
  where direction = 'inbound' and status in ('received', 'drafted', 'escalated');
create index idx_sms_messages_tenant on sms_messages(agency_id, tenant_id);

alter table sms_messages enable row level security;

create policy tenant_isolation on sms_messages
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());

-- Realtime so the SMS review list updates live.
alter publication supabase_realtime add table sms_messages;
