# Phase 3 — Maintenance coordination

Master spec §9. Automate the highest-effort-per-instance PM workflow. A maintenance request
becomes a tracked **job**; the agent runs the coordination and drafts every message, the PM makes
the judgement calls and approvals. Nothing auto-sends (spec §13). Reuses the outbound-draft
mechanism from Phase 2 (`ai_drafts` with `draft_source='maintenance'`, linked via
`maintenance_job_id`).

## Milestone 1 (done): job foundation + tradie quote requests

**Flow.** PM opens a `MAINTENANCE` draft in the queue → clicks **Create maintenance job** (optionally
naming a trade) → the worker:
1. creates a `maintenance_jobs` row, **triaged** EMERGENCY vs routine via `@pm/rules`
   `triageEmergencyRepair` (RTRA s214 list);
2. if a trade was named, drafts a **tradie quote request** to each approved tradie of that trade
   (from `agency_config.approved_tradies`) as an outbound draft in the review queue;
3. records each request in `maintenance_jobs.quotes` and moves the job to `quoting`.

The PM reviews/edits/sends the quote requests from the queue (same stack as everything else).

**Entry point.** `POST /api/maintenance/jobs` (JWT-authed) — body `{ sourceDraftId, trade?, issue? }`.
Idempotent per source draft (a second click returns the existing job). The dashboard's
"Create maintenance job" button calls it; `/maintenance` lists jobs, `/maintenance/[id]` shows a
job's quotes + drafts.

## Data model

`maintenance_jobs`: `classification` (emergency|routine|other), `state`
(new→quoting→awaiting_owner_approval→approved→scheduling→scheduled→completed|cancelled),
`quotes` jsonb (`[{id, tradie_name, trade, status, amount_cents?, requested_at, draft_id?}]`),
`owner_approval_state`, `approved_spend_cents`, `scheduled_for`, `source_draft_id` (unique),
`trade`. `ai_drafts.maintenance_job_id` links a job's outbound messages back.

## Hard rules honoured

- Never commits the owner to spend (owner-approval template asks, never authorises).
- Never promises a tradie a specific attendance time.
- Triage classification is deterministic rules-engine output, never the LLM's call; a keyword hit
  is a recall-oriented flag, the PM decides.

## Milestone 2 (done): owner-approval flow + quote chasers

**Owner approval.** From a job's detail page the PM:
1. **records a returned quote** (enters the tradie's amount) → `POST .../quotes/:quoteId`;
2. **requests owner approval** → `POST .../owner-approval` — drafts an owner-approval request to
   the owner (outbound, in the queue) using the lowest recorded quote as the estimate, resolving
   the **spending-authority threshold** (per-owner exception in `agency_config.per_owner_quote_exceptions`,
   else `routine_approval_threshold_cents`); job → `awaiting_owner_approval`, owner approval `pending`;
3. **records the owner's decision** → `POST .../decision` (approved → `approved` + `approved_spend_cents`;
   declined → `declined`).

The owner-approval template asks for approval and never authorises spend.

**Quote chasers.** A `quote_chaser` scan in the daily sequence sweep (`cron/maintenance-chasers.ts`)
finds jobs in `quoting` with quotes that have been `requested` for more than 3 days and not yet
chased, and drafts a follow-up to the tradie. Idempotent via `quotes[].chased_at` (never chases the
same quote twice).

## Deferred (later Phase 3 milestones)

- **M3.3** — scheduling messages + close-out + the remaining state-machine transitions
  (`approved` → `scheduling`/`scheduled` → `completed`).
- Tradie email capture: quote requests use a contact containing "@" in `approved_tradies`;
  tradies with only a phone number are skipped (counted in `skippedNoEmail`). Add an explicit
  `email` field via the settings UI. A tradie portal (accept/complete/invoice) is later-phase.

## Runtime DoD (pending live data — same bring-up as Phase 1)

- A PM turns a real maintenance email into a correctly-triaged job, and tradie quote requests
  land in the queue and send from the agency mailbox.

## Migrations added

`0015_maintenance_draft_source.sql` (`draft_source += 'maintenance'`, its own migration so PG can
commit the enum value before it's used) and `0016_maintenance_jobs.sql`. After applying, run
`pnpm db:types` to regenerate `packages/db/src/types.ts` (hand-edited to match for now).
