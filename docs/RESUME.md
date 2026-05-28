# RESUME — session handoff for PM Assistant

Drop this file at the top of a fresh Claude Code conversation to pick up the build. This is **not** the initial brief (see `docs/HANDOFF.md` for that). It captures where M5 left off and the decisions that aren't obvious from the canonical docs.

## How to start the next session

Tell Claude Code:

> Read `CLAUDE.md`, then `docs/RESUME.md`, then `docs/BUILD_PLAN.md`. Tell me what state we're in and wait for direction.

That bootstraps the canonical instructions + this handoff + the milestone tracker.

## Where the build is right now (2026-05-28)

- **M0–M4: DONE.** Scaffold, local Supabase + RLS, prompt assembly, Anthropic drafter, Pub/Sub webhook stub. All committed.
- **M5 (Gmail integration): code complete, runtime DoD pending Phase B.** All code written and committed; `pnpm -r typecheck` + `pnpm -r test` both green (worker: 8 files / 69 tests). The DoD ("real inbound email lands in `email_messages` within seconds") needs hosted Supabase to verify — see "Phase B" below.
- **M6 onwards: not started.**

## The two pending pieces blocking M5 from `[DONE]`

### Phase B — hosted Supabase project (USER, not Claude)

The user is setting up a hosted Supabase project (region: Sydney for prod). When done:

1. Apply `supabase/migrations/0001_initial.sql`, `0002_agency_gmail_secrets.sql`, `0003_vault_gmail_helpers.sql` to the hosted project.
2. Set Worker secrets to point at the hosted project's URL + service role key.
3. Onboard the pilot agency mailbox via `GET /oauth/gmail/start?agency_id=<uuid>` to populate Vault + `agency_email_state`.

Once that's done, send a real email to the connected mailbox and watch `email_messages` for it. **That's the M5 runtime DoD.**

### Deployment runs on Cloudflare Workers Builds (GitHub-connected)

- Repo: `https://github.com/ryanmay065/pm-assistant` (auto-deploys on push to `main`)
- Deployed worker: `https://pm-assistant.ryanmay065.workers.dev` (404 at `/`, 200 at `/health`)
- CF dashboard "Deploy command" was changed from `npx wrangler deploy` to `pnpm --filter worker exec wrangler deploy` — needed because the repo is a pnpm monorepo. If a future deploy fails with "Wrangler application detection logic has been run in the root of a workspace", check that setting first.

## Key decisions from M5 (don't re-litigate these)

| Decision | Choice | Why |
|---|---|---|
| Refresh token storage | **Supabase Vault**, not a plain encrypted column | CLAUDE.md mandates it ("don't store Gmail tokens in plain columns"). Defense in depth — Vault keys live server-side at Supabase, not in Worker env. |
| Vault access pattern | SECURITY DEFINER RPCs in `public` schema (`store_gmail_refresh_token`, `get_gmail_refresh_token`, `delete_gmail_refresh_token`) | The `vault.*` functions live in the `vault` schema and aren't reachable via PostgREST. Wrappers are service_role-only. See migration `0003`. |
| Watch refresh cadence | **Daily** cron at 13:00 UTC | Gmail watch expires every 7 days; daily gives 6 days of headroom and is dead simple. Alternative was every-6-days; we picked daily for predictability. |
| OAuth state | HMAC-signed JWT, 5-min TTL, payload = `{agencyId}` | Stateless — no `oauth_pending` table. `OAUTH_STATE_SECRET` env var (≥32 chars) is the HMAC key. |
| Cron handler shape | Exported as `{fetch, scheduled}` from `apps/worker/src/index.ts` | Hono `app.fetch` for HTTP, `handleScheduled` for the cron tick. The runtime needs both on the default export. |

## Gotchas / things that bit us in this session

