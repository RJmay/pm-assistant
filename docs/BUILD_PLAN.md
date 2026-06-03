# BUILD_PLAN.md

> **STATUS: Phase 1 COMPLETE + LIVE. Phases 2, 3 CODE COMPLETE. Phase 4 (documents) + Phase 5
> (SMS front door) CODE COMPLETE — all five spec phases now built.** Milestones M0–M10 are built
> and Phase B (runtime bring-up) is done — deployed on Cloudflare + Supabase, auto-deploying from
> `main`. Handoffs: **`HANDOFF.md`** (live URLs), **`docs/PHASE_2_OUTBOUND.md`** (§8 outbound
> sequences), **`docs/PHASE_3_MAINTENANCE.md`** (§9 maintenance, M1–M3),
> **`docs/PHASE_4_DOCUMENTS.md`** (§10 documents — Form 9 + rent-increase live; Form 11/12 built
> but dormant until their RTA periods are confirmed), and **`docs/PHASE_5_SMS.md`** (§11 SMS
> front door). All rules-backed / human-in-the-loop (never auto-sent). Code + tests green
> (rules 72, documents 11, prompts 50, web 43, worker 303; db 3 skipped); runtime DoDs pending
> the same live-data / provider bring-up as Phase 1. See the Phase 2–5 sections below.

Each milestone has a clear definition of done. Work them in order. Mark the current one `[CURRENT]`, completed ones `[DONE]`. When you finish a milestone, stop and report — don't roll into the next without confirmation.

---

## Milestone 0 — Scaffold `[DONE]`

Set up the monorepo, tooling, and empty packages. No business logic.

**Tasks:**
- `pnpm init` at root; create `pnpm-workspace.yaml` with `apps/*` and `packages/*`
- Create the directory tree per CLAUDE.md (apps/web, apps/worker, packages/db, packages/prompts, packages/shared)
- Each package gets its own `package.json`, `tsconfig.json` extending a root `tsconfig.base.json`
- Add Biome config (`biome.json`) at root with sensible defaults — strict, opinionated
- Add `.gitignore` (node_modules, .env*, .wrangler, .svelte-kit, dist, build)
- Add a root `README.md` explaining the project in 10 lines
- Add GitHub Actions CI workflow: typecheck + lint + test on every push
- Stub a `health.ts` route in apps/worker so we can verify `wrangler dev` works
- Stub a SvelteKit app in apps/web with the Cloudflare adapter configured

**Definition of done:**
- `pnpm install` runs clean
- `pnpm -r typecheck` passes
- `pnpm lint` passes
- `pnpm --filter worker dev` starts and `curl localhost:8787/health` returns 200
- `pnpm --filter web dev` starts and the SvelteKit hello page renders
- Push to `main` triggers CI and it passes

---

## Milestone 1 — Database `[DONE]`

Bring up Supabase locally, apply the schema from `docs/schema.sql`, generate TS types.

**Tasks:**
- `supabase init` at the repo root
- Copy contents of `docs/schema.sql` into `supabase/migrations/0001_initial.sql`
- `supabase start` to bring up local Postgres
- `supabase db reset` to apply the migration
- Generate types: `supabase gen types typescript --local > packages/db/src/types.ts`
- Write a seed script `supabase/seed.sql` that creates:
  - 1 agency (Sunshine Coast Test Agency)
  - 1 agency_config row with example tradies and voice samples (use placeholders — real ones go in later via the dashboard)
  - 2 PMs
  - 3 owners
  - 5 properties (mix of owners)
  - 4 tenancies (3 active, 1 ending)
  - 7 tenants
  - Owner notification preferences: one owner on `business_hours`, one on `safety_critical_only`, rest default
  - 1 active prompt_versions row pointing at the base prompt content
- Verify RLS by writing a smoke test in `packages/db/test/rls.test.ts` that:
  - Inserts as service-role: succeeds
  - Selects as agency A's JWT: sees only agency A's rows
  - Selects as agency B's JWT: sees only agency B's rows (or none if not yet seeded)
- Export typed Supabase clients from `packages/db/src/index.ts`:
  - `createServiceClient(env)` for the Worker
  - `createBrowserClient(env)` for SvelteKit
  - `createServerClient(event)` for SvelteKit server load functions

**Definition of done:**
- Seed runs clean
- RLS smoke test passes
- Types are generated and committed
- A diagram of the schema (text-based ERD in a comment block at the top of `schema.sql`) is current

---

## Milestone 2 — Prompt assembly `[DONE]`

Build the package that takes a base prompt + agency config and produces the final system prompt string.

**Tasks:**
- Copy `docs/system-prompt.md` to `packages/prompts/src/base/pm-drafting-v2.1.md`
- Build `assemble.ts`:
  ```ts
  export interface AssembleInput {
    basePrompt: string;
    agencyConfig: AgencyConfig;  // typed from db
    runtimeContext?: {
      // optional per-message context: known property, tenant, history hints
      propertyAddress?: string;
      tenantName?: string;
      pmName?: string;
    };
  }
  export function assemble(input: AssembleInput): string;
  ```
