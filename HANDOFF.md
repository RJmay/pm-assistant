# HANDOFF — current state (2026-06-02)

Paste-ready primer for a fresh code chat. `CLAUDE.md` (stack, conventions, rules)
and `MEMORY.md` auto-load, so this file records **state**: what's live, how it's
wired, and what's left. Read top to bottom.

---

## 0. TL;DR — Phase 1 is BUILT, DEPLOYED, and LIVE

The whole product runs on hosted infrastructure and **auto-deploys from `main`**.

| Thing | Value |
|---|---|
| Worker (ingest + AI draft + crons) | `https://pm-assistant-worker.ryanmay065.workers.dev` |
| Dashboard (review queue) | `https://pm-assistant-web.pages.dev` |
| Supabase project | `deisxzmquxjaovubosil` (region **Singapore**, treated as dev/staging) |
| Cloudflare account id | `9d5299d5a1bcad11da7b2c7133359e6b` |
| Dashboard login | `ryanmay065@gmail.com` (password set in Supabase Auth; role `principal`) |
| Git | `main == origin/main`, GitHub `RJmay/pm-assistant`. CI auto-deploys on push. |

**Verified end-to-end:** real email → Gmail watch → Pub/Sub → Worker → matcher →
Claude draft → queue; hosted dashboard login + queue; owner email alert via Resend;
CI → auto-deploy.

**Verify green on a fresh checkout:** `pnpm install && pnpm -r typecheck && pnpm exec biome check .`
(tests need the `.env.local` files below + Docker for the DB suite — see §3.)

---

## 1. What's live (Phase B — all 8 stages done 2026-06-02)

1. **DB + RLS** — 11 migrations + seed applied to hosted Supabase; `packages/db/src/types.ts`
   regenerated from the live schema; RLS isolation 3/3 green vs remote.
