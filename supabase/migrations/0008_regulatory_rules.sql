-- ============================================================================
-- 0008 — regulatory_rules (QLD compliance rules engine)
-- ============================================================================
-- Deterministic, versioned regulatory data backing the @pm/rules package
-- (PM-Manager_Build_Spec.md §4 + §6). This is jurisdiction-scoped REFERENCE
-- data, NOT agency-owned — every agency reads the same QLD rules, so there is
-- no agency_id and no per-agency RLS. Rows are selected by
-- effective_from / effective_to against the relevant date.
--
-- Versioning is append-only by policy (spec §6, §12): a changed rule is a NEW
-- row with a new effective_from; existing rows are never silently overwritten.
-- The regulatory-monitoring bot proposes changes, a human approves, and the
-- service role inserts the new version.
--
-- `value` is nullable ON PURPOSE. Where the spec named a change but withheld
-- the number (e.g. the 1 May 2025 entry-notice period / frequency cap), the
-- row is seeded with value = null + needs_human_confirmation = true so nothing
-- downstream ever guesses a regulatory fact (spec §0.3).
--
-- The CANONICAL seed lives in packages/rules/src/seed.ts (the engine reads it
-- directly today). This table mirrors that seed for DB-backed reads once a
-- Supabase project is provisioned; keep the two in sync when either changes.
-- ============================================================================

create table regulatory_rules (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null default 'QLD',
  key text not null,
  version text not null,
  value jsonb,                                   -- null when needs_human_confirmation
  effective_from date,                           -- null = in force since inception
  effective_to date,                             -- null = still in force
  source_url text,
  source_note text not null,
  needs_human_confirmation boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (jurisdiction, key, version)
);

-- Primary lookup: "the version of <key> in <jurisdiction> in force on <date>".
create index idx_regulatory_rules_lookup
  on regulatory_rules(jurisdiction, key, effective_from);

-- Global reference data: any AUTHENTICATED user may read (the dashboard shows
-- which rule version drove a decision). Writes happen only via the service
-- role, which bypasses RLS — gated by human approval in the app (spec §12).
alter table regulatory_rules enable row level security;

create policy regulatory_rules_read on regulatory_rules
  for select
  using (auth.uid() is not null);
