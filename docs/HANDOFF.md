# PM Assistant — Handoff (current state, June 2026)

**TL;DR:** All five spec phases are **built, tested, deployed, and migrated**. Everything is
human-in-the-loop (the system never auto-sends). This doc is the orientation for the next session;
the goal there is to **verify runtime + finish the deferred items**.

---

## Live environment

| Thing | Where |
|---|---|
| Worker | `https://pm-assistant-worker.ryanmay065.workers.dev` (`/health` → 200) |
| Web dashboard | `https://pm-assistant-web.pages.dev` |
| Supabase project | `deisxzmquxjaovubosil` (region **Singapore** — recreate in Sydney for the real pilot) |
| CI/CD | push to `main` → CI (typecheck + lint + test) → deploy (`wrangler deploy` + `pages deploy`) |
| Migrations | `0001`–`0019` **applied** to the hosted DB (via `supabase db push`, project is linked) |
| Git | all work committed + pushed to `origin/main` |

Worker secrets (Wrangler) and the hosted DB connection string (gitignored `packages/db/.env.local`)
are already set from Phase B. The web app reads `PUBLIC_*` from `$env/static/public` on Pages.

---

## What's built (by spec phase)

- **Phase 1 — inbound drafting + review queue** (LIVE): Gmail push → classify/escalate → draft →
  `ai_drafts` → PM reviews/edits/sends. Owner alerts (Twilio/Resend). Compliance floor via
  `@pm/rules`. Audit + model_calls.
- **Phase 2 — outbound sequences** (`docs/PHASE_2_OUTBOUND.md`): lease-renewal, inspection, owner
  updates, arrears. One daily cron (`cron/sequences.ts`) runs all scanners; drafts land in the same
  queue (`draft_source='sequence'`). Idempotent per cycle.
- **Phase 3 — maintenance coordination** (`docs/PHASE_3_MAINTENANCE.md`): PM-initiated jobs from a
  MAINTENANCE draft → s214 triage → tradie quote requests + chasers → owner-approval (spending-
  authority gated) → scheduling → close-out. `/maintenance` dashboard.
- **Phase 4 — statutory documents** (`docs/PHASE_4_DOCUMENTS.md`): rules-backed **Form 9** (entry
  notice), **rent-increase notice**, **Form 11** (remedy breach, 7d), **Form 12** (notice to leave:
  unremedied rent 7d / end-of-term 2 months). Rendered as print-ready HTML. `/documents` dashboard.
- **Phase 5 — SMS front door** (`docs/PHASE_5_SMS.md`): signature-verified Twilio inbound webhook →
  classify (escalation-first) → draft a status reply → `/sms` review/send. Never auto-sent.

Foundation also live: `@pm/rules` (QLD compliance engine + RTA-confirmed values) and the regulatory
monitoring bot (`cron/regulatory-scan.ts`, spec §12).

**Test counts (all green):** rules 71, documents 11, prompts 50, shared 1, web 43, worker 304
(`packages/db` RLS tests skip without `RUN_DB_TESTS=1`). `pnpm exec biome check .` + `pnpm -r typecheck` clean.

---

## What's LEFT to finish (next-chat work list)

1. **Verify the live deploy + runtime.** Confirm the latest CI run went green
   (github.com/RJmay/pm-assistant/actions), then log into the dashboard and smoke-test the new
   `/maintenance`, `/documents`, `/sms` pages + Approve & Send against the live (now-migrated) DB.
2. **Phase 5 SMS runtime.** Needs a **Twilio number off-trial** with its inbound webhook set to
   `https://pm-assistant-worker.ryanmay065.workers.dev/webhook/sms/<AGENCY_ID>` (A2P for production).
   Then verify a real text → drafted reply → send. (Worker `TWILIO_*` secrets already exist.)
3. **Deferred statutory forms/grounds** (same rules-backed pattern): the **general (non-rent)
   unremedied breach** Form 12 ground (**14 days**, distinct from the 7-day rent ground); **Form 13**
   (tenant's notice of intention to leave); **R12** (disputed bond); the 5-day moveable-dwelling
   Form 11 variant. Confirm each period from rta.qld.gov.au, add to `packages/rules/src/seed.ts`.
4. **Binary PDF for documents** — currently print-to-PDF HTML. Swap `@pm/documents`'
   `renderDocumentHtml` for a PDF renderer (e.g. `pdf-lib`) + upload to a Supabase Storage bucket;
   store the path instead of inline HTML.
5. **Voice** (the other half of §11) — not built; a separate telephony integration.
6. **Real-pilot follow-ups** (from Phase B): use a **dedicated agency mailbox** (not a personal
   Gmail — reconnect via `/oauth/gmail/start?agency_id=…`); recreate **Supabase in Sydney**; verify a
   **Resend domain** (test sender only reaches the account email); real **Twilio number + A2P**;
   **publish the Google OAuth consent screen** (in Testing, refresh tokens expire after 7 days).
7. **Beyond the spec** (only with direction): owner/tenant portals, listings & leasing, trust accounting.

---

## How to continue (orientation for the next session)

1. Read `CLAUDE.md` (working agreement + committed stack), this file, then the **memory index**
   (auto-loaded) and the relevant `docs/PHASE_*.md` for whatever you touch.
2. `docs/RUNBOOK.md` — deploy + form-activation + Twilio steps. `docs/ARCHITECTURE.md` — data flow + RLS.
3. Commands: `pnpm -r typecheck`, `pnpm exec biome check .`, `pnpm -r test`. Deploy: `git push origin main`.
   Apply migrations: `supabase db push` (linked; or `--db-url` from `packages/db/.env.local`).

---

## Carry-forward gotchas (learned this build)

- **Never auto-send** to a tenant/owner/third party (§13) — everything is drafted + queued. This
  overrode §11's "automatic" SMS wording.
- **Never invent a regulatory fact** (§0.3). All periods/dates live in `packages/rules/src/seed.ts`
  with source URLs; unconfirmed values are seeded `needsHumanConfirmation: true` and the engine
  THROWS. The `seed.test.ts` date-guard **forbids any ISO date (`YYYY-MM-DD`) in sourceNotes** — write
  "June 2026", not "2026-06-04".
- Cloudflare cron day-of-week: use `SUN`, not `0`. All Phase 2 scanners run under **one** daily cron.
- Postgres: a **new enum value** needs its **own migration** (can't be used in the same transaction
  it's added) — see `0015`/`0018`.
- `packages/db/src/types.ts` is **hand-edited** to match each migration; run `pnpm db:types`
  (regenerate from the live schema) when convenient.
- Adding a **workspace package** needs `pnpm install --offline` to link it (worked offline this build).
- The worker test suite uses an in-memory fake Supabase: `apps/worker/test/helpers/fake-supabase.ts`.

---

## Committed decisions (don't reopen without reason)

TypeScript + pnpm workspaces; SvelteKit on Cloudflare Pages; Cloudflare Workers backend; Supabase
(Postgres + Auth + Realtime + Vault); Anthropic tool-use (no free-text parsing); deterministic rules
engine for all compliance; **Inngest deferred** (CF cron + Supabase cover it); trust accounting out
of v1.
