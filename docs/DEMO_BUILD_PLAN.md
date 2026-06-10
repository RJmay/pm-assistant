# Demo Mode + Onboarding Wizard — build plan

*Phase 0 audit + implementation plan. Written June 2026, before any code in this work unit.*

---

## ⚠️ Stack reality check (read first)

The work brief described the repo as "Next.js + Supabase + Inngest". **That is not this
codebase.** The committed, deployed stack (per `CLAUDE.md`, which forbids silent stack
changes) is:

- **SvelteKit** dashboard on Cloudflare Pages (`apps/web`)
- **Cloudflare Worker** backend, Hono router (`apps/worker`) — no queue runner; Inngest was
  explicitly evaluated and **deferred** (CF cron + Pub/Sub + `waitUntil` cover v1)
- **Supabase** Postgres + Auth + Vault + Realtime (hosted project, Singapore region)
- Gmail API per-agency OAuth for both ingestion (watch → Pub/Sub) and sending

Everything below is built on the actual stack, per the brief's own constraint
("match the repo's existing patterns").

---

## Phase 0 — Audit

### Auth flow & tenant model

- **Tenant = `agencies` row.** Every business table carries `agency_id`; RLS policy
  `tenant_isolation` (`FOR ALL`, `USING`/`WITH CHECK agency_id = auth_helpers.current_agency_id()`)
  on each. The helper reads `app_metadata.agency_id` from the JWT.
- **Users:** Supabase Auth (email + password today; no self-serve signup — users are
  provisioned via console/script). `agency_users` links `auth_user_id` → agency with a role
  (`pm` / `principal` / `admin`).
- **Dashboard:** `hooks.server.ts` builds an RLS-scoped server client per request
  (`locals.supabase`, `locals.agencyId`). Browser client used for Realtime + for Bearer
  tokens on Worker calls.
- **Worker:** verifies the dashboard JWT (`lib/auth.ts` — ES256 via project JWKS or legacy
  HS256), then uses the **service-role** key and explicitly scopes every query by the
  verified `agency_id`.

### Inbound email pipeline (end to end)

1. Agency mailbox connected via **Gmail OAuth** (`/oauth/gmail/start?agency_id=…`) → refresh
   token in Supabase **Vault**, `users.watch` → Pub/Sub topic, state in `agency_email_state`.
2. **Pub/Sub push** → `POST /webhook/gmail`: verify Google's OIDC JWT → resolve agency by
   mailbox → refresh access token → `users.history.list` since `last_history_id` → fetch each
   new message → parse (`services/email-parser`) → bounce handling → upsert `email_threads`,
   insert `email_messages`.
3. **Drafting** happens after the Pub/Sub ACK in `executionCtx.waitUntil`:
   `runDraftPipeline(supabase, input, { anthropicApiKey, env, logger })` — input is
   `{ agencyId, emailMessageId, threadId, gmailThreadId, fromAddress, fromName, toAddresses,
   subject, bodyPlain, bodyHtml, receivedAt }`. The pipeline: loads agency config + the
   **active `prompt_versions` row** (DB-driven prompt, currently v2.4), matches
   property/tenant by sender email (`services/matcher`, `exact_email` → thread → fuzzy),
   assembles the system prompt (`@pm/prompts`), calls Claude with **tool-use structured
   output**, applies the deterministic compliance floor (`@pm/rules`), writes `ai_drafts`
   (+ `model_calls`, audit), and fires **owner alerts** via
   `dispatchOwnerNotification` (Twilio SMS / Resend email) when flagged.
4. **Review:** dashboard `/queue` (RLS + Realtime) → edit → **Approve & Send** → Worker
   `POST /api/drafts/:id/send`: JWT → state guards (`pending|edited`, hard `do_not_send`
   gate) → Gmail send from the agency mailbox → outbound `email_messages` row →
   status `sent` (optimistic lock). **The AI never sends; a PM click does.**

### QLD compliance layer

