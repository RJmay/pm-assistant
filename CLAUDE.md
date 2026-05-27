# CLAUDE.md

This file is read by Claude Code at the start of every session. Keep it current.

## Project

**PM Assistant** — multi-tenant SaaS that drafts email replies to inbound tenant/landlord/third-party emails for Queensland residential property management agencies. AI generates structured drafts; property managers (PMs) review and send via a daily queue dashboard.

Phase 1 (this build) is the email drafting layer for one pilot agency on the Sunshine Coast, designed multi-tenant from day one. Phase 2+ extends into a full PMS companion (maintenance jobs, tradies, owner/tenant portals, form generation, inspections). Trust accounting is deliberately out of scope for v1 — agencies keep their existing trust accounting system (PropertyMe, Console Cloud, etc.) and we integrate where useful.

## Mission of the AI drafting layer

For every inbound email, produce a structured draft that:
- Categorises the email
- Triages priority and escalation
- Flags whether the landlord needs an emergency alert
- Drafts a sendable reply that complies with QLD residential tenancy law (RTRA Act 2008 + 2024/2025 reforms)
- Surfaces review notes for the PM

The PM reviews the daily queue, edits or accepts, and sends. The AI never sends.

## Stack — committed, do not deliberate

- **Language:** TypeScript everywhere
- **Package manager:** pnpm, with workspaces
- **Monorepo layout:** apps/ + packages/
- **Frontend:** SvelteKit, deployed to Cloudflare Workers via the workers adapter (`@sveltejs/adapter-cloudflare`), with static assets on Workers Static Assets
- **UI components:** shadcn-svelte + Tailwind CSS
- **Backend worker:** Cloudflare Workers (Wrangler-managed, separate from the web app)
- **Database:** Postgres via Supabase, with Row Level Security
- **Auth:** Supabase Auth, JWT carries `agency_id` claim in app_metadata
- **Email integration:** Gmail API (per-agency OAuth, refresh tokens stored in Supabase Vault)
- **Email push:** Gmail API `watch` → Google Cloud Pub/Sub → Cloudflare Worker webhook
- **LLM:** Anthropic API, default model `claude-sonnet-4-6`. Use `claude-opus-4-7` only for LEGAL or REPUTATIONAL escalation drafts.
- **Structured output:** Anthropic tool use with strict JSON schema (NOT free-text parsing)
- **SMS:** Twilio
- **Transactional email (notifications, not the drafts themselves):** Resend
- **Realtime queue updates in the dashboard:** Supabase Realtime
- **Linting/formatting:** Biome (single tool, replaces ESLint + Prettier)
- **Testing:** Vitest for unit tests, Playwright for e2e
- **CI/CD:** GitHub Actions → Cloudflare deploy via Wrangler

If you think you have a reason to swap one of these out, stop and ask the human first. Do not silently substitute.

## Repository structure

```
pm-assistant/
├── apps/
│   ├── web/                 # SvelteKit dashboard
│   └── worker/              # Cloudflare Worker (email ingestion + drafting)
├── packages/
│   ├── db/                  # Supabase migrations + generated TS types
│   ├── prompts/             # System prompt loader + assembly + drafter
│   └── shared/              # Shared TS types, enums, zod schemas
├── docs/
│   ├── ARCHITECTURE.md      # Read first when working on cross-cutting changes
│   ├── BUILD_PLAN.md        # Ordered milestones — current work goes here
│   ├── ENV.md               # All env vars and where they're set
│   ├── schema.sql           # Source of truth for the DB shape
│   └── system-prompt.md     # The AI drafting prompt — versioned, do not edit casually
├── CLAUDE.md                # This file
├── package.json
├── pnpm-workspace.yaml
├── biome.json
└── README.md
```

## Working agreement

1. **One milestone at a time.** Read `docs/BUILD_PLAN.md`, work the current milestone to its definition of done, then stop and report. Do not skip ahead.
2. **Plan before coding.** For any milestone, write a short plan (≤10 bullets) and post it before writing code. The human will approve or redirect.
3. **Type-safe everything.** No `any` without a `// TODO(types):` comment and a follow-up issue. Use zod at every external boundary (HTTP request bodies, Gmail API responses, Claude responses, env parsing).
4. **Tests with code, not after.** Each milestone has a test suite. A milestone isn't done until tests pass.
5. **Migrations are append-only.** Never edit a committed migration. Generate a new one.
6. **Secrets never touch git.** Use `wrangler secret put` for Worker secrets, `.env.local` (gitignored) for local dev, Supabase Vault for per-agency Gmail tokens.
7. **No silent stack changes.** If the recommended approach doesn't fit, raise it in chat and propose alternatives — don't just pick one.

