-- ============================================================================
-- 0003 — Vault helper functions for Gmail refresh tokens
-- ============================================================================
-- vault.create_secret / vault.update_secret / vault.decrypted_secrets are not
-- directly callable via PostgREST's RPC mechanism (they live in the vault
-- schema; PostgREST exposes the `public` schema by default). These wrappers
-- run as SECURITY DEFINER so the service-role client can invoke them.
--
-- Execute is granted only to service_role — the dashboard's authed JWT must
-- not be able to read or write per-agency Gmail tokens directly.
-- ============================================================================

create extension if not exists supabase_vault;

-- ----------------------------------------------------------------------------
-- store_gmail_refresh_token: create-or-update in Vault + sync mapping row
-- ----------------------------------------------------------------------------
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
    update public.agency_gmail_secrets
      set updated_at = now()
      where agency_id = p_agency_id;
  else
    new_secret_id := vault.create_secret(p_token, secret_name, secret_description);
    insert into public.agency_gmail_secrets (agency_id, vault_secret_id)
      values (p_agency_id, new_secret_id);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- get_gmail_refresh_token: decrypted lookup via FK join
-- ----------------------------------------------------------------------------
create or replace function public.get_gmail_refresh_token(
  p_agency_id uuid
) returns text
language sql
security definer
set search_path = public, vault
as $$
  select v.decrypted_secret
    from public.agency_gmail_secrets s
    join vault.decrypted_secrets v on v.id = s.vault_secret_id
    where s.agency_id = p_agency_id;
$$;

-- ----------------------------------------------------------------------------
-- delete_gmail_refresh_token: remove mapping + underlying vault secret
-- ----------------------------------------------------------------------------
create or replace function public.delete_gmail_refresh_token(
  p_agency_id uuid
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing_secret_id uuid;
begin
  select vault_secret_id into existing_secret_id
    from public.agency_gmail_secrets
    where agency_id = p_agency_id;
  if existing_secret_id is not null then
    delete from public.agency_gmail_secrets where agency_id = p_agency_id;
    delete from vault.secrets where id = existing_secret_id;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Restrict execute to service_role.
-- ----------------------------------------------------------------------------
revoke execute on function public.store_gmail_refresh_token(uuid, text) from public;
revoke execute on function public.get_gmail_refresh_token(uuid) from public;
revoke execute on function public.delete_gmail_refresh_token(uuid) from public;
grant execute on function public.store_gmail_refresh_token(uuid, text) to service_role;
grant execute on function public.get_gmail_refresh_token(uuid) to service_role;
grant execute on function public.delete_gmail_refresh_token(uuid) to service_role;