2. **Auth** — `ryanmay065@gmail.com` Auth user, `app_metadata.agency_id` set, linked to seeded
   PM "Jess Bowman" as `principal`. (#1 gotcha: `agency_id` MUST be in `app_metadata` or RLS shows zero rows.)
3. **Anthropic drafting** — live 12-fixture suite green; drafter recalibrated (see §5).
4. **Worker** — deployed; **16/16 secrets** set via `wrangler secret put`.
5. **Gmail + Pub/Sub** — live email→draft verified.
6. **Twilio + Resend** — owner **email** alert verified (Resend delivered). SMS wired; Twilio trial
   blocks unverified numbers.
7. **Cloudflare Pages** — dashboard live + login verified.
8. **CI/CD** — `.github/workflows/ci.yml`: push to `main` → `ci` (typecheck/lint/test+Supabase) →
   `deploy` (wrangler deploy + pages deploy). Docs-only pushes skip via `paths-ignore`.

The Gmail **watch is currently STOPPED** — it had been pointed at a personal Gmail, which drafted
all personal mail (API cost). The `agency_email_state` row was deleted. Reconnect a **dedicated**
mailbox for a real pilot (see §4).

---

## 2. How it's wired (where each secret/var lives)

- **Worker runtime secrets (16):** on the Cloudflare Worker via `wrangler secret put`. Persist across
  deploys (CI `wrangler deploy` does NOT touch them). Names in `docs/ENV.md` + `apps/worker/src/lib/env.ts`.
  Local dev mirror: `apps/worker/.dev.vars` (gitignored).
- **Web PUBLIC_\* :** read at build via `$env/static/public` (NOT `$env/dynamic/public` — that returns
  empty on CF Pages). Baked into the bundle. Provided by `apps/web/.env.local` locally and the
  `env:` block in `ci.yml` for builds. Non-secret (anon key + URLs).
- **CI secrets (GitHub repo → Settings → Secrets → Actions):** `CLOUDFLARE_API_TOKEN` (Workers Scripts:Write
  + Pages:Write + KV), `CLOUDFLARE_ACCOUNT_ID`.
- **Gitignored local files (NOT in git):** `apps/web/.env.local`, `packages/db/.env.local`
  (`DATABASE_URL`, Session pooler; DB password has an `@` → percent-encode `%40` in URLs),
  `packages/prompts/.env.local` + `apps/worker/.dev.vars` (`ANTHROPIC_API_KEY`).

---

## 3. Local dev / re-verify

```
pnpm install
pnpm -r typecheck
pnpm exec biome check .
pnpm --filter web dev              # dashboard on localhost:5173 (uses apps/web/.env.local → hosted Supabase)
# Live LLM drafter suite (real API, ~12 calls):
#   $env:ANTHROPIC_API_KEY=<key>; $env:RUN_LLM_TESTS='1'; pnpm --filter ./packages/prompts test
# RLS test vs remote (needs packages/db/.env.local DATABASE_URL):
#   $env:RUN_DB_TESTS='1'; pnpm --filter @pm/db test
```
Deploy is automatic on push to `main`. Manual: `pnpm --filter worker exec wrangler deploy` and
`pnpm --filter web build` then `pnpm --filter worker exec wrangler pages deploy ../web/.svelte-kit/cloudflare --project-name pm-assistant-web`.

---

## 4. Before a REAL pilot (follow-ups — none done, none urgent)

- **Dedicated agency mailbox** (never a personal Gmail). Reconnect: visit
  `https://pm-assistant-worker.ryanmay065.workers.dev/oauth/gmail/start?agency_id=<agency-uuid>`.
- **Publish the Google OAuth consent screen** (it's in Testing → refresh tokens expire after 7 days).
- **Verify a Resend domain** so alerts reach real owners (the `onboarding@resend.dev` test sender only
  delivers to your own Resend account email). Then update the `RESEND_FROM_EMAIL` secret.
- **Real Twilio number + A2P** for SMS (trial blocks unverified numbers).
- **Recreate Supabase in Sydney** for the prod project (this one is Singapore/dev) + a clean (unseeded) DB.
- **Confirm the send route's JWT check** (`SUPABASE_JWT_SECRET`, HS256) verifies the dashboard token when
  you first test Approve & Send — the project may use asymmetric signing keys (then switch to JWKS).

---

## 5. Gotchas already fixed (don't re-trip these)

- **Webhook drafts in `executionCtx.waitUntil`** — drafting synchronously blew the Pub/Sub 10s push ACK
  deadline → request canceled → lost draft. ACK first, draft in background.
- **Self-alert loop guard** — the webhook skips drafting emails from our own `RESEND_FROM_EMAIL` (an owner
  alert landing back in the monitored inbox would otherwise loop).
- **`nodejs_compat`** flag required in `wrangler.toml` (Anthropic SDK imports node builtins). Worker + Pages both.
- **Cron DOW** — Cloudflare rejects `0` for Sunday; use `SUN` (`0 23 * * SUN`).
- **Web PUBLIC_\* via `$env/static/public`** — `$env/dynamic/public` is empty on CF Pages.
- **Drafter coerces `YES`/`NO` → boolean** — the model echoes the prompt's `[YES|NO]` format; was a hard crash.
- **Welfare detector** matches the gerund "hurting myself" (was a real safety gap; floor now forces do_not_send).
- **`account_id` pinned** in `wrangler.toml` (the OAuth login token lacked account-list permission).

---

## 6. Decisions locked (do not relitigate)

- **Stack stays committed** — SvelteKit + Cloudflare Workers/Pages + Supabase + Anthropic. The
  `PM-Manager_Build_Spec.md` is product direction, not a stack mandate. See `[[stack-conflict-spec-vs-committed]]`.
- **Direction:** build ALL phases 1–5 on Supabase first, THEN consider a Postgres migration. Bare Postgres
  is NOT a drop-in (loses Auth/Vault/Realtime/PostgREST); self-hosting the OSS Supabase stack is the
  compatible cheaper route. Revisit at migration time.
- **Never invent a regulatory fact** (spec §0.3) — `@pm/rules` throws rather than guess. See `[[rules-engine-foundation]]`.
- **AI never auto-sends.** Settings editing is admin/principal-only. `do_not_send` hard-enforced on the send route.

---

## 7. Next options

- **Phase 2** (do not start without direction): maintenance jobs, **form generation** (leans on the
  complete `@pm/rules` form metadata — natural next build), tradie/owner/tenant portals, inspections,
  lease lifecycle.
- Or work the **§4 real-pilot follow-ups** when onboarding an actual agency.