- **`@pm/rules`** — deterministic, versioned rules (`QLD_RULES` seed with source notes;
  engine accessors `getRule`/`getConfiguredRule`; unconfirmed values throw — the engine
  refuses to guess, spec §0.3). Covers: entry notice (Form 9) + frequency caps, emergency
  repairs s214, rent-increase frequency/notice, breach notices (Form 11 variants), notices
  to leave (Form 12), notice of intention to leave (Form 13, all grounds), form registry
  (`getFormById`/`selectForm`).
- **`@pm/documents`** — rules-backed statutory document builders (Forms 9/11/12/13,
  rent increase) rendered as HTML + real PDF.
- **Drafting prompt v2.4** (DB: `prompt_versions`) carries the conduct/tone/compliance
  *behavioural* layer; numeric/statutory values come from the rules engine, not the LLM.
- **Regulatory monitoring bot** (spec §12) watches sources and surfaces alerts in
  `/settings/regulatory`.
- **Coverage note for demo scenarios:** pets, smoke alarms, water charging and bond top-up
  have **no engine-backed numeric rules** (deliberate v1 scope) — the drafting prompt handles
  them textually. Demo compliance chips for those scenarios are *process* chips (no statutory
  numbers), so we never invent a legal fact (§0.3).

### Seed / fixture / migration / test infra

- Migrations `supabase/migrations/0001…0021`, **append-only**; applied to hosted via
  `supabase db push` or the `postgres` driver with `DATABASE_URL` from
  `packages/db/.env.local` (gitignored). `docs/schema.sql` is the source of truth;
  `packages/db/src/types.ts` is hand-edited per migration.
- Existing seed-ish tooling: migration-embedded test-agency fixtures (M1) and
  `scripts/onboard-agency.mjs` (plain Node + `postgres` driver, `--env-file` pattern —
  PowerShell-safe). **This is the pattern the demo seed follows.**
- Tests: Vitest per package (worker 319 — with an in-memory fake Supabase helper
  `apps/worker/test/helpers/fake-supabase.ts`; web 72; rules 83; documents 23; prompts 50);
  Playwright config exists in `apps/web/e2e`. CI = typecheck + `biome check` + tests → deploy.

### Frontend routing & components

- Routes: `/queue` (+`[draftId]`), `/alerts`, `/properties` (+`[id]`), `/maintenance`
  (+`[jobId]`), `/documents` (+`[id]`), `/sms`, `/audit`, `/settings` (+`prompts`,
  `regulatory`), `/login`, `/help`. Root `+layout.svelte` holds the nav (desktop top bar +
  mobile bottom grid — **grid-cols must equal nav item count**).
- Components: shadcn-svelte (`Badge`, `Button`, `Card`, `Dialog`, `Input`, `Label`,
  `Textarea`, `Separator`, sonner toasts) + custom `DraftRow`/`PropertyRow`. Server data via
  `$lib/server/*` query modules; mutations via form actions on `locals.supabase`
  (plain DB writes) or `fetch` → Worker with a Bearer token (side-effectful sends).

---

## Implementation plan (decisive choices + tradeoffs)

### Phase 1 — Demo mode

1. **Schema (migration `0022_demo_onboarding.sql`, additive only):**
   - `agencies.is_demo boolean not null default false` — per-tenant flag, coexists with
     real pilots. (No global env flag needed for the core; a `PUBLIC_DEMO_AFFORDANCES` env
     could later gate extra UI, but `is_demo` alone is sufficient and safer.)
   - `demo_scenarios` table (agency-scoped, RLS `tenant_isolation`): key, title,
     description, sender, subject, body, `compliance jsonb` (array of
     `{ ruleKey? formId? label }` — **rule keys resolved through `@pm/rules` at render
     time**, never hardcoded numbers), `sort_order`, `used_at`, `last_email_message_id`,
     `last_draft_id`.
   - `onboarding_progress` table (agency-scoped, RLS): `current_step`, `completed_steps`,
     `data jsonb` — server-side wizard persistence (survives refresh + logout).
