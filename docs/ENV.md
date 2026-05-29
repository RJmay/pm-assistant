# ENV.md

All environment variables, where they live, and what they unlock. Keep this file current — if you add a new variable, document it here in the same PR.

## Worker (`apps/worker`)

Set via `wrangler secret put <NAME>` in production, `.dev.vars` in local dev (gitignored).

| Variable | Source | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic console | Calls Claude API for drafting |
| `SUPABASE_URL` | Supabase project settings | Postgres + Auth endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings | Bypass RLS for Worker writes (and call the Vault helper RPCs) |
| `GOOGLE_PUBSUB_AUDIENCE` | Google Cloud project | Verify Pub/Sub push JWTs (the configured push endpoint URL) |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT` | Google Cloud project | Expected `email` claim in the Pub/Sub JWT |
| `GMAIL_OAUTH_CLIENT_ID` | Google Cloud OAuth credentials | Per-agency OAuth — exchange code + refresh access tokens |
| `GMAIL_OAUTH_CLIENT_SECRET` | Google Cloud OAuth credentials | Same |
| `WEBHOOK_BASE_URL` | Manual | Base URL of the deployed Worker (no trailing slash). Used to build the OAuth redirect URI `${base}/oauth/gmail/callback/`. |
| `OAUTH_STATE_SECRET` | Generated, ≥32 chars | HMAC key for the OAuth `state` JWT (signs `agency_id`, 5-min TTL). |
| `SUPABASE_JWT_SECRET` | Supabase project settings (JWT secret) | Verify the dashboard user's access token (HS256) on the send route, so the Worker can trust the caller's `sub` + `app_metadata.agency_id`. |
| `PUBSUB_TOPIC` | Google Cloud Pub/Sub | Full topic path `projects/<gcp-project>/topics/pm-assistant-gmail`. Passed to Gmail's `users.watch` so notifications publish to this topic. |
| `TWILIO_ACCOUNT_SID` | Twilio console | Send SMS for owner alerts |
| `TWILIO_AUTH_TOKEN` | Twilio console | Same |
| `TWILIO_FROM_NUMBER` | Twilio console | The sending number |
| `RESEND_API_KEY` | Resend dashboard | Send notification emails |
| `RESEND_FROM_DOMAIN` | Resend dashboard | Verified sender domain |
| `LOG_LEVEL` | Manual | `debug` \| `info` \| `warn` \| `error` (default `info`) |
| `ENVIRONMENT` | Manual | `development` \| `staging` \| `production` |

Note: there is **no** Worker env var for Vault decryption. Supabase Vault manages its own at-rest key server-side; the Worker just calls the SECURITY DEFINER RPC wrappers (`store_gmail_refresh_token`, `get_gmail_refresh_token`, `delete_gmail_refresh_token`) using `SUPABASE_SERVICE_ROLE_KEY`.

In addition to the env vars above, the Worker declares bindings + a cron in `wrangler.toml`:

| Binding / trigger | Purpose |
|---|---|
| `JWKS_CACHE` (KV namespace) | Caches Google's OIDC public keys (JWKS) for Pub/Sub JWT verification. Local dev: wrangler's Miniflare simulates KV with a placeholder id. Before deploy: `wrangler kv namespace create JWKS_CACHE` + `wrangler kv namespace create JWKS_CACHE --preview`, paste both ids into `wrangler.toml`. |
| Cron `0 13 * * *` | 13:00 UTC daily (= 23:00 AEST / 00:00 AEDT). Calls `handleScheduled`, which iterates `agency_email_state` rows where `watch_expires_at` is null or within 48h, refreshes each mailbox's Gmail `users.watch` (subscription expires every 7 days), and writes back the new `watch_expires_at`. |

For production, set every Worker secret via `wrangler secret put <NAME>` rather than committing values. The KV namespace ids in `wrangler.toml` are not secrets and can be committed.

## Web (`apps/web`)

Set in Cloudflare Pages/Workers dashboard for production. `.env.local` for dev.

| Variable | Source | Purpose |
|---|---|---|
| `PUBLIC_SUPABASE_URL` | Supabase project | Client-side Supabase URL |
| `PUBLIC_SUPABASE_ANON_KEY` | Supabase project | Client-side anon key (safe to expose) |
| `PUBLIC_WORKER_URL` | Manual | Base URL of the Worker (e.g., `https://worker.pmassist.app`) |
| `PUBLIC_ENVIRONMENT` | Manual | Drives dev banners and feature flags |

## Supabase

