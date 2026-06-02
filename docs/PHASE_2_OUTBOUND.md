# Phase 2 — Proactive outbound sequences

Master spec §8. Automate the recurring **outbound** work. Each sequence is detected on a
schedule, drafted into the **same review queue** as inbound replies, and **sent by a human** —
the system never auto-sends (spec §13). Built on **Cloudflare Cron Triggers + Supabase** (not
Inngest — per the committed stack), reusing the existing `ai_drafts` → review → edit → send →
audit → realtime stack.

## How an outbound draft works

An outbound draft is just an `ai_drafts` row with:
- `draft_source = 'sequence'` (vs `'inbound_reply'`),
- `email_message_id = NULL` (no inbound email to reply to),
- its own `recipient_email` / `recipient_name`, and `tenancy_id` / `property_id` where relevant,
- `sequence_run_id` linking it to the durable run that produced it,
- `model_used = 'template:<key>'` (template-generated, not an LLM call).

It appears in `/queue` with an **Outbound** badge and "To:" the recipient. The detail page shows
an outbound-context card instead of an inbound email. **Approve & Send** posts to the worker's
`/api/drafts/:id/send`, which branches: a sequence draft is sent as a **new email** (fresh Gmail
thread, no `In-Reply-To`); the outbound `email_messages` row is filed under a thread row keyed on
the Gmail thread id Gmail returns.

## Sequences

All four scanners run under **one daily cron** `0 22 * * *` (08:00 AEST) — `cron/sequences.ts`
`handleDailySequences` runs them in order, continue-on-error. (One trigger rather than four keeps
the Worker under Cloudflare's cron-trigger cap; each scanner is independent.)

| Sequence | Cadence | Trigger | Draft | Rules used |
|---|---|---|---|---|
| **Lease renewal** | daily | fixed-term tenancy `end_date` within lead window (default 90d) | renewal offer; rent-review window in PM notes (never a rent figure) | `assessRentIncrease` / `earliestRentIncreaseDate` |
| **Inspection** | daily | next routine inspection due (last inspection — or tenancy start — + interval, default 6mo) within lead (14d) | scheduling message with a compliant proposed entry date; Form 9 follows (Phase 4) | `earliestRoutineInspectionDate` (7-day notice + 3-month cap) |
| **Owner update** | monthly (self-gating in the daily sweep) | each owner with active properties | month-end summary of last month's activity | — |
| **Arrears** | daily | `tenancies.arrears_since` set (manual flag) | courtesy reminder; escalation flagged to PM past the policy threshold | — (no statutory threshold asserted) |

All runs are **idempotent** — one `sequence_runs` row per cycle, unique on
`(agency_id, dedupe_key)`. Re-scans are no-ops. Owner-update therefore drafts a given month's
summary only once even though it's evaluated daily. Each scan is per-agency continue-on-error and
respects an explicit disabled `sequences` row (absent row = enabled with code defaults).

## Configuration (`sequences` table, per agency, DB-edited for now)

- A missing row = **enabled** with code defaults. Insert a row with `is_active = false` to
  disable a sequence, or set `config` jsonb to tune it:
  - lease_renewal: `{ "lead_days": 90 }`
  - inspection: `{ "interval_months": 6, "lead_days": 14 }`
  - arrears: `{ "escalate_after_days": 7 }`

## Manual operations (until CRM / UI lands)

- **Arrears:** set `tenancies.arrears_since = '<date>'` when rent falls behind; clear it when
  caught up. A new date opens a fresh reminder episode.
- **Inspection:** set `tenancies.last_routine_inspection_date` after each inspection to roll the
  next cycle forward (null falls back to the tenancy `start_date`).

## Deliberate non-goals (v1)

- **Never invents a regulatory fact.** The arrears Form 11 day-threshold is NOT encoded (it
  isn't in the `@pm/rules` seed) — the reminder is a courtesy and escalation is a PM decision.
  Seed + confirm that threshold to let arrears compute the eligibility date.
- **One draft per cycle** (no multi-step chasers yet); `sequence_runs.next_action_at` + state
  machine are in place to add them.
- **No payment feed** (arrears is manual); CRM adapter is later-phase work.

## Runtime DoD (pending live data — same bring-up as Phase 1)

- A real upcoming expiry / due inspection / flagged arrears / month-end produces a correctly
  timed, compliant draft in the queue.
- An outbound sequence draft sends as a new email from the agency mailbox and is recorded with a
  bounce-linkable `email_messages` row.

## Migrations added

`0012_outbound_sequences.sql` (foundation), `0013_inspection_tracking.sql`
(`last_routine_inspection_date`), `0014_arrears_flag.sql` (`arrears_since`). After applying to a
Supabase, run `pnpm db:types` to regenerate `packages/db/src/types.ts` (hand-edited to match for
now).
