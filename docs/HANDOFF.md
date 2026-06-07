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
| Migrations | `0001`–`0020` **applied** to the hosted DB |
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
  14d, end-of-term later-of-14d/lease-end, unremedied lessor breach 7d). Print-ready HTML.
  `/documents` dashboard.
- **Phase 5 — SMS front door** (`docs/PHASE_5_SMS.md`): signature-verified Twilio inbound webhook →
  classify (escalation-first) → draft a status reply → `/sms` review/send. Never auto-sent.

Foundation also live: `@pm/rules` (QLD compliance engine + RTA-confirmed values) and the regulatory
monitoring bot (spec §12).

**Test counts (all green):** rules 79, documents 18, prompts 50, shared 1, web 43, worker 313
(`packages/db` RLS tests skip without `RUN_DB_TESTS=1`). `pnpm exec biome check .` + `pnpm -r typecheck` clean.

---

## What's LEFT to finish

1. **Approve & Send live test.** The only un-exercised core path. The `/maintenance`, `/documents`,
   `/sms` pages are now smoke-tested live (read-only). This step sends a **real** email — do it
   deliberately against a safe test recipient, never unsupervised.
2. **Phase 5 SMS runtime.** Needs a **Twilio number off-trial** with its inbound webhook set to
   `https://pm-assistant-worker.ryanmay065.workers.dev/webhook/sms/<AGENCY_ID>` (A2P for production).
   (Worker `TWILIO_*` secrets already exist.)
3. **Remaining statutory grounds** (same rules-backed pattern, confirm each period from
   rta.qld.gov.au): the **rare Form 13 grounds** not yet modelled — domestic & family violence
   (7d / can leave immediately — **sensitive, has its own process**), non-liveability (the day given),
   owner-intends-to-sell (14d), failure to comply with repair order (14d), compulsory acquisition
   (14d), condition of premises (14d), death of sole/co-tenant (14d), non-compliance with tribunal
   order (7d). The common forms/grounds (Forms 11/12/13 core) are **done**.
4. **Binary PDF for documents** — currently print-to-HTML. Plan: add `pdf-lib` to `@pm/documents`,
   a `renderDocumentPdf(model)` renderer, store the PDF (inline column or Supabase Storage) and a
   download in the dashboard. Keep the HTML path so it's regression-safe and additive.
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
