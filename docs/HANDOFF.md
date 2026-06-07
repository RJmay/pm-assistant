# PM Assistant — Handoff (current state, June 2026)

**TL;DR:** All five spec phases are **built, tested, deployed, migrated, and now runtime-verified**.
Everything is human-in-the-loop (the system never auto-sends). A June 2026 verification pass found
and fixed two latent production issues (a stale web apex and a placeholder drafting prompt — see
"Fixed this session"). The remaining work is the **Approve & Send live test**, real-world pilot
setup (Twilio/mailbox/Sydney), and a few enhancements (binary PDFs, rare Form 13 grounds, voice).

---

## Live environment

| Thing | Where |
|---|---|
| Worker | `https://pm-assistant-worker.ryanmay065.workers.dev` (`/health` → 200, current) |
| Web dashboard | `https://pm-assistant-web.pages.dev` (apex verified serving the current build) |
| Supabase project | `deisxzmquxjaovubosil` (region **Singapore** — recreate in Sydney for the real pilot) |
| CI/CD | push to `main` → CI (typecheck + lint + test) → deploy (`wrangler deploy` + Pages deploy) |
| Migrations | `0001`–`0021` **applied** to the hosted DB |
| Active drafting prompt | **v2.4** in hosted `prompt_versions` (the real ~33.5KB prompt; see below) |
| Git | all work committed + pushed to `origin/main` |

Worker secrets (Wrangler) and the hosted DB connection string (gitignored `packages/db/.env.local`)
are already set from Phase B. The web app reads `PUBLIC_*` from `$env/static/public` on Pages.

---

## Fixed this session (June 2026 verification pass)

1. **Stale web apex (deploy footgun).** CI deployed Pages with `--branch main`, but the project's
   *production* branch wasn't `main`, so every deploy landed as a preview while the apex served a
   pre-Phase-3/4/5 build (404s on the new pages, 500 on the old `/queue`). Fixed in `ci.yml`: it now
   enforces `production_branch=main` via the CF API and asserts the newest deployment's
   environment is `production`. Apex re-verified.
2. **Placeholder drafting prompt.** The hosted `prompt_versions` active row was the 288-char M1
   **seed placeholder** (labelled "2.1") — the real prompt had never been activated in prod. Now
   **v2.4** (the full current prompt) is active. No known harm (no real mailbox connected yet).
3. **R12 mislabel (regulatory correctness).** Spec/rules/prompt all said "Form R12 = disputed bond";
   R12 is actually the **rooming-accommodation notice to leave** (out of v1). Corrected across the
   spec, `@pm/rules`, and the drafting prompt (v2.4). Disputed bonds = Form 4 + Form 16 (deferred).

---

## What's built (by spec phase)

- **Phase 1 — inbound drafting + review queue** (LIVE): Gmail push → classify/escalate → draft →
  `ai_drafts` → PM reviews/edits/sends. Owner alerts (Twilio/Resend). Compliance floor via
  `@pm/rules`. Audit + model_calls. Active prompt **v2.4** (DB-driven — the worker reads
  `prompt_versions.content`, not the `.md` file; the `.md` is the source for the DB row).
- **Phase 2 — outbound sequences** (`docs/PHASE_2_OUTBOUND.md`): lease-renewal, inspection, owner
  updates, arrears. One daily cron runs all scanners; drafts land in the same queue
  (`draft_source='sequence'`). Idempotent per cycle.
- **Phase 3 — maintenance coordination** (`docs/PHASE_3_MAINTENANCE.md`): PM-initiated jobs from a
  MAINTENANCE draft → s214 triage → tradie quote requests + chasers → owner-approval (spending-
  authority gated) → scheduling → close-out. `/maintenance` dashboard.
- **Phase 4 — statutory documents** (`docs/PHASE_4_DOCUMENTS.md`): rules-backed **Form 9** (entry
  notice), **rent-increase notice**, **Form 11** (remedy breach — rent 7d, general non-rent breach
  7d, moveable-dwelling rent 5d), **Form 12** (notice to leave — unremedied rent 7d, unremedied
  general breach 14d, end-of-term 2 months), **Form 13** (notice of intention to leave — periodic
  14d, end-of-term later-of-14d/lease-end, unremedied lessor breach 7d, sale / repair-order /
  compulsory-acquisition / condition / death-of-tenant 14d, tribunal-order non-compliance 7d,
  **DFV** 7d (guardrail note), and **non-liveability** (immediate) — all grounds modelled).
  Rendered as print-ready **HTML + a real PDF** (`pdf-lib`, stored `pdf_base64`, downloadable at
  `/documents/:id/pdf`). `/documents` dashboard.
- **Phase 5 — SMS front door** (`docs/PHASE_5_SMS.md`): signature-verified Twilio inbound webhook →
  classify (escalation-first) → draft a status reply → `/sms` review/send. Never auto-sent.

Foundation also live: `@pm/rules` (QLD compliance engine + RTA-confirmed values) and the regulatory
monitoring bot (spec §12).

**Onboarding (June 2026):** `scripts/onboard-agency.mjs` + `scripts/agency.example.json` +
`docs/ONBOARDING.md` — idempotent per-agency provisioning (agency, agency_config, an active v2.4
prompt, email state, PM users) plus the console steps the script can't do (Supabase Auth user with
`app_metadata.agency_id`, Gmail OAuth, Twilio webhook).

