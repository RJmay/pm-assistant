// ============================================================================
// Seed / reset the demo tenant — Coastline Property Management (Demo)
// ============================================================================
// Usage (PowerShell-safe; DATABASE_URL comes from the env file, never printed):
//   pnpm seed:demo     →  node --env-file=packages/db/.env.local scripts/seed-demo.mjs
//   pnpm reset:demo    →  same (the operation is identical and idempotent)
//
// What it does, in one transaction, in seconds:
//   1. DELETE the demo agency row — FK cascade wipes every child row (config,
//      prompt, properties, tenancies, tenants, owners, scenarios, drafts,
//      emails, jobs, documents, audit…). Fixed UUIDs make this surgical: only
//      the demo tenant is ever touched.
//   2. Recreate the whole structure from scripts/demo-fixtures.mjs with
//      relative dates computed from today (arrears = 9 days ago, inspection
//      anchors, lease windows) so the scenario library is always demo-ready.
//   3. Upsert the two demo PM logins in Supabase Auth (SQL insert with bcrypt
//      via pgcrypto). Password = DEMO_PM_PASSWORD env or a printed default.
//
// The demo tenant is hermetically sealed: it gets NO agency_email_state row
// and NO Vault token, and the worker's send/notifier paths refuse demo
// agencies at the transport layer — no real email/SMS can ever leave it.
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { buildDemoFixtures, DEMO_AGENCY_ID } from "./demo-fixtures.mjs";

