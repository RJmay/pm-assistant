-- ============================================================================
-- 0013 — routine inspection tracking (Phase 2, spec §8 "Inspection scheduling")
-- ============================================================================
-- The inspection-scheduling sequence needs to know when a tenancy was last
-- routinely inspected so it can detect the next one falling due. We record it
-- per tenancy (entry is into the occupied premises). When null, the scanner
-- falls back to the tenancy start_date as the baseline. The PM updates this
-- after each inspection, which rolls the next cycle forward.
-- ============================================================================

alter table tenancies
  add column last_routine_inspection_date date;

create index idx_tenancies_inspection_due
  on tenancies(agency_id, last_routine_inspection_date)
  where status = 'active';
