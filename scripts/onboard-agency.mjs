// ============================================================================
// Onboard an agency — idempotent provisioning of the DB side of a new client.
// ============================================================================
// Usage:
//   node --env-file=packages/db/.env.local scripts/onboard-agency.mjs <config.json>
//
// Reads DATABASE_URL from the env file (never printed). Creates/updates, in one
// transaction:
//   - agencies                 (the agency row)
//   - agency_config            (real nominated repairer, tradies, thresholds, …)
//   - prompt_versions          (an ACTIVE v2.4 row for this agency)
//   - agency_email_state       (the mailbox to monitor)
//   - agency_users             (any PMs that already have a Supabase Auth id)
// Re-running with the same config is safe (upserts by id / natural key).
//
// What this does NOT do (needs an external console — see docs/ONBOARDING.md):
//   - create Supabase Auth users (set app_metadata.agency_id)
//   - the Gmail OAuth connect, the Twilio webhook, owners/properties import.
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const WORKER_URL = process.env.WORKER_URL ?? "https://pm-assistant-worker.ryanmay065.workers.dev";

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const configPath = process.argv[2];
if (!configPath) die("usage: node --env-file=… scripts/onboard-agency.mjs <config.json>");
if (!process.env.DATABASE_URL) die("DATABASE_URL not set (pass --env-file=packages/db/.env.local)");

let cfg;
try {
  cfg = JSON.parse(readFileSync(configPath, "utf8"));
} catch (e) {
  die(`could not read/parse ${configPath}: ${e.message}`);
}

// ---- validate the essentials ----
const a = cfg.agency ?? {};
const c = cfg.config ?? {};
if (!a.name) die("agency.name is required");
if (!cfg.mailbox) die("mailbox (the address to monitor) is required");
if (!c.nominatedRepairer?.name || !c.nominatedRepairer?.number) {
  die(
    "config.nominatedRepairer { name, number } is required — drafting throws without it (RTRA s218)",
  );
}

const agencyId = a.id ?? crypto.randomUUID();
const promptContent = readFileSync(
  fileURLToPath(new URL("../packages/prompts/src/base/pm-drafting-v2.4.md", import.meta.url)),
  "utf8",
);
const pms = Array.isArray(cfg.pms) ? cfg.pms : [];
const skippedPms = [];

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    await tx`
      insert into agencies (id, name, suburb, business_hours, after_hours_emergency_line, principal_email)
      values (${agencyId}, ${a.name}, ${a.suburb ?? null}, ${a.businessHours ?? null},
              ${a.afterHoursEmergencyLine ?? null}, ${a.principalEmail ?? null})
      on conflict (id) do update set
        name = excluded.name, suburb = excluded.suburb, business_hours = excluded.business_hours,
        after_hours_emergency_line = excluded.after_hours_emergency_line,
        principal_email = excluded.principal_email, updated_at = now()`;

    await tx`
      insert into agency_config (agency_id, voice_samples, approved_tradies, nominated_repairer,
        routine_approval_threshold_cents, written_quote_threshold_cents, house_rules, pm_signoff_default)
      values (${agencyId}, ${tx.json(c.voiceSamples ?? [])}, ${tx.json(c.approvedTradies ?? [])},
        ${tx.json(c.nominatedRepairer)}, ${c.routineApprovalThresholdCents ?? 25000},
        ${c.writtenQuoteThresholdCents ?? 50000}, ${c.houseRules ?? null},
        ${c.pmSignoffDefault ?? "Kind regards,"})
      on conflict (agency_id) do update set
        voice_samples = excluded.voice_samples, approved_tradies = excluded.approved_tradies,
        nominated_repairer = excluded.nominated_repairer,
        routine_approval_threshold_cents = excluded.routine_approval_threshold_cents,
        written_quote_threshold_cents = excluded.written_quote_threshold_cents,
        house_rules = excluded.house_rules, pm_signoff_default = excluded.pm_signoff_default,
        updated_at = now()`;

    // Ensure exactly one ACTIVE prompt_versions row (v2.4) for this agency.
    const active = await tx`
      select id, version from prompt_versions where agency_id = ${agencyId} and active_to is null`;
    let promptId = active.find((r) => r.version === "2.4")?.id;
    if (!promptId) {
      for (const r of active)
        await tx`update prompt_versions set active_to = now() where id = ${r.id}`;
      const [ins] = await tx`
        insert into prompt_versions (agency_id, version, content, notes)
        values (${agencyId}, '2.4', ${promptContent}, 'onboarding: activated drafting prompt v2.4')
        returning id`;
      promptId = ins.id;
    }
    await tx`update agency_config set active_prompt_version_id = ${promptId} where agency_id = ${agencyId}`;

    await tx`
      insert into agency_email_state (agency_id, mailbox_address)
      values (${agencyId}, ${cfg.mailbox})
      on conflict (agency_id) do update set mailbox_address = excluded.mailbox_address, updated_at = now()`;

    for (const pm of pms) {
      if (!pm.authUserId) {
        skippedPms.push(pm.email ?? "(no email)");
        continue;
      }
      await tx`
        insert into agency_users (agency_id, auth_user_id, email, full_name, role, signature_block, active)
        values (${agencyId}, ${pm.authUserId}, ${pm.email}, ${pm.fullName}, ${pm.role ?? "pm"},
                ${pm.signatureBlock ?? null}, true)
        on conflict (agency_id, email) do update set
          auth_user_id = excluded.auth_user_id, full_name = excluded.full_name,
          role = excluded.role, signature_block = excluded.signature_block, active = true`;
    }
  });

  console.log(`✓ Provisioned agency "${a.name}"`);
  console.log(`  agency_id: ${agencyId}`);
  console.log("");
  console.log("Remaining manual steps (see docs/ONBOARDING.md):");
  console.log("  1. Create each PM's Supabase Auth user with app_metadata.agency_id =");
  console.log(`     ${agencyId}`);
  if (skippedPms.length > 0) {
    console.log(`     (PMs without an authUserId were skipped: ${skippedPms.join(", ")} —`);
    console.log("      add their authUserId to the config and re-run to link them.)");
  }
  console.log(`  2. Connect the mailbox: ${WORKER_URL}/oauth/gmail/start?agency_id=${agencyId}`);
  console.log(`  3. Twilio inbound webhook → ${WORKER_URL}/webhook/sms/${agencyId}`);
  console.log("  4. Import owners / properties / tenancies (no UI yet — SQL or seed).");
  console.log("  5. Smoke test: email the mailbox → draft appears on /queue.");
} catch (e) {
  die(`provisioning failed (no changes committed): ${e.message ?? e}`);
} finally {
  await sql.end({ timeout: 5 });
}