- Templating is plain string replacement on the placeholders listed in ARCHITECTURE.md
- Voice samples, tradies, etc. are rendered into markdown sublists inside the placeholders
- Write Vitest snapshot tests covering:
  - Minimal config (just agency name, defaults elsewhere)
  - Full config with all fields populated
  - Edge case: empty voice samples
  - Edge case: missing nominated repairer (should fail loudly — required for s218)

**Definition of done:**
- `pnpm --filter prompts test` passes
- Snapshots reviewed and committed
- Assembled prompt for the seeded test agency is readable and complete

---

## Milestone 3 — Drafter (Anthropic API integration) `[DONE]`

Wire up the call to Claude with structured output.

**Tasks:**
- Install `@anthropic-ai/sdk`
- Build `drafter.ts`:
  ```ts
  export interface DrafterInput {
    systemPrompt: string;
    inboundEmail: { from: string; to: string; subject: string; body: string; receivedAt: string };
    threadHistory?: Array<{ direction: 'inbound'|'outbound'; from: string; body: string; timestamp: string }>;
    model?: 'claude-sonnet-4-6' | 'claude-opus-4-7';
  }
  export interface DrafterOutput {
    category: ...;
    // exact mapping to ai_drafts columns
  }
  export async function draft(input: DrafterInput, opts: { apiKey: string }): Promise<DrafterOutput>;
  ```
- Use tool use with the `submit_draft` schema from ARCHITECTURE.md
- Force tool choice: `tool_choice: { type: "tool", name: "submit_draft" }`
- Validate the response with a zod schema (export it from `packages/shared`)
- Return the parsed result
- Build a deterministic fixture set in `packages/prompts/test/fixtures/`:
  - 12 sample inbound emails covering: routine maintenance, urgent maintenance, emergency, rent enquiry, lease renewal, complaint, QCAT mention (LEGAL), self-harm reference (WELFARE), media enquiry (REPUTATIONAL), wrong agency, multi-issue, possible spam
- Write tests that run the drafter against each fixture and assert the structured fields match expectations (category, escalation, do_not_send). Body text is harder to assert exactly — assert key constraints (must contain agency name, must not promise specific tradie times, must not commit landlord).
- Tests use a real API key behind an env flag (`RUN_LLM_TESTS=1 pnpm test`); CI runs them weekly, not on every push.

**Definition of done:**
- 12 fixtures pass classification assertions
- Body-content constraint assertions pass
- A run against the seeded agency produces sensible drafts (eyeball-reviewed once, then locked in as snapshots)

---

## Milestone 4 — Worker entry + Pub/Sub webhook `[DONE]`

Wire the Cloudflare Worker to receive Gmail Pub/Sub pushes. No Gmail fetching yet.