**Test counts (all green):** rules 83, documents 23, prompts 50, shared 1, web 43, worker 317
(`packages/db` RLS tests skip without `RUN_DB_TESTS=1`). `pnpm exec biome check .` + `pnpm -r typecheck` clean.

---

## What's LEFT to finish

1. **Approve & Send live test.** The only un-exercised core path. The `/maintenance`, `/documents`,
   `/sms` pages are now smoke-tested live (read-only). This step sends a **real** email — do it
   deliberately against a safe test recipient, never unsupervised.
2. **Phase 5 SMS runtime.** Needs a **Twilio number off-trial** with its inbound webhook set to
   `https://pm-assistant-worker.ryanmay065.workers.dev/webhook/sms/<AGENCY_ID>` (A2P for production).
   (Worker `TWILIO_*` secrets already exist.)
3. **Statutory forms/grounds — DONE.** All Forms 9/11/12/13 grounds are modelled + live, incl. DFV
   (with a guardrail note — ends only the affected tenant's interest, evidence required; still "not
   legal advice", review before issuing) and non-liveability (immediate / 0-day).
4. **Binary PDF for documents — DONE + live.** `pdf-lib` renderer (`renderDocumentPdf`), stored
   `pdf_base64` (migration 0021), download at `/documents/:id/pdf`; HTML path kept (additive).
5. **Voice** (the other half of §11) — not built; a separate telephony integration.
6. **Real-pilot follow-ups** (from Phase B): a **dedicated agency mailbox** (not a personal Gmail —
   reconnect via `/oauth/gmail/start?agency_id=…`); recreate **Supabase in Sydney**; verify a
   **Resend domain**; real **Twilio number + A2P**; **publish the Google OAuth consent screen**
   (in Testing, refresh tokens expire after 7 days).
7. **Beyond the spec** (only with direction): owner/tenant portals, listings & leasing, trust accounting.

---

## How to continue (orientation for the next session)

1. Read `CLAUDE.md` (working agreement + committed stack), this file, then the **memory index**
   (auto-loaded) and the relevant `docs/PHASE_*.md` for whatever you touch.
2. `docs/RUNBOOK.md` — deploy + form-activation + Twilio steps. `docs/ARCHITECTURE.md` — data flow + RLS.
3. Commands: `pnpm -r typecheck`, `pnpm exec biome check .`, `pnpm -r test`. Deploy: `git push origin main`.
   Apply migrations: `supabase db push` (linked) — or, if the CLI isn't installed, run the SQL via the
   `postgres` driver using `DATABASE_URL` from `packages/db/.env.local` (how 0020 was applied).

---

## Carry-forward gotchas (learned this build)

- **Never auto-send** to a tenant/owner/third party (§13) — everything is drafted + queued. This
  overrode §11's "automatic" SMS wording.
- **Never invent a regulatory fact** (§0.3). All periods/dates live in `packages/rules/src/seed.ts`
  with source URLs; unconfirmed values are seeded `needsHumanConfirmation: true` and the engine
  THROWS. The `seed.test.ts` date-guard **forbids any ISO date (`YYYY-MM-DD`) in sourceNotes** — write
  "June 2026", not "2026-06-04".
- **The drafting prompt is DB-driven.** The worker reads the active `prompt_versions.content`; the
  `packages/prompts/src/base/pm-drafting-vX.md` files are the *source* for that row, not what runs.
  A prompt change = new `.md` + bump the test + insert a new `prompt_versions` row with `active_to`
  set on the old (CLAUDE.md: explicit prompt-versioning task). v2.4 is current.
- **Cloudflare Pages production branch must equal the deploy `--branch`** or the apex goes stale —
  `ci.yml` now enforces + asserts this.
- **The worker needs CORS** (added June 2026 in `index.ts`) for browser→worker calls; without it the
  dashboard shows "Could not reach the Worker". Allowed origins: `*.pm-assistant-web.pages.dev` +
  localhost. Server-to-server callers (Pub/Sub, Twilio) send no Origin and are unaffected.
- **`pnpm lint` is `biome check .` (no `--write`)** — run `pnpm exec biome check --write .` before
  pushing, or CI's Lint step fails and the deploy is skipped. (Don't hand-edit with `sed` then skip
  the formatter.)
- Cloudflare cron day-of-week: use `SUN`, not `0`. All Phase 2 scanners run under **one** daily cron.
- Postgres: a **new enum value** needs its **own migration** (can't be used in the same transaction
  it's added) — see `0015`/`0018`/`0020`.
- `packages/db/src/types.ts` is **hand-edited** to match each migration; run `pnpm db:types`
  (regenerate from the live schema) when convenient.
- The worker test suite uses an in-memory fake Supabase: `apps/worker/test/helpers/fake-supabase.ts`.

---

## Committed decisions (don't reopen without reason)

TypeScript + pnpm workspaces; SvelteKit on Cloudflare Pages; Cloudflare Workers backend; Supabase
(Postgres + Auth + Realtime + Vault); Anthropic tool-use (no free-text parsing); deterministic rules
engine for all compliance; **Inngest deferred** (CF cron + Supabase cover it); trust accounting out
of v1.
