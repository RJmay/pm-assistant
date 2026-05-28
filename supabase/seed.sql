-- ============================================================================
-- PM Assistant — Seed (Sunshine Coast Test Agency)
-- ============================================================================
-- Fixtures for local dev + RLS smoke tests. Re-applied on every `supabase db reset`.
-- Placeholder content where M2+ will inject real data (prompts, tradies, etc.).
-- Stable UUIDs so tests can reference seeded rows.
-- ============================================================================

begin;

-- ---- agency ----
insert into agencies (id, name, suburb, business_hours, after_hours_emergency_line, principal_email)
values (
  '11111111-1111-1111-1111-111111111111',
  'Sunshine Coast Test Agency',
  'Mooloolaba',
  'Mon-Fri 9am-5pm AEST',
  '+61 7 5555 1111',
  'principal@scta-test.example'
);

-- ---- agency users (property managers) ----
insert into agency_users (id, agency_id, email, full_name, role, gmail_address, signature_block) values
  (
    '22222222-2222-2222-2222-222222222201',
    '11111111-1111-1111-1111-111111111111',
    'jess@scta-test.example',
    'Jess Bowman',
    'pm',
    'jess@scta-test.example',
    'Jess Bowman | Property Manager | Sunshine Coast Test Agency'
  ),
  (
    '22222222-2222-2222-2222-222222222202',
    '11111111-1111-1111-1111-111111111111',
    'sam@scta-test.example',
    'Sam Tran',
    'pm',
    'sam@scta-test.example',
    'Sam Tran | Property Manager | Sunshine Coast Test Agency'
  );

-- ---- owners ----
insert into owners (id, agency_id, full_name, email, phone) values
  (
    '33333333-3333-3333-3333-333333333301',
    '11111111-1111-1111-1111-111111111111',
    'Pat Nguyen',
    'pat.nguyen@example.com',
    '+61 400 100 001'
  ),
  (
    '33333333-3333-3333-3333-333333333302',
    '11111111-1111-1111-1111-111111111111',
    'Robin Albright',
    'robin.albright@example.com',
    '+61 400 100 002'
  ),
  (
    '33333333-3333-3333-3333-333333333303',
    '11111111-1111-1111-1111-111111111111',
    'Casey Brennan',
    'casey.brennan@example.com',
    '+61 400 100 003'
  );

-- ---- properties ----
-- 5 properties across 3 owners; Mountain Creek is intentionally vacant (no tenancy).
insert into properties (id, agency_id, owner_id, address_line1, suburb, postcode, managing_pm_id) values
  (
    '44444444-4444-4444-4444-444444444401',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333301',
    '12 Beach Parade',
    'Mooloolaba',
    '4557',
    '22222222-2222-2222-2222-222222222201'
  ),
  (
    '44444444-4444-4444-4444-444444444402',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333301',
    '8/47 Wharf Street',
    'Maroochydore',
    '4558',
    '22222222-2222-2222-2222-222222222201'
  ),
  (
    '44444444-4444-4444-4444-444444444403',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333302',
    '21 Bulcock Beach Esplanade',
    'Caloundra',
    '4551',
    '22222222-2222-2222-2222-222222222202'
  ),
  (
    '44444444-4444-4444-4444-444444444404',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333303',
    '3 Karawatha Drive',
    'Mountain Creek',
    '4557',
    '22222222-2222-2222-2222-222222222202'
  ),
  (
    '44444444-4444-4444-4444-444444444405',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333303',
    '17 Lindsay Road',
    'Buderim',
    '4556',
    '22222222-2222-2222-2222-222222222202'
  );

-- ---- tenancies (3 active + 1 ending fixed-term) ----
insert into tenancies (id, agency_id, property_id, status, start_date, end_date, rent_amount_cents, rent_frequency, agreement_type, last_rent_increase_date, bond_amount_cents, bond_rta_reference) values
  (
    '55555555-5555-5555-5555-555555555501',
    '11111111-1111-1111-1111-111111111111',
    '44444444-4444-4444-4444-444444444401',
    'active', '2024-06-01', '2025-06-01',
    58000, 'weekly', 'fixed', '2024-06-01', 232000, 'RTA-MOOL-001'
  ),
  (
    '55555555-5555-5555-5555-555555555502',
    '11111111-1111-1111-1111-111111111111',
    '44444444-4444-4444-4444-444444444403',
    'active', '2023-08-15', null,
    64000, 'weekly', 'periodic', '2024-08-15', 256000, 'RTA-CALO-001'
  ),
  (
    '55555555-5555-5555-5555-555555555503',
    '11111111-1111-1111-1111-111111111111',
    '44444444-4444-4444-4444-444444444405',
    'active', '2024-11-01', '2025-11-01',
    85000, 'weekly', 'fixed', '2024-11-01', 340000, 'RTA-BUDE-001'
  ),
  (
    '55555555-5555-5555-5555-555555555504',
    '11111111-1111-1111-1111-111111111111',
    '44444444-4444-4444-4444-444444444402',
    'ending', '2024-01-01', '2026-06-30',
    72000, 'weekly', 'fixed', '2025-01-01', 288000, 'RTA-MARO-001'
  );