## Critical references

These files are the source of truth. Read them before working in their domain:

- `docs/system-prompt.md` — the prompt that drives AI drafting. **Never modify without versioning** (insert new prompt row, set active_to on old). Changes to this file must come from an explicit prompt-versioning task.
- `docs/schema.sql` — the database shape. Every migration must reconcile to this file.
- `docs/ARCHITECTURE.md` — data flow, security model, RLS pattern.
- `docs/BUILD_PLAN.md` — what to build now.
- `docs/ENV.md` — what env vars are required, where they're set, what they unlock.

## Conventions

**Naming.** snake_case in the database, camelCase in TypeScript. Generated types from `supabase gen types` are the conversion layer.

**File layout in packages/prompts.**
```
packages/prompts/
├── src/
│   ├── base/                # The base system prompt as .md, loaded at build time
│   │   └── pm-drafting-v2.1.md
│   ├── assemble.ts          # Template the base with agency config
│   ├── drafter.ts           # Call Claude with structured output
│   ├── schema.ts            # Zod schemas for Claude's structured response
│   └── index.ts
└── test/
```

**File layout in apps/worker.**
```
apps/worker/
├── src/
│   ├── index.ts             # Worker entry, route dispatch
│   ├── routes/
│   │   ├── gmail-webhook.ts # Pub/Sub push receiver
│   │   ├── send.ts          # Approved draft → Gmail send
│   │   └── health.ts
│   ├── services/
│   │   ├── gmail.ts         # Gmail API client (per-agency token)
│   │   ├── pubsub.ts        # Verify Pub/Sub signatures
│   │   ├── matcher.ts       # Property/tenant matching from sender + thread
│   │   ├── notifier.ts      # Owner notification routing
│   │   └── supabase.ts      # Service-role client
│   └── lib/
│       ├── env.ts           # Zod-validated env
│       └── log.ts
└── wrangler.toml
```

**Logging.** Use structured logs (JSON) with `agency_id`, `email_message_id`, `draft_id` whenever applicable. Never log raw email bodies in production — log a hash or a truncated preview.

**Error handling at the Worker boundary.** Every route returns a typed error response, never throws unhandled. Log + return 500 with a request_id; never return stack traces to callers.

**RLS pattern.** Every business table has `agency_id`. RLS policies use a helper function `auth.current_agency_id()` defined in `schema.sql`. The Worker uses the service-role key (bypasses RLS) and explicitly filters by `agency_id` in every query. The dashboard uses the anon key + authed JWT and relies on RLS.

## What NOT to do

- Don't put agency-specific config (tradies, voice samples, spending authority) into the prompt file. That goes in the `agency_config` table and gets templated in at runtime.
- Don't call Claude with free-text prompts expecting markdown back. Use tool use with a JSON schema. The structured fields are not optional.
- Don't store Gmail tokens in plain columns. Use Supabase Vault.
- Don't send draft emails automatically, ever. Even in tests. Mock the Gmail send in dev.
- Don't add a "model upgrade" feature that lets PMs pick their model. Model selection is a server decision.
- Don't introduce a queue/job runner (Inngest, Trigger.dev, etc.) without raising it. CF Workers + Supabase + Pub/Sub cover everything in scope for v1.
- Don't reach for an ORM (Prisma, Drizzle). Use Supabase's typed client. The schema is small enough.
- Don't build a generic AI chat interface anywhere in this product. The interaction model is structured drafts in a review queue, not chat.

## Current milestone

See `docs/BUILD_PLAN.md`. Work whatever is marked `[CURRENT]`. When done, mark it `[DONE]` and surface the next one.

## Commands

```bash
# Install
pnpm install

# Typecheck everything
pnpm -r typecheck

# Lint
pnpm lint
pnpm format

# Run local Supabase
supabase start
supabase db reset           # apply migrations from scratch
supabase gen types typescript --local > packages/db/src/types.ts

# Run worker locally
pnpm --filter worker dev

# Run web locally
pnpm --filter web dev

# Tests
pnpm -r test                # unit
pnpm -r test:e2e            # playwright

# Deploy
pnpm --filter worker deploy
pnpm --filter web deploy
```

## When stuck

If a task is blocked because a real-world dependency isn't set up (Supabase project not yet created, Gmail OAuth credentials not yet issued, etc.), stop and surface a clear list of what the human needs to provide. Do not stub past it silently.