- **Anthropic API key got pasted into the wrong Wrangler secret slot** (one of the Google OAuth ones). Mitigation: re-rotated the key, listed secrets, deleted the misnamed entry. If something looks off with the deployed worker, check `wrangler secret list` for stale or misnamed entries.
- **Placeholder-text-pasted-verbatim hazard.** When asking the user to paste a value, prefer Get-Clipboard / explicit shell commands over instructing them to paste a placeholder string like `<your-thing>`. The user has repeatedly pasted the placeholder text literally.
- **OAuth redirect URI must match EXACTLY** what's registered in the Google Cloud OAuth client (down to trailing slash). The route is registered as both `/oauth/gmail/callback` and `/oauth/gmail/callback/` to be forgiving on our side, but the env-derived URI sent to Google is `${WEBHOOK_BASE_URL}/oauth/gmail/callback/` (with trailing slash). Don't change that without changing both places.
- **The pre-existing `webhook.test.ts` "rejects a tampered signature" assertion was flaky** — flipping one base64url char doesn't always corrupt an ES256 signature because of how base64url encodes trailing bits. Fixed in this session by replacing the whole signature with `"A".repeat(...)`. If a similar pattern shows up elsewhere, use the clobber approach.
- **Biome auto-reformats `packages/db/src/types.ts`** every time supabase regenerates it. Currently fixed via `biome check --write`. If this becomes annoying, consider excluding the file from biome.

## Verified-green commands (run these before declaring anything done)

```sh
# Lint
pnpm exec biome check .

# Typecheck (all 5 projects)
pnpm -r typecheck

# Unit tests (worker, prompts, shared; db tests skip without RUN_DB_TESTS=1)
pnpm -r test
# Last run: worker 8/69, prompts 14/14, shared 1/1, db 0/3 skipped — all green
```

## What to do next (depends on user direction)

1. **If user has finished Phase B (hosted Supabase live):**
   - Help them apply migrations 0001–0003 to the hosted project.
   - Walk through Worker secret update (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` now point at hosted).
   - Drive a manual smoke test of `/oauth/gmail/start` → consent → callback → mailbox connected.
   - Trigger a real inbound email and verify it lands in `email_messages`.
   - Mark M5 `[DONE]`, surface M6 plan.

2. **If user wants to keep moving on code while Phase B finishes:**
   - Start M6 (end-to-end draft generation). Read `docs/BUILD_PLAN.md` M6 entry. The matcher + drafter wiring is the big piece. Same "code now, runtime later" pattern is fine.

3. **If something looks broken in M5 code:**
   - First check `pnpm -r typecheck && pnpm -r test`. If both green, the code is intact.
   - Inspect changes since 2026-05-28 commit (the M5 commit) before assuming the M5 code is at fault.

## What NOT to do

- Don't push to `main` without explicit user approval (the user said "stop before push" at the end of M5).
- Don't amend the M5 commit — create a new commit for any follow-up.
- Don't swap stack pieces (CLAUDE.md "do not deliberate" list).
- Don't paste API keys into chat — if you need to know whether a secret is set, ask via `wrangler secret list`, not "what's the value".
- Don't add documentation files unless asked. (CLAUDE.md / general Claude Code policy. This RESUME.md is the explicit ask.)

## File map of what M5 added (for orientation)

```
supabase/migrations/
  0002_agency_gmail_secrets.sql       # vault_secret_id mapping table
  0003_vault_gmail_helpers.sql        # SECURITY DEFINER RPC wrappers

apps/worker/src/
  cron/refresh-watches.ts             # daily watch refresh + handleScheduled
  routes/oauth-gmail.ts               # /oauth/gmail/start + /callback
  routes/gmail-webhook.ts             # rewritten from M4 stub — full pipeline
  services/gmail.ts                   # fetch-based Gmail API client (zod)
  services/email-parser.ts            # MIME walk, address parsing, base64url
  services/vault.ts                   # 3 RPC wrappers
  lib/env.ts                          # +WEBHOOK_BASE_URL, OAUTH_STATE_SECRET, PUBSUB_TOPIC

apps/worker/test/
  cron.test.ts, email-parser.test.ts, gmail.test.ts,
  oauth-gmail.test.ts, vault.test.ts, webhook.test.ts (rewritten)

apps/worker/wrangler.toml             # +[triggers] crons = ["0 13 * * *"]
docs/ENV.md                           # +WEBHOOK_BASE_URL etc, cron note
docs/BUILD_PLAN.md                    # M5 status updated
```