**Tasks:**
- Configure `wrangler.toml` for the worker
- Set up route dispatch in `apps/worker/src/index.ts` (use Hono — small router, CF Workers native)
- Build `/webhook/gmail`:
  - Verify the Pub/Sub JWT signature (fetch Google's public keys, cache them in Workers KV)
  - Parse the `historyId` from the message
  - For now, just log it and write an `audit_log` row
- Build `/health` returning 200 OK
- Build env parsing with zod in `lib/env.ts` — fail loudly on startup if anything's missing
- Wrangler secrets: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- Local dev: `wrangler dev`, hit `/webhook/gmail` with a synthetic Pub/Sub envelope using a test fixture

**Definition of done:**
- Pub/Sub signature verification works against a real Google-signed test token
- `audit_log` row appears for each received push
- 401 if the signature is bad

---

## Milestone 5 — Gmail integration `[DONE — code complete, runtime DoD pending Phase B]`

Pull messages from Gmail and persist them.

**Status:** All M5 code is written and `pnpm -r typecheck` + `pnpm -r test` pass (worker suite: 8 files, 69 tests). The runtime DoD below cannot be confirmed until Phase B (hosted Supabase project) is set up — the user explicitly chose to write M5 code with the Supabase parts stubbed (via mocked service modules in tests) and finish Phase B afterwards.

**Tasks (done):**
- Migration `0002_agency_gmail_secrets.sql` (vault → agency mapping) + `0003_vault_gmail_helpers.sql` (SECURITY DEFINER RPC wrappers for vault ops)
- `services/vault.ts`: `storeGmailRefreshToken` / `getGmailRefreshToken` / `deleteGmailRefreshToken` calling the RPC wrappers
- `services/gmail.ts`: fetch-based wrappers with zod schemas for `exchangeCode`, `refreshAccessToken`, `usersGetProfile`, `usersHistoryList` (with pagination), `usersMessagesGet`, `usersWatch`. Throws `GmailApiError` on non-2xx / schema violation
- `services/email-parser.ts`: `parseGmailMessage` walks the MIME tree, extracts headers, plain/HTML bodies, attachments; helpers for RFC 2822 address parsing and Gmail's URL-safe base64 body decoding
- `routes/oauth-gmail.ts`: `GET /oauth/gmail/start` (HMAC JWT state, 5-min TTL) and `GET /oauth/gmail/callback` (with + without trailing slash) — exchanges code, fetches profile, starts watch, persists refresh token in Vault, upserts `agency_email_state`, writes audit log
- `routes/gmail-webhook.ts` upgrade (replaces the M4 stub):
  - Verify Pub/Sub JWT → resolve agency via `agency_email_state.mailbox_address` → fetch refresh token from Vault → refresh access token → loop `users.history.list` with pagination → for each new INBOX message: `users.messages.get` + parse + upsert `email_threads` + upsert `email_messages` (idempotent on `(agency_id, gmail_message_id)`) → advance `last_history_id` → write `gmail.pubsub.processed` audit log
  - Returns 200 with `{ok:false, reason:"no agency for mailbox"}` when state lookup misses, so Pub/Sub doesn't retry forever
- Cron trigger `0 13 * * *` (13:00 UTC daily) + `cron/refresh-watches.ts`: scans `agency_email_state` for `watch_expires_at` null or within 48h, calls `users.watch` per row, writes back the new expiration. Per-row failures are logged and the batch continues
- Env additions: `WEBHOOK_BASE_URL`, `OAUTH_STATE_SECRET` (≥32 chars), `PUBSUB_TOPIC` (regex-validated)
- Unit tests for: env validation, pubsub JWT verification, webhook (auth + envelope + new persistence pipeline + pagination + INBOX filter + "no agency" path), gmail (fetch-mocked), email-parser (address/body/attachment extraction), vault (RPC delegation), oauth-gmail (start params + callback success + failure modes), cron (watch refresh loop with continue-on-error)

**Definition of done:** (pending Phase B)
- A real inbound email to the pilot agency's mailbox appears in `email_messages` within seconds
- Threading works: replies to an existing thread attach to the same `email_threads` row

---

## Milestone 6 — End-to-end draft generation `[DONE — code complete, runtime DoD pending Phase B]`

Tie it together: inbound message → matcher → assemble → drafter → ai_drafts row.

**Status:** All M6 code is written and `pnpm exec biome check .` + `pnpm -r typecheck` + `pnpm -r test` pass (worker suite: 11 files, 106 tests; prompts suite: 2 files, 18 tests; LLM-gated tests skip without `RUN_LLM_TESTS=1`). The runtime DoD below cannot be confirmed until Phase B (hosted Supabase + seeded pilot agency) — same "code now, runtime later" pattern that landed M5.

**Tasks (done):**
- Migrations `0004_ai_drafts_match_confidence.sql` (adds `match_confidence` + `matched_via` columns + `match_source` enum + low-match partial index), `0005_agency_lean_notes.sql` (adds `lean_notes` jsonb to agency_config), `0006_weekly_digests.sql` (new table + `weekly_digest_status` enum + RLS). `docs/schema.sql` updated to match. `packages/db/src/types.ts` hand-edited; run `pnpm db:types` after applying migrations to a Supabase to regenerate.
- Base prompt bumped to `pm-drafting-v2.2.md` with new `[LEAN_NOTES]` section after `House rules and quirks`. `packages/prompts/src/render.ts` gains `LeanNote` interface + `activeLeanNotes()` (filter by `expiresAt`) + `renderLeanNotes()`. `assemble.ts` substitutes `[LEAN_NOTES]` and strips the whole section when there are no active leans. Snapshot tests cover empty/populated/expired leans.
- `apps/worker/src/services/matcher.ts` — 5-step cascade (exact_email → thread_continuity → subject_fuzzy → body_scan → fallback). Every query scoped by `agency_id`. Tenant/owner lookups chain through `tenancies` → `properties` to a concrete `property_id` when unambiguous; ambiguous matches drop a confidence tier.
- `apps/worker/src/services/draft-pipeline.ts` — `runDraftPipeline()` orchestrator: matcher → maybe-update `email_threads.property_id` (never downgrades a stronger existing link) → load `agency` + `agency_config` + active `prompt_versions` + PMs → `assemble()` (catches `MissingNominatedRepairerError` → skipped) → `draft()` (always `claude-sonnet-4-6`; opus pre-classifier deferred) → insert `ai_drafts` + `model_calls` + `audit_log` with `draft.created`. Returns a discriminated union so the webhook can tally ok/skipped/failed without throwing.
- `apps/worker/src/routes/gmail-webhook.ts` — `persistMessages()` now returns `Array<{ emailMessageId, threadId, parsed }>`; webhook loops and calls `runDraftPipeline` per message. Audit metadata includes `drafts_ok` / `drafts_skipped` / `drafts_failed`. `email_messages` upsert switched off `ignoreDuplicates` so the row id is returned even on redelivery.
- `apps/worker/src/cron/weekly-drift.ts` + new cron `0 23 * * 0` (Mon 09:00 AEST). Computes this-week-vs-4-week-baseline shifts on category mix, escalation rate, do-not-send rate, mean draft confidence. Silent when nothing crosses the 25% threshold or sample sizes are below `MIN_THIS_WEEK=5` / `MIN_BASELINE=10`. On signal it inserts a `weekly_digests` row with `signals` + `suggested_directions` ready for the M8 dashboard tuning card. Idempotent on `(agency_id, week_start_date)`. `src/index.ts` now dispatches `scheduled()` by cron pattern.
- Unit tests: `matcher.test.ts` (15 — each cascade step + agency scoping + ambiguity + archived filter), `draft-pipeline.test.ts` (9 — happy path + thread-link no-downgrade + skipped/error paths), `weekly-drift.test.ts` (11 — pure-function math + integration with idempotency + per-agency continue-on-error + week-window math), extended `webhook.test.ts` (+2 pipeline invocation + 200-on-pipeline-error). LLM-gated `draft-pipeline.llm.test.ts` runs 3 M3 fixtures through the full pipeline with real Anthropic when `RUN_LLM_TESTS=1`; mocked Supabase.

**Deferred to a later milestone (intentional, surfaced now):**
- Standalone `scripts/weekly-drift.ts` for ad-hoc manual runs — the cron + `wrangler cron trigger` are sufficient for v1.
- Opus-4-7 pre-classifier for LEGAL/REPUTATIONAL drafts — measure sonnet's escalation accuracy first.
- Drift score from PM `draft_edits` direction — needs M9's `draft_edits` table to exist; current drift script picks this up automatically once that lands.
- Zod boundary parser for `agency_config.lean_notes`/`voice_samples`/`approved_tradies` jsonb — runtime cast through `unknown` for now.

**Definition of done:** (pending Phase B)
- An inbound email goes from Gmail → ai_drafts row in under 8 seconds (p50)
- Match cascade hits the right `property_id` on test fixtures against the seeded agency
- Drift check: re-run the same email through and get a similar (not identical) draft — flag if categorisation changes

---

## Milestone 7 — Owner notification routing `[DONE — code complete, runtime DoD pending test system]`

If `emergency_landlord_alert: true`, dispatch via the owner's profile.

**Status:** All M7 code is written and `pnpm exec biome check .` + `pnpm -r typecheck` + `pnpm -r test` pass (worker suite: 15 files / 154 tests; prompts suite: 2 files / 18 tests; LLM-gated test file skips without `RUN_LLM_TESTS=1`). Runtime DoD (real SMS delivered within 30s, owner digest sends one combined email) deferred until the test system (Twilio test account, Resend, hosted Supabase) is set up — same code-now-runtime-later pattern as M5/M6.

**Tasks (done):**
- Migration `0007_ai_drafts_safety_critical.sql` adds a `safety_critical boolean` column on `ai_drafts` + partial index. `submitDraftSchema` in `@pm/shared` requires the field; base prompt bumped to `pm-drafting-v2.3.md` with a dedicated `SAFETY CRITICAL` section documenting when to set it. Independent of `EMERGENCY LANDLORD ALERT`.
- Worker `lib/env.ts` adds `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` with zod validation. `@pm/shared` gains `TwilioApiError` + `ResendApiError` classes following the `GmailApiError` shape.
- `apps/worker/src/services/twilio.ts` — fetch-based POST to `Messages.json` with HTTP Basic auth. Zod-validated response, throws `TwilioApiError` on non-2xx or schema violations.
- `apps/worker/src/services/resend.ts` — fetch-based POST to `/emails` with Bearer auth. Same error shape. Refuses to call when neither `html` nor `text` is supplied.
- `apps/worker/src/services/notifier.ts` — `dispatchOwnerNotification()` resolves owner via property → owner_notification_preferences (property-level beats owner-level; default `immediate` if no row), branches on profile, dispatches via Twilio/Resend, and writes a `notification_log` row for every dispatch / suppression / queue. Business hours hardcoded to QLD AEST Mon-Fri 09:00-17:00 for v1. Per-agency hours deferred to M10.
- `apps/worker/src/services/draft-pipeline.ts` — after `ai_drafts` insert, when `submission.emergency_landlord_alert` is true, the pipeline calls the notifier with `safetyCritical: submission.safety_critical`. Notifier failures are logged and swallowed (draft is already persisted). Pipeline result + audit metadata gain notification counts (dispatched / queued / suppressed / failed).
- `apps/worker/src/cron/owner-digest.ts` + new cron `0 21 * * *` (07:00 AEST daily). Groups queued `notification_log` rows by owner, sends one combined email per owner via Resend, marks rows `sent`. Idempotent on `status='queued'`; per-owner failures don't tank the batch. `src/index.ts` `scheduled()` now dispatches three crons (daily refresh / daily digest / weekly drift).
- Tests: `twilio.test.ts` (4), `resend.test.ts` (6), `notifier.test.ts` (24 — every profile × hours × safety_critical × prefs resolution + business-hours math), `owner-digest.test.ts` (8 — aggregate / skip-future / skip-no-email / continue-on-resend-error / continue-on-agency-scan-error / re-queue-on-update-failure). Pipeline tests extended with the emergency path (notifier called, audit counts, swallow-on-failure). Env tests extended for the new vars.

**Deferred (intentional, surfaced now):**
- Live device validation (real SMS delivered within 30s; combined digest email per owner) — needs Twilio test account + Resend account + hosted Supabase.
- Per-agency business hours — single pilot agency; QLD-hardcoded for v1.
- Per-agency notification templates — string templates in `services/notifier.ts` for v1.
- QLD public holidays — skipped from business-hours math.

**Definition of done:** (pending test system)
- Test SMS arrives on a real device within 30s of a fake emergency draft
- Suppression logic is testable and audited
- Daily digest job runs and sends a single combined email per owner

---

## Milestone 8 — Dashboard MVP `[DONE — code complete, runtime DoD pending test system]`

The PM-facing daily review queue.

**Status:** All M8 code is written and `pnpm exec biome check .` + `pnpm -r typecheck` + `pnpm -r test` pass (web suite: 4 files / 29 tests — `svelte-check` 0 errors / 0 warnings; worker 154; prompts 18; shared 1; db 3 skipped). The dashboard can't be exercised end-to-end until there's a Supabase to authenticate against + seed data — same code-now-runtime-later pattern as M5–M7. Local `supabase start` + seed clears most of the runtime DoD; hosted (Phase B) is needed for the deployed dashboard.

**Tasks (done):**
- Web foundation: Tailwind v4 (`@tailwindcss/vite` + CSS-first `@theme` tokens in `src/app.css`), shadcn-svelte-style primitives owned in `lib/components/ui` (button, card, badge, input, textarea, label, separator, a hand-rolled accessible dialog, svelte-sonner toaster), `cn()` util, `components.json`.
- Auth: `hooks.server.ts` builds a cookie-bound Supabase server client + `safeGetSession` (validates via `getUser`, reads `agency_id` from `app_metadata`), guards all non-public routes → `/login`. `app.d.ts` Locals typing. `/login` (email+password + Google OAuth actions, open-redirect-guarded), `/auth/callback` (code exchange), `/logout`. Browser client singleton in `lib/supabase-browser.ts` for realtime.
- Shell: `+layout.server.ts` loads session + agency name; `+layout.svelte` top nav + mobile bottom nav + sign-out + Toaster, hidden on `/login`.
- Shared lib (unit-tested): `format.ts` (relative time + label/variant maps), `queue-filters.ts` (parse/serialise/apply/sort/isAlert), `draft-diff.ts` (edit diff), `types.ts` (row + config types). Server query module `lib/server/drafts.ts` (queue / alerts / PM fetches).
- `/queue` — server load (pending drafts joined to inbound email), URL-driven category/escalation/PM filters applied client-side, `DraftRow` cards, empty states, realtime subscription on `ai_drafts` → `invalidateAll`.
- `/queue/[draftId]` — split panel (read-only inbound | editable subject+body + PM review notes), `saveEdit` action (diff → `draft_edits` insert + `status='edited'`), `discard` action (dialog reason → `status='discarded'` + `audit_log`), Approve & Send → client POST to `PUBLIC_WORKER_URL/api/drafts/:id/send` (handles the absent M9 route with an info toast), edit history.
- `/alerts` — escalation / emergency / safety-critical / do-not-send stream (server `.or()` filter), realtime.
- `/settings` — `agency_config` editor: spending-authority thresholds, repeatable tradie + voice-sample editors, house rules (read-write); lean notes + quote exceptions (read-only). Owner-notification-prefs UI deferred to M10.
- Tests: vitest (jsdom + `@testing-library/svelte`) — `format`, `queue-filters`, `draft-diff` unit specs + `DraftRow` component spec (29 total). Playwright config + a gated `e2e/queue.spec.ts` (self-skips unless `RUN_E2E_TESTS=1`). `biome.json` now also excludes `**/*.css` (Tailwind v4 `@theme` isn't biome-parseable).

**Deferred (intentional, surfaced now):**
- Live run: login → queue, two-tab realtime, mobile-on-device — need a Supabase + seed (local clears most; hosted for the deploy).
- Owner notification preferences editor — DB-edited for now; UI in M10 onboarding/polish.
- Approve & Send is wired but the Worker route is M9; until then it surfaces an info toast.
- Nominated-repairer editor — flagged in settings, DB-edited for now.

**Definition of done:** (pending test system)
- PM logs in, sees the queue, can open and edit a draft
- Edits persist via `draft_edits` rows
- Realtime: opening the dashboard in two tabs, a new draft appears in both without refresh
- Mobile-responsive (PMs check this on phones)

---

## Milestone 9 — Send path `[DONE — code complete, runtime DoD pending Phase B]`

Wire the Approve & Send button to Gmail.

**Status:** All M9 code is written and `pnpm exec biome check .` + `pnpm -r typecheck` + `pnpm -r test` pass (worker 20 files / 179 tests incl. send + bounce; web 29; rules 61; prompts 18; shared 1; db 3 skipped). Decisions (made by the human 2026-05-29): send from the shared **agency mailbox** using M5's agency-level Vault token (per-PM Gmail deferred behind a `resolveSendIdentity` seam); **only the assigned PM** (or an unassigned draft) may be sent; **bounce handling is in scope**. Runtime DoD deferred until Phase B (hosted Supabase + agency Gmail OAuth + a `SUPABASE_JWT_SECRET` wrangler secret).

**Tasks (done):**
- Migration `0009_bounce_tracking.sql`: `ai_drafts.bounced_at` + `bounce_detail` (+ partial index); `email_messages.is_bounce` + `bounce_of_email_message_id`. `docs/schema.sql` reconciled; `packages/db/src/types.ts` hand-edited (run `pnpm db:types` after applying).
- Worker `lib/env.ts` gains `SUPABASE_JWT_SECRET`; `lib/auth.ts` verifies the dashboard's Supabase access token (HS256, alg-pinned, aud/iss checked) → `{ authUserId, agencyId }`.
- `services/gmail.ts` `usersMessagesSend` (raw + threadId); `services/mime.ts` `buildRawMessage` (In-Reply-To / References / controlled Message-ID, CRLF-injection guard, UTF-8 base64url); `services/send-identity.ts` `resolveSendIdentity` (agency token now, per-PM-ready seam, From = "PM — Agency").
- `routes/send.ts` `POST /api/drafts/:id/send`: JWT → active `agency_users` row → load draft (agency-scoped) → assigned-PM/unassigned authz → state guard (`pending`/`edited` only, else 409) → `draft_edits` on change → send in-thread → outbound `email_messages` written **before** flipping `status='sent'` (fail-safe: a send failure does NOT flip status) → claim `assigned_pm_id` if null → audit. Registered in `index.ts`.
- Bounce ingestion: `email-parser.ts` detects DSNs + extracts the failed Message-ID from nested parts; `gmail-webhook.ts` `handleBounce` links the DSN to the originating draft (outbound `message_id_header` → `sent_gmail_message_id`), marks it bounced, records the bounce row, and SKIPS the draft pipeline. Audit tallies `bounces_detected` / `bounces_matched`.
- Dashboard: Approve & Send now surfaces the server error on failure (M9-absent stub removed); a "Bounced" badge on `/alerts` + the draft detail with the bounce reason; `/alerts` `.or()` includes `bounced_at`. Two M8 audit nits fixed (`TODO(types)` comment; discard 403-on-missing-actor).
- Tests: `send.test.ts` (9), `auth.test.ts` (7), `mime.test.ts` (5), `email-parser-bounce.test.ts` (3), webhook bounce path (+1); env + dashboard `QueueItem` fixtures updated.

**Deferred (intentional, surfaced now):**
- Per-PM Gmail send (personal / agency sub-addresses) — agency mailbox for v1; swap in `resolveSendIdentity` once onboarding populates `agency_users.gmail_oauth_vault_key`.
- Asymmetric Supabase JWT verification (JWKS) — HS256 shared secret for v1; switch if the project moves to asymmetric signing keys.

**Definition of done:** (runtime pending Phase B)
- Approve & Send sends a real email from the agency mailbox in the original thread
- A real bounce surfaces against the draft in the dashboard

---

## Milestone 10 — Polish + onboarding `[CURRENT — buildable slice done; onboarding + backfill pending Phase B]`

Make it usable for the pilot agency.

**Status:** The dashboard-only / no-Phase-B slice is built and green (`pnpm exec biome check .` + `pnpm -r typecheck` + `pnpm -r test`: web 43, worker 179, rules 62, prompts 18, shared 1; db 3 skipped). Adversarially reviewed (2 agents); the two serious findings (a missing server-side role check on the settings save action; a concurrent-activation race that could leave two active prompt versions) are fixed. The two remaining tasks (onboarding flow, 30-day backfill) need a hosted Supabase + live Gmail and are deferred to Phase B.

**Tasks (done — buildable slice):**
- **Audit-log viewer** `/audit`: agency-scoped, paginated (50/page), filter by action substring / actor type / from-date. `lib/server/audit.ts` + `lib/audit-filters.ts` (pure parse/serialise, tested).
- **Prompt-version management** `/settings/prompts` (admin/principal only, enforced in load AND action): list versions (active badge, global badge), LCS line-diff (`lib/prompt-diff.ts`, tested) of any version vs active, and **activate** — appends a new active row + closes the old window (never edits content in place; audit-logged). Migration `0010` adds a partial unique index `(agency_id) WHERE active_to IS NULL` so concurrent activations can't create two active rows.
- **Pilot-PM guide**: `docs/PM_GUIDE.md` + in-app `/help` page (the flow, every flag's meaning, the never-auto-send rule).
- Nav: Audit + Help links (mobile grid widened to 4); admin-only "Manage prompt versions" link on Settings.
- **Security hardening (from review):** the `/settings` save action is now gated to admin/principal (was unguarded — any PM could POST). Non-admins get a read-only settings view. **NOTE: this makes agency settings admin/principal-only to edit — loosen if PMs should edit.**

**Deferred to Phase B (intentional):**
- Onboarding flow (create agency / invite PMs / Gmail OAuth connect) — needs hosted Supabase + Gmail OAuth.
- 30-day backfill (suppressing owner alerts on historical emergencies) — needs live Gmail.

**Definition of done:**
- A fresh agency can be onboarded end-to-end in under 30 minutes
- The pilot agency processes their actual mail for one week without manual intervention beyond the queue review

---

## Phase 2 — Proactive outbound sequences `[DONE — code complete, runtime DoD pending live data]`

Master spec §8. Automate the recurring *outbound* work — detected on a schedule, drafted
into the SAME review queue as inbound replies (`ai_drafts.draft_source='sequence'`), still
human-sent (§13). Built on Cloudflare Cron Triggers + Supabase state tables (NOT Inngest —
per the committed stack), reusing the existing queue → edit → send → audit → realtime stack.
All four scanners run under **one daily cron** (`0 22 * * *`) via `cron/sequences.ts`, to stay
under Cloudflare's cron-trigger cap. Full handoff: **`docs/PHASE_2_OUTBOUND.md`**.

**Status:** All code is written and `pnpm exec biome check .` + `pnpm -r typecheck` +
`pnpm -r test` pass (rules 68, prompts 42, shared 1, web 43, worker 257; db 3 skipped).

**Tasks (done):**
- **Foundation** — migration `0012`: `ai_drafts.email_message_id` made nullable + a
  `draft_source` enum (`inbound_reply`|`sequence`), `sequence_run_id`, `recipient_email/name`,
  `tenancy_id`, `property_id` on `ai_drafts`; new `sequences` (per-agency enablement/config)
  + `sequence_runs` (one idempotent run per cycle, unique on `dedupe_key`) + enums + RLS.
  `@pm/shared` sequence enums/contracts; `@pm/db` types hand-edited.
- **Template engine** (`@pm/prompts/templates`, spec §5b) — deterministic `{{slot}}` merge
  that refuses to emit a half-merged message; one vetted template per sequence. No LLM →
  no hallucination, encodes compliant language.
- **Lease-renewal** — `cron/lease-renewal.ts` (daily): fixed-term tenancies within the lead
  window → compliant rent-review window from `@pm/rules` (never a rent figure) → renewal-offer
  draft. Outbound drafts made reviewable (queue/detail null-inbound handling) and sendable
  (`/api/drafts/:id/send` outbound branch: new email, new thread, no In-Reply-To).
- **Inspection scheduling** — `cron/inspection.ts` (daily): routine inspections falling due →
  compliant proposed entry date from `@pm/rules` (7-day Form 9 notice + 3-month frequency cap)
  → scheduling draft. Migration `0013` adds `tenancies.last_routine_inspection_date`. New
  `@pm/rules` `earliestRoutineInspectionDate` / `entryNoticeRequirements`.
- **Owner month-end updates** — `cron/owner-update.ts` (monthly): one summary draft per owner
  from last month's activity on their properties.
- **Arrears** — `cron/arrears.ts` (daily): one courtesy reminder per manually-flagged arrears
  episode (migration `0014` adds `tenancies.arrears_since`). Escalation to the PM is an
  operational policy threshold (configurable), NOT a statutory assertion — the Form 11 call
  stays with the PM (the threshold isn't in the rules seed; we never invent a regulatory fact).

**Deferred (intentional, surfaced now):**
- Multi-step chasers (follow-up reminders / response tracking) per sequence — v1 drafts one
  message per cycle; `sequence_runs.next_action_at` + state machine are in place for this.
- CRM payment feed for arrears (manual `arrears_since` flag for v1; CRM adapter is later).
- Seeding the statutory arrears threshold (Form 11, 7-day) into `@pm/rules` so arrears can
  compute the eligibility date instead of deferring entirely to the PM.
- Per-agency sequence config UI (sequences are enabled-by-default; `sequences.config` is
  DB-edited for now — `lead_days`, `interval_months`, `escalate_after_days`).

**Definition of done:** (runtime pending live data)
- A real upcoming expiry / due inspection / flagged arrears / month-end produces a correctly
  timed, compliant draft in the queue, idempotently (re-scans are no-ops).
- An outbound sequence draft sends as a new email from the agency mailbox and is recorded.

---

## Phase 3 — Maintenance coordination `[DONE (M1–M3) — code complete, runtime DoD pending live data]`

Master spec §9. Automate the highest-effort-per-instance workflow: a maintenance request →
triage (EMERGENCY vs routine via the rules-engine s214 list) → tradie quote requests → owner
approval (spending-authority gated) → scheduling → close-out. The agent runs the coordination
and drafts every message; the PM makes the judgement calls and approvals. Jobs are created
**PM-initiated** from a MAINTENANCE draft. Full handoff: **`docs/PHASE_3_MAINTENANCE.md`**.

**Milestone 1 (DONE)** — job foundation + tradie quote requests. `pnpm exec biome check .` +
`pnpm -r typecheck` + `pnpm -r test` pass (rules 68, prompts 47, web 43, worker 267; db 3 skipped).
- Migrations `0015` (`draft_source += 'maintenance'`, separate so PG commits the enum value) +
  `0016` (`maintenance_jobs` table: classification / state machine / quotes jsonb /
  owner_approval_state / spend / schedule; `ai_drafts.maintenance_job_id`; widened source-shape
  guard; RLS; realtime). `@pm/shared` job enums + `MaintenanceQuote`; `@pm/db` types hand-edited.
- Templates (`@pm/prompts`): tradie quote-request + owner-approval-request (never commits the
  owner, never promises a tradie time; surfaces the spending threshold).
- Worker `services/maintenance.ts` + `POST /api/maintenance/jobs` (JWT-authed): create a job
  (s214-triaged), then draft tradie quote-requests to the agency's approved tradies for the
  trade — as outbound `ai_drafts` (`draft_source='maintenance'`) in the same review queue.
  Idempotent per source draft.
- Dashboard: "Create maintenance job" on a MAINTENANCE draft; `/maintenance` jobs list + job
  detail (quotes + drafts); outbound rendering generalised to any `draft_source != inbound_reply`.

**Milestone 2 (DONE)** — owner-approval flow + quote chasers.
- Worker service + routes: `recordQuote`, `draftOwnerApprovalRequest` (resolves the spending
  threshold — per-owner exception, else the agency routine threshold — and uses the lowest quote
  as the estimate; drafts the owner-approval request; moves the job to awaiting_owner_approval),
  `recordOwnerDecision` (approved/declined + approved spend). Routes
  `POST /api/maintenance/jobs/:id/{quotes/:quoteId,owner-approval,decision}`.
- Quote chasers: `cron/maintenance-chasers.ts` runs in the daily sequence sweep; chases stale
  `requested` quotes (idempotent via `quotes[].chased_at`).
- Dashboard: job-detail actions (record quote amount, request owner approval, record decision).

**Milestone 3 (DONE)** — scheduling + close-out.
- Worker service + routes: `scheduleJob` (optionally accept a quote, draft a tenant
  access-arrangement message, set `scheduled_for`, move to `scheduled`), `closeOutJob`
  (`completed`), `cancelJob` (`cancelled`). Routes
  `POST /api/maintenance/jobs/:id/{schedule,complete,cancel}`. Scheduling template in `@pm/prompts`.
- Dashboard: job-detail schedule/complete/cancel controls. Closes the state machine
  (new → quoting → awaiting_owner_approval → approved → scheduled → completed; cancellable).

**Deferred (later phases):**
- Tradie email capture in `agency_config.approved_tradies` (quote requests currently use a
  contact containing "@"; tradies with only a phone are skipped with a count). A tradie portal
  (accept/complete/invoice) is later-phase.

**Definition of done (M1–M3):** (runtime pending live data) — a PM turns a real maintenance email
into a triaged job, tradie quote requests land in the queue, the spending-authority gate drafts an
owner-approval request, the owner's decision is recorded, and the job is scheduled (tenant message
queued) and closed out.

---

## Phase 4 — Document + compliance engine `[M1 DONE — code complete, runtime DoD pending live data]`

Master spec §10. Generate QLD statutory documents from data + the rules engine — no statutory
field/date is ever LLM-generated, and a document whose statutory basis the rules engine can't
confirm isn't generated (anti-invention). Full handoff: **`docs/PHASE_4_DOCUMENTS.md`**.

**Milestone 1 (DONE)** — the engine + two rules-backed document types.
- New stack-agnostic **`@pm/documents`** package: `DocumentModel` builders + an HTML renderer.
  **Entry Notice (Form 9)** (7-day notice + 3-month cap from `@pm/rules`) and **Rent-Increase
  Notice** (`assessRentIncrease`: 2-month notice, property-based 12-month rule). Builders throw
  `DocumentNotCompliantError` rather than emit a non-compliant document.
- Migration `0017` (`documents` table: type, form_id, fields jsonb, content, rule_versions, RLS).
  `@pm/shared` doc enums; `@pm/db` types hand-edited.
- Worker `services/documents.ts` + `POST /api/documents` (resolve data → build → render → persist
  with rule versions → audit). Dashboard `/documents` (generate form + list) + `/documents/[id]`
  viewer with Print / Save-as-PDF.
- v1 stores rendered **HTML inline** (print-to-PDF), not a binary PDF in Storage — compliance
  core identical; binary PDF is a renderer-only follow-up.

**Deferred:** Forms 11/12/13/R12 (need their notice periods seeded into `@pm/rules` first —
anti-invention); binary-PDF + Storage; condition reports.

---

## Phase 5 — SMS front door `[DONE — code complete, runtime DoD pending Twilio config]`

Master spec §11. Inbound SMS → capture + classify + draft a reply → queue for PM review/send.
**Never auto-sent** (the §11-vs-§13 tension resolved in favour of the hard rule §13). Full handoff:
**`docs/PHASE_5_SMS.md`**.

- Migration `0019` (`sms_messages` + enums; RLS + realtime); `@pm/shared` SMS enums; `@pm/db` types.
- Worker: signature-verified Twilio webhook `POST /webhook/sms/:agencyId` (Web Crypto HMAC-SHA1) →
  classify (escalation-first, §13) → resolve tenant/property/open-job → draft a status/holding
  reply (escalations get none) → persist. `POST /api/sms/:id/send` (PM approves → Twilio send +
  outbound row). Dashboard `/sms` review page + nav.
- **Deferred:** voice layer (separate provider integration); per-agency SMS number in config.
- **To RUN:** a Twilio number off-trial + its inbound webhook pointed at `/webhook/sms/<agency_id>`.

**Definition of done:** (runtime pending Twilio config) — a real inbound status text is captured,
classified, a correct status reply drafted, the PM sends it; escalations are flagged, never
auto-handled.

---

## Future milestones (Phase 6+ / beyond the spec)

Listed here for planning — do not start without explicit direction.

- **Voice** (the other half of §11) — AI voice front door (telephony provider).
- Owner portal (read-only) / Tenant portal (log requests, view tenancy details).
- Listings & leasing pipeline; lease lifecycle (Form 18a, renewals, rent reviews, EOT).
- Trust accounting (only after design review + compliance plan).