2. **Hermetic seal at the transport layer:**
   - `POST /api/drafts/:id/send`: the route already loads the agency — it now also reads
     `is_demo`. Demo agency → **no Gmail call ever**: instant sandboxed "send" (outbound
     `email_messages` row with a `demo-` marker id, audit `draft.sent` with
     `sandbox: true`, same optimistic status flip). Asserted by a worker test.
   - `dispatchOwnerNotification`: checks `agencies.is_demo` before any Twilio/Resend call →
     logs a sandboxed `notification_log` row instead. (Demo scenario #1 triggers an
     emergency owner alert — without this gate a demo would SMS a real number.)
   - Defense in depth: demo agencies are seeded with **no Vault token and no
     `agency_email_state`**, so even a missed branch has no transport to use.
3. **Seed (`pnpm seed:demo` / `pnpm reset:demo`):** `scripts/seed-demo.mjs` (Node +
   `postgres` driver, same as `onboard-agency.mjs`; PowerShell-safe). Fixed UUIDs
   (`dd…` prefix) → **idempotent**: delete demo agency (FK cascade wipes everything) →
   recreate. Coastline Property Management (Demo), Maroochydore; 25 properties across
   Maroochydore / Coolum Beach / Buderim / Caloundra (fictional streets, no unit-level real
   addresses); owners/tenants with realistic fictional Australian names; rents $450–$850/wk;
   bond = 4× weekly rent with RTA reference; 2 PM users (auth users created via SQL with
   bcrypt `crypt()`, password from `DEMO_PM_PASSWORD` env or printed default; falls back
   with clear instructions if auth insert is restricted); agency_config (tone
   "professional, warm", signature, nominated repairer + tradies); active v2.4 prompt row;
   10 scenarios. Fixture data in `scripts/demo-fixtures.mjs` (plain JS module — also
   imported by worker tests for invariant checks; `@pm/shared` exports raw TS so a `.mjs`
   CLI can't import it).
   - **Tradeoff — "payment histories":** the schema has no payments ledger (deliberate v1
     scope: trust accounting stays in PropertyMe etc.). Arrears is modeled by
     `tenancies.arrears_since` — the demo's arrears scenario uses it (9 days, computed
     relative to seed time). No new ledger table.
4. **Reset:**
   - CLI `pnpm reset:demo` = full structural rebuild (delete + reseed, <10 s).
   - UI "Reset demo" button (demo tenants only) → Worker `POST /api/demo/reset`: wipes
     demo-agency *activity* (drafts, emails, threads, jobs, documents, notifications,
     audit), restores scenario availability (`used_at = null`), and refreshes
     relative dates (arrears back to 9 days ago, inspection anchors). **Tradeoff:** the UI
     reset restores pristine *state*, not structure — if someone deletes seeded entities,
     run the CLI. (Keeping the full fixture set out of the Worker bundle; one source of
     truth for structure = the CLI.)
5. **Inject (`POST /api/demo/inject`):** dashboard JWT + `is_demo` assert → load scenario →
   synthesize the inbound (`email_threads` upsert + `email_messages` insert with `demo-`
   gmail ids — same persist shape as the webhook) → run **the real `runDraftPipeline`**
   (real prompt, real Claude call, real matcher — sender addresses are seeded tenant/owner
   emails so matching exercises `exact_email`) → mark scenario used → return
   `{ emailMessageId, draftId }`. "Surprise me" = client picks a random `used_at IS NULL`
   scenario. Optimistic "drafting…" state in the panel; target <15 s (one Claude call).
6. **Demo panel (web):** floating, demo-tenants-only (layout load exposes `isDemo`),
   lists scenarios with compliance chips (resolved client-side via `@pm/rules` — web gains
   a workspace dep on it), inject buttons, Surprise me, Reset demo. Draft detail page shows
   a **"Compliance" panel** on demo tenants for injected drafts (scenario matched via
   `last_draft_id`/`last_email_message_id`), rendering engine-resolved chips, e.g.
   "Entry notice — Form 9 — minimum notice per `entry_notice_routine`". 390 px friendly.
