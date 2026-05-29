# BUILD_PLAN.md

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

## Milestone 9 — Send path `[CURRENT]`

Wire the Approve & Send button to Gmail.

**Tasks:**
- Build `apps/worker/src/routes/send.ts`
- RLS check via authed JWT passed from dashboard
- Capture diff to `draft_edits` if the body changed
- Use the PM's Gmail token to send in-thread (set `threadId`, `In-Reply-To`, `References`)
- Persist outbound `email_messages` row
- Update `ai_drafts.status = 'sent'`, set `sent_at`
- Audit log entry
- Return 200 with the sent message id

**Definition of done:**
- Approve & Send sends a real email from the PM's Gmail in the original thread
- Bounces (if any) come back through the inbound pipeline and surface to the PM

---

## Milestone 10 — Polish + onboarding

Make it usable for the pilot agency.

**Tasks:**
- Onboarding flow: an admin can create a new agency, invite PMs, set up Gmail OAuth, configure tradies/voice samples
- Backfill: pull last 30 days of email from the agency's Gmail and process (carefully — don't notify owners of historical emergencies)
- Audit log viewer in the dashboard
- Prompt version management UI for the admin: see active version, view diffs, roll back
- Documentation for the pilot PM: how to use the queue, what the flags mean

**Definition of done:**
- A fresh agency can be onboarded end-to-end in under 30 minutes
- The pilot agency processes their actual mail for one week without manual intervention beyond the queue review

---

## Future milestones (Phase 2+)

Listed here for planning — do not start without explicit direction.

- Maintenance job tracker (drafts → jobs → tradie dispatch)
- Tradie portal (accept/complete/invoice)
- Owner portal (read-only)
- Tenant portal (log requests, view tenancy details)
- Form generation (Form 9, 11, 12, 13, 22, 23, R12 — PDF, prefilled)
- Inspection scheduling + report templates
- Listings & leasing pipeline
- Lease lifecycle (Form 18a, renewals, rent reviews, end-of-tenancy)
- Trust accounting (only after design review + compliance plan)