-- ---- tenants (7 total across the 4 tenancies) ----
insert into tenants (id, agency_id, tenancy_id, full_name, email, phone, is_primary) values
  (
    '66666666-6666-6666-6666-666666666601',
    '11111111-1111-1111-1111-111111111111',
    '55555555-5555-5555-5555-555555555501',
    'Alex Tan',
    'alex.tan@example.com',
    '+61 400 200 001',
    true
  ),
  (
    '66666666-6666-6666-6666-666666666602',
    '11111111-1111-1111-1111-111111111111',
    '55555555-5555-5555-5555-555555555501',
    'Jordan Tan',
    'jordan.tan@example.com',
    '+61 400 200 002',
    false
  ),
  (
    '66666666-6666-6666-6666-666666666603',
    '11111111-1111-1111-1111-111111111111',
    '55555555-5555-5555-5555-555555555502',
    'Morgan Lee',
    'morgan.lee@example.com',
    '+61 400 200 003',
    true
  ),
  (
    '66666666-6666-6666-6666-666666666604',
    '11111111-1111-1111-1111-111111111111',
    '55555555-5555-5555-5555-555555555503',
    'Drew Patel',
    'drew.patel@example.com',
    '+61 400 200 004',
    true
  ),
  (
    '66666666-6666-6666-6666-666666666605',
    '11111111-1111-1111-1111-111111111111',
    '55555555-5555-5555-5555-555555555503',
    'Riley Connors',
    'riley.connors@example.com',
    '+61 400 200 005',
    false
  ),
  (
    '66666666-6666-6666-6666-666666666606',
    '11111111-1111-1111-1111-111111111111',
    '55555555-5555-5555-5555-555555555503',
    'Sky Mitchell',
    'sky.mitchell@example.com',
    '+61 400 200 006',
    false
  ),
  (
    '66666666-6666-6666-6666-666666666607',
    '11111111-1111-1111-1111-111111111111',
    '55555555-5555-5555-5555-555555555504',
    'Quinn Hayes',
    'quinn.hayes@example.com',
    '+61 400 200 007',
    true
  );

-- ---- prompt_versions (stub; real prompt content arrives in M2) ----
insert into prompt_versions (id, agency_id, version, content, active_from, notes) values
  (
    '88888888-8888-8888-8888-888888888888',
    '11111111-1111-1111-1111-111111111111',
    '2.1',
    '# Placeholder

Real prompt is loaded from packages/prompts/src/base/pm-drafting-v2.1.md at
runtime (Milestone 2 wires the loader). This row exists so foreign-key
references from agency_config.active_prompt_version_id and ai_drafts.prompt_version_id
can be satisfied during M1 smoke tests.',
    now(),
    'M1 seed placeholder; overwritten by M2 prompt-versioning task'
  );

-- ---- agency_config ----
insert into agency_config (
  agency_id,
  voice_samples,
  approved_tradies,
  nominated_repairer,
  routine_approval_threshold_cents,
  written_quote_threshold_cents,
  per_owner_quote_exceptions,
  house_rules,
  pm_signoff_default,
  active_prompt_version_id
)
values (
  '11111111-1111-1111-1111-111111111111',
  '[{"label":"Sample 1 - warm acknowledgement","body":"PLACEHOLDER: replace via dashboard settings"},{"label":"Sample 2 - hedged response","body":"PLACEHOLDER: replace via dashboard settings"}]'::jsonb,
  '[{"trade":"plumbing","name":"PLACEHOLDER Plumbing Co","business_hours_contact":"+61 7 5555 0001","after_hours_contact":"+61 400 555 001"},{"trade":"electrical","name":"PLACEHOLDER Electrical","business_hours_contact":"+61 7 5555 0002","after_hours_contact":"+61 400 555 002"}]'::jsonb,
  '{"name":"PLACEHOLDER Nominated Repairer","number":"+61 400 555 999"}'::jsonb,
  25000,
  50000,
  '[]'::jsonb,
  'PLACEHOLDER: house rules captured via dashboard settings (M8).',
  'Kind regards,',
  '88888888-8888-8888-8888-888888888888'
);

-- ---- owner_notification_preferences ----
-- Pat -> business_hours; Robin -> safety_critical_only; Casey -> default 'immediate' (no row).
insert into owner_notification_preferences (id, agency_id, owner_id, property_id, profile, notification_channels, notes) values
  (
    '77777777-7777-7777-7777-777777777701',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333301',
    null,
    'business_hours',
    '["sms","email"]'::jsonb,
    'Pat prefers business-hours-only contact for non-safety issues'
  ),
  (
    '77777777-7777-7777-7777-777777777702',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333302',
    null,
    'safety_critical_only',
    '["sms","email"]'::jsonb,
    'Robin only alerted for safety-critical issues; otherwise daily digest'
  );

commit;
