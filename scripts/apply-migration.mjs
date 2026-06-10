// ============================================================================
// Apply a single migration file to the hosted DB (when the supabase CLI isn't
// linked). PowerShell-safe; DATABASE_URL comes from the env file, never printed.
//
//   node --env-file=packages/db/.env.local scripts/apply-migration.mjs 0022
//
// Runs the migration inside a transaction. Refuses to re-apply: pass a guard
// probe below for each migration that needs one (0022 ships with one).
// ============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Per-migration "already applied?" probes (SQL returning a boolean `exists`).
const APPLIED_PROBES = {
  "0022":
    "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='agencies' and column_name='is_demo') as exists",
};

function die(msg) {
  console.error(`x ${msg}`);
  process.exit(1);
}

const prefix = process.argv[2];
if (!prefix)
  die("usage: node --env-file=packages/db/.env.local scripts/apply-migration.mjs <NNNN>");
if (!process.env.DATABASE_URL) die("DATABASE_URL not set (pass --env-file=packages/db/.env.local)");

const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const file = readdirSync(dir).find((f) => f.startsWith(`${prefix}_`) && f.endsWith(".sql"));
if (!file) die(`no migration starting with ${prefix}_ in supabase/migrations/`);
const ddl = readFileSync(`${dir}${file}`, "utf8");

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
try {
  const probe = APPLIED_PROBES[prefix];
  if (probe) {
    const [{ exists }] = await sql.unsafe(probe);
    if (exists) {
      console.log(`${file} already applied — skipping.`);
      process.exit(0);
    }
  }
  await sql.begin((tx) => tx.unsafe(ddl));
  console.log(`OK applied ${file}`);
} catch (e) {
  die(`apply failed (rolled back): ${e.message ?? e}`);
} finally {
  await sql.end({ timeout: 5 });
}
