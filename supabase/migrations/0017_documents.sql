-- ============================================================================
-- 0017 — documents (Phase 4, spec §10 "Document + compliance engine")
-- ============================================================================
-- Generated QLD statutory documents. Every statutory field, notice period and
-- date is computed by the rules engine (@pm/rules / @pm/documents) — NEVER by
-- an LLM (spec §6/§10). The document is assembled deterministically from
-- property/tenancy data + the rules in force on the generation date, and the
-- rule versions used are recorded for the audit trail.
--
-- v1 stores the rendered, print-ready document inline (`content`, HTML) rather
-- than a binary PDF in Storage — the compliance core (correct fields/dates/rule
-- versions) is identical; PDF-binary + Storage upload is a later enhancement.
-- ============================================================================

create type document_type as enum ('entry_notice', 'rent_increase_notice');
create type document_status as enum ('generated', 'sent', 'void');

create table documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  type document_type not null,
  -- The RTA form number where the action maps to one ("9"); null otherwise.
  form_id text,
  property_id uuid references properties(id) on delete set null,
  tenancy_id uuid references tenancies(id) on delete set null,
  title text not null,
  -- Every merged statutory + data value that went on the document, for audit.
  fields jsonb not null default '{}'::jsonb,
  -- Rendered, print-ready document body.
  content text not null,
  content_type text not null default 'text/html',
  -- Rules-engine versions used to compute the statutory dates/periods.
  rule_versions text[] not null default '{}',
  status document_status not null default 'generated',
  created_by uuid references agency_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_documents_agency on documents(agency_id, created_at desc);
create index idx_documents_tenancy on documents(agency_id, tenancy_id);

alter table documents enable row level security;

create policy tenant_isolation on documents
  for all
  using (agency_id = auth_helpers.current_agency_id())
  with check (agency_id = auth_helpers.current_agency_id());