function die(msg) {
  console.error(`x ${msg}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  die("DATABASE_URL not set (run via pnpm seed:demo, or pass --env-file=packages/db/.env.local)");
}

const DEMO_PASSWORD = process.env.DEMO_PM_PASSWORD ?? "coastline-demo-2026";
const todayAest = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().slice(0, 10);
const fx = buildDemoFixtures(todayAest);

const promptContent = readFileSync(
  fileURLToPath(new URL("../packages/prompts/src/base/pm-drafting-v2.4.md", import.meta.url)),
  "utf8",
);

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const started = Date.now();
let authNote = "";

try {
  await sql.begin(async (tx) => {
    // ---- 1. Wipe (cascade) — idempotent re-seed ----
    await tx`delete from agencies where id = ${DEMO_AGENCY_ID}`;

    // ---- 2. Agency + config + active prompt ----
    const a = fx.agency;
    await tx`
      insert into agencies (id, name, suburb, business_hours, after_hours_emergency_line,
                            principal_email, is_demo)
      values (${a.id}, ${a.name}, ${a.suburb}, ${a.business_hours},
              ${a.after_hours_emergency_line}, ${a.principal_email}, true)`;

    await tx`
      insert into agency_config (agency_id, voice_samples, approved_tradies, nominated_repairer,
        routine_approval_threshold_cents, written_quote_threshold_cents, house_rules,
        pm_signoff_default)
      values (${a.id}, ${tx.json(fx.config.voice_samples)}, ${tx.json(fx.config.approved_tradies)},
        ${tx.json(fx.config.nominated_repairer)}, 30000, 60000,
        ${fx.config.house_rules}, ${fx.config.pm_signoff_default})`;

    const [prompt] = await tx`
      insert into prompt_versions (agency_id, version, content, notes)
      values (${a.id}, '2.4', ${promptContent}, 'demo seed: drafting prompt v2.4')
      returning id`;
    await tx`update agency_config set active_prompt_version_id = ${prompt.id}
             where agency_id = ${a.id}`;

    // NOTE: deliberately NO agency_email_state and NO Vault token — defense in
    // depth for the demo sandbox (no mailbox identity even exists to send from).

    // ---- 3. PMs (agency_users) ----
    for (const pm of fx.pms) {
      await tx`
        insert into agency_users (id, agency_id, auth_user_id, email, full_name, role,
                                  signature_block, active)
        values (${pm.id}, ${a.id}, ${pm.authUserId}, ${pm.email}, ${pm.fullName}, ${pm.role},
                ${pm.signature}, true)`;
    }

    // ---- 4. Owners, properties, tenancies, tenants ----
    for (const o of fx.owners) {
      await tx`
        insert into owners (id, agency_id, full_name, email, phone)
        values (${o.id}, ${a.id}, ${o.full_name}, ${o.email}, ${o.phone})`;
    }
    for (const p of fx.properties) {
      await tx`
        insert into properties (id, agency_id, owner_id, address_line1, suburb, postcode, state,
                                managing_pm_id)
        values (${p.id}, ${a.id}, ${p.owner_id}, ${p.address_line1}, ${p.suburb}, ${p.postcode},
                ${p.state}, ${p.managing_pm_id})`;
    }
    for (const t of fx.tenancies) {
      await tx`
        insert into tenancies (id, agency_id, property_id, status, agreement_type, start_date,
          end_date, rent_amount_cents, rent_frequency, bond_amount_cents, bond_rta_reference,
          last_routine_inspection_date, arrears_since, last_rent_increase_date)
        values (${t.id}, ${a.id}, ${t.property_id}, ${t.status}, ${t.agreement_type},
          ${t.start_date}, ${t.end_date}, ${t.rent_amount_cents}, ${t.rent_frequency},
          ${t.bond_amount_cents}, ${t.bond_rta_reference}, ${t.last_routine_inspection_date},
          ${t.arrears_since}, ${t.last_rent_increase_date})`;
    }
    for (const t of fx.tenants) {
      await tx`
        insert into tenants (id, agency_id, tenancy_id, full_name, email, phone, is_primary)
        values (${t.id}, ${a.id}, ${t.tenancy_id}, ${t.full_name}, ${t.email}, ${t.phone},
                ${t.is_primary})`;
    }

    // ---- 5. Scenario library ----
    for (const s of fx.scenarios) {
      await tx`
        insert into demo_scenarios (id, agency_id, key, title, description, from_name,
                                    from_address, subject, body, compliance, sort_order)
        values (${s.id}, ${a.id}, ${s.key}, ${s.title}, ${s.description}, ${s.from_name},
                ${s.from_address}, ${s.subject}, ${s.body}, ${tx.json(s.compliance)},
                ${s.sort_order})`;
    }
  });

  // ---- 6. Demo PM auth users (outside the main tx; best-effort) ----
  // GoTrue-compatible direct insert with bcrypt. If the hosted instance rejects
  // this (schema drift), the seed still succeeds — create the logins in the
  // Supabase console instead (instructions printed below).
  try {
    for (const pm of fx.pms) {
      const appMeta = {
        provider: "email",
        providers: ["email"],
        agency_id: DEMO_AGENCY_ID,
      };
      await sql`
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, recovery_token, email_change_token_new, email_change)
        values ('00000000-0000-0000-0000-000000000000', ${pm.authUserId}, 'authenticated',
          'authenticated', ${pm.email}, crypt(${DEMO_PASSWORD}, gen_salt('bf')), now(),
          ${sql.json(appMeta)}, ${sql.json({ full_name: pm.fullName })}, now(), now(),
          '', '', '', '')
        on conflict (id) do update set
          raw_app_meta_data = excluded.raw_app_meta_data,
          encrypted_password = excluded.encrypted_password`;
      await sql`
        insert into auth.identities (provider_id, user_id, identity_data, provider,
                                     created_at, updated_at)
        values (${pm.authUserId}, ${pm.authUserId},
          ${sql.json({ sub: pm.authUserId, email: pm.email, email_verified: true })},
          'email', now(), now())
        on conflict (provider_id, provider) do nothing`;
    }
    authNote = `  Logins: ${fx.pms.map((p) => p.email).join(" / ")}  (password: ${
      process.env.DEMO_PM_PASSWORD ? "from DEMO_PM_PASSWORD" : DEMO_PASSWORD
    })`;
  } catch (e) {
    authNote = `  ! Auth-user insert failed (${e.message}). Create logins manually in the
    Supabase console with app_metadata { "agency_id": "${DEMO_AGENCY_ID}" }:
    ${fx.pms.map((p) => `${p.email} (auth id ${p.authUserId})`).join(", ")}`;
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`OK Demo tenant seeded in ${secs}s — "${fx.agency.name}"`);
  console.log(`  agency_id: ${DEMO_AGENCY_ID}`);
  console.log(
    `  ${fx.properties.length} properties, ${fx.tenancies.length} tenancies, ${fx.tenants.length} tenants, ${fx.owners.length} owners, ${fx.scenarios.length} scenarios`,
  );
  console.log(authNote);
  console.log("  Sandbox: no mailbox identity; worker refuses demo sends at the transport layer.");
} catch (e) {
  die(`seed failed (no partial state — transaction rolled back): ${e.message ?? e}`);
} finally {
  await sql.end({ timeout: 5 });
}