7. **`docs/DEMO_SCRIPT.md`** — 10-minute talk track (1 context / 6 live: maintenance →
   arrears → inspection / 2 wizard / 1 close), incl. the "what if the AI gets the law
   wrong?" answer.

### Phase 2 — Onboarding wizard

- **Route `/onboarding`** (5 steps, each skippable; progress in `onboarding_progress`).
- **Step 1 Account:** `/signup` with **magic-link** (`signInWithOtp`) — no passwords. After
  auth, the wizard's first action calls Worker `POST /api/onboarding/provision`
  (service-role: create agency + `agency_users` row + set `app_metadata.agency_id` via the
  admin API; client refreshes the session to pick up the claim). Agency name + suburb;
  logo upload deferred to a placeholder field (no storage bucket in scope).
- **Step 2 Connect email — decisive inversion of the brief:** the repo's working
  integration is **Gmail OAuth**; a forwarding-address path needs inbound-parse infra
  (ingest domain, MX, a parser) that does not exist and is a new stack component. So:
  **Path A (real) = "Connect Gmail"** → `/oauth/gmail/start?agency_id=…`, with a live
  "✓ Mailbox connected" check (polls `agency_email_state`). **Path B (stub) = forwarding
  address behind a `comingSoon` flag** with the UI built but disabled. Microsoft 365: stub.
- **Step 3 Import portfolio:** CSV upload → header-preset detection (**PropertyMe /
  Console Cloud / VaultRE** common export headers) → column-mapping UI with manual
  fallback → per-row validation (address required, rent numeric, email shape, dates) →
  preview with inline fixes → import via RLS inserts (owners → properties → tenancies →
  tenants) in the page's form action. "Start with sample data" creates one clearly-marked
  sample property + tenant.
- **Step 4 Voice & guardrails:** tone, signature, business hours → `agency_config`;
  the safety banner "Drafts only — nothing sends without your approval" rendered as a
  **locked** setting (auto-send shown as future, not a toggle).
- **Step 5 First draft:** Worker `POST /api/onboarding/first-draft` — creates the sample
  tenancy if missing and injects scenario #1 (hot water) through the real pipeline into
  *their* tenant. End screen: done/pending checklist + "book a 15-min setup call" link.

### Phase 3 — quality bar

- Tests added: fixture invariants (25 properties, suburbs, rent band, bond = 4×, unique
  emails, scenario→tenant mapping resolves); send-sandbox interception; inject route;
  CSV parser + presets + row validation; wizard progress persistence helpers.
- Full suites + `biome check --write` + `pnpm -r typecheck` green; adversarial review
  workflow over the diff before deploy; live probe on the deployed demo tenant (inject →
  draft → sandboxed send).
- Mobile: panel + wizard use the existing responsive patterns; verified at 390 px.

### Post-review hardening (adversarial review found 12, all fixed)

The pre-deploy adversarial review confirmed 12 findings; every one was fixed before merge.
The notable ones: the SMS reply/webhook path got the same transport-layer demo seal as
email + notifications (Twilio creds are global env — data-absence was not a seal);
`agencies` gained the UPDATE RLS policy it never had (dashboard updates silently
matched 0 rows — the wizard's voice step would have dropped business hours);
provision is self-healing across partial failures (no more signup-bricking on the
unique `auth_user_id`); the CSV import is idempotent by address (retry/double-click
safe). One accepted tradeoff: the CSV import remains row-by-row rather than a single
DB transaction — idempotency makes retries converge; a transactional `import_portfolio`
RPC is the future hardening if imports grow past ~1000 rows.

### Out of scope (named, not silently dropped)

- Real forwarding-address ingestion (new infra; stubbed behind a flag).
- Microsoft 365 OAuth (stub).
- Logo storage (placeholder field only).
- A payments ledger (not in the data model; arrears via `arrears_since`).