Set via Supabase dashboard or `supabase secrets set` for Edge Functions (not used in v1 but reserved).

| Variable | Purpose |
|---|---|
| `SITE_URL` | Auth redirect base |
| `JWT_SECRET` | Auto |
| `SMTP_*` | Optional — only if not using Resend for auth emails |

Also set in Supabase Auth → Providers:
- Google OAuth (for PM dashboard sign-in via Google)
- Email/password (enabled by default)

## Local Supabase (development)

When you run `pnpm db:start`, the local stack binds to these well-known endpoints (see `pnpm exec supabase status` for live values):

| Item | Value |
|---|---|
| API gateway | `http://127.0.0.1:54321` |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | `http://127.0.0.1:54323` |
| Mailpit | `http://127.0.0.1:54324` |
| Publishable key (PUBLIC_SUPABASE_ANON_KEY) | `sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH` |
| Secret key (SUPABASE_SERVICE_ROLE_KEY) | `sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz` |

These are deterministic local-dev defaults — safe to share. Never use them in any deployed environment.

The Supabase CLI runs as a project-local dev dependency. Common commands:

```sh
pnpm db:start    # boot Postgres + API + Studio (first run pulls ~1 GB images)
pnpm db:stop     # stop and delete data volumes (--no-backup)
pnpm db:reset    # drop + re-apply migrations + seed.sql
pnpm db:types    # regenerate packages/db/src/types.ts from the live schema
```

Database tests (RLS smoke) are env-gated: set `RUN_DB_TESTS=1` to run them (`pnpm -r test` skips them by default; CI sets it and boots Supabase first).

LLM drafter tests (`packages/prompts/test/drafter.live.test.ts`, 12 inbound-email fixtures against the Anthropic API) are env-gated by `RUN_LLM_TESTS=1` and require `ANTHROPIC_API_KEY` in the shell. They don't run on push CI (cost + model-side flakiness) — the `weekly-llm.yml` workflow runs them on Mondays 14:00 UTC, and `workflow_dispatch` lets you trigger them on-demand from the GitHub Actions tab.

## GitHub Actions

Repository secrets needed for CI/CD:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploy Worker and Pages via Wrangler |
| `CLOUDFLARE_ACCOUNT_ID` | Same |
| `ANTHROPIC_API_KEY` | Run `RUN_LLM_TESTS=1` weekly job |
| `SUPABASE_ACCESS_TOKEN` | Apply migrations to staging/prod |
| `SUPABASE_PROJECT_REF_STAGING` | Identify staging project |
| `SUPABASE_PROJECT_REF_PROD` | Identify prod project |

## Per-agency runtime data (stored in DB / Vault, not env)

These are not env vars but are required for an agency to function. Surfaced here so onboarding doesn't forget them.

| Item | Stored where | Set by |
|---|---|---|
| Gmail refresh token | Supabase Vault, keyed by `agency_id` | OAuth flow during onboarding |
| Pub/Sub topic + subscription | `agency_email_state.pubsub_subscription` | Onboarding script |
| Gmail watch expiry | `agency_email_state.watch_expires_at` | Worker, refreshed daily |
| Mailbox address being monitored | `agency_email_state.mailbox_address` | Onboarding flow |
| Voice samples | `agency_config.voice_samples` | Dashboard settings page |
| Approved tradies | `agency_config.approved_tradies` | Dashboard settings page |
| Nominated repairer (Form 18a) | `agency_config.nominated_repairer` | Dashboard settings page |
| Spending authority thresholds | `agency_config.routine_approval_threshold_cents` etc. | Dashboard settings page |
| Owner notification preferences | `owner_notification_preferences` | Dashboard owner page |

## Setup checklist for a new environment

In order:

1. Create Supabase project (region: Sydney for prod, any for dev)
2. Apply migrations: `supabase db push`
3. Enable required auth providers
4. Set up Supabase Vault for Gmail tokens
5. Create Cloudflare Worker, deploy with placeholder env
6. Set Wrangler secrets per the table above
7. Set up Cloudflare Pages for the web app
8. Set Pages env vars per the table above
9. Create Google Cloud project for Gmail + Pub/Sub
10. Enable Gmail API and Pub/Sub API
11. Create OAuth credentials (web application) for Gmail user-consent flow
12. Create service account for Pub/Sub → Worker push authentication
13. Create Pub/Sub topic `pm-assistant-gmail`
14. Create Twilio account, buy a sending number
15. Create Resend account, verify sending domain
16. Wire up GitHub Actions secrets
17. Smoke test: send a test email to a configured agency mailbox, verify draft appears
