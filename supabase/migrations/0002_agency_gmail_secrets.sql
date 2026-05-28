-- ============================================================================
-- 0002 — Per-agency Gmail refresh-token mapping
-- ============================================================================
-- Gmail OAuth refresh tokens live in `vault.secrets` (encrypted at rest with
-- the project's KMS key). This table maps `agency_id → vault.secrets.id` so
-- callers can look up an agency's refresh-token secret via FK rather than
-- parsing names.
--
-- The actual token NEVER lives in a public-schema column (per CLAUDE.md and
-- ARCHITECTURE.md). The Worker uses the service-role client to read from
-- vault.decrypted_secrets by joining on vault_secret_id.
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
