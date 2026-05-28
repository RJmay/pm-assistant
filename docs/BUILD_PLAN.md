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

## Milestone 3 — Drafter (Anthropic API integration) `[CURRENT]`

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

## Milestone 4 — Worker entry + Pub/Sub webhook

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

## Milestone 5 — Gmail integration

Pull messages from Gmail and persist them.

**Tasks:**
- Build `services/gmail.ts`: per-agency Gmail client using stored OAuth refresh tokens (from Supabase Vault)
- On webhook receive: resolve `agency_id` from the Pub/Sub `subscription` name or from a config map (initial onboarding will set this up explicitly)
- Use `users.history.list` with the `historyId` to find new messages since last seen
- For each new inbound message: fetch full message, parse headers (From, To, Subject, Date, Message-ID, References, In-Reply-To)
- Upsert `email_threads` by `gmail_thread_id`
- Insert `email_messages`
- Store `historyId` somewhere (an `agency_email_state` table — add it to schema if missing)
- Add a Cron Trigger that runs daily to refresh Gmail `watch` subscriptions (they expire after 7 days)

**Definition of done:**
- A real inbound email to the pilot agency's mailbox appears in `email_messages` within seconds
- Threading works: replies to an existing thread attach to the same `email_threads` row

---

## Milestone 6 — End-to-end draft generation

Tie it together: inbound message → matcher → assemble → drafter → ai_drafts row.

**Tasks:**
- Build `services/matcher.ts` with the cascade from ARCHITECTURE.md
- After persisting an inbound message, run the matcher and update the thread's `property_id` if confidence is high
- Load `agency_config` + active `prompt_versions` row
- Call `assemble()`
- Call `drafter()`
- Persist `ai_drafts` row with the structured output
- Write to `audit_log`

**Definition of done:**
- An inbound email goes from Gmail → ai_drafts row in under 8 seconds (p50)
- Match cascade hits the right `property_id` on test fixtures
- Drift check: re-run the same email through and get a similar (not identical) draft — flag if categorisation changes

---

## Milestone 7 — Owner notification routing

If `emergency_landlord_alert: true`, dispatch via the owner's profile.

**Tasks:**
- Build `services/notifier.ts`
- Twilio client (SMS) and Resend client (email)
- Implement the profile logic from ARCHITECTURE.md
- Write `notification_log` for every attempted send, including suppressions
- Add a Cron Trigger for the 7am AEST owner digest (aggregate `pm_proxy` and queued items)
- Tests: each profile, each scenario (in/out of business hours, safety-critical or not)

**Definition of done:**
- Test SMS arrives on a real device within 30s of a fake emergency draft
- Suppression logic is testable and audited
- Daily digest job runs and sends a single combined email per owner

---

## Milestone 8 — Dashboard MVP

The PM-facing daily review queue.

**Tasks:**
- SvelteKit pages:
  - `/login` — Supabase Auth (email/password and Google OAuth)
  - `/queue` — daily review queue, default sort `priority desc, received_at asc`, filterable by category/escalation/PM
  - `/queue/[draftId]` — detail view with inbound email, draft (editable), PM review notes
  - `/alerts` — emergency alerts stream (separate from queue)
  - `/settings` — agency config editor (tradies, voice samples, spending authority, owner notification preferences)
- Real-time updates via Supabase Realtime subscription on `ai_drafts`
- Edit + Approve + Send action (calls Worker `/api/drafts/:id/send` — built next milestone)
- Edit-without-send saves as `status: 'edited'`
- Discard sets `status: 'discarded'` with a reason
- shadcn-svelte components, Tailwind
- Empty states designed (no drafts yet, no alerts, etc.)

**Definition of done:**
- PM logs in, sees the queue, can open and edit a draft
- Edits persist via `draft_edits` rows
- Realtime: opening the dashboard in two tabs, a new draft appears in both without refresh
- Mobile-responsive (PMs check this on phones)

---

## Milestone 9 — Send path

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
