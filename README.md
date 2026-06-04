# PM Assistant

Multi-tenant SaaS for Queensland residential property-management agencies. It drafts QLD-compliant
replies to inbound tenant/landlord/third-party email, runs proactive outbound sequences, coordinates
maintenance, generates statutory documents, and triages inbound SMS — all **human-in-the-loop**:
the AI drafts and queues, a property manager reviews and sends. **The system never sends on its own.**

**Status (June 2026): all five spec phases are built, deployed, and migrated.** See
**`docs/HANDOFF.md`** for the live state and what's left to finish.

## Layout

- `apps/web` — SvelteKit dashboard (Cloudflare Pages): review queue, alerts, maintenance, documents, SMS, audit, settings
- `apps/worker` — Cloudflare Worker: Gmail ingestion + AI drafting, outbound-sequence crons, maintenance/documents/SMS routes
- `packages/db` — Supabase migrations (0001–0019) + generated types + typed clients
- `packages/prompts` — prompt assembly + Anthropic drafter + the deterministic template engine (outbound/maintenance)
- `packages/rules` — deterministic QLD compliance rules engine (notice periods, dates, forms, s214, escalation)
- `packages/documents` — statutory document engine (rules-backed Form 9/11/12 + rent-increase notice)
- `packages/shared` — shared types, enums, zod schemas
- `docs/` — architecture, build plan, per-phase handoffs, schema, runbook

## What's built (by spec phase)

- **Phase 1** — inbound drafting + PM review queue (LIVE)
- **Phase 2** — proactive outbound sequences (lease-renewal, inspection, owner updates, arrears) — `docs/PHASE_2_OUTBOUND.md`
- **Phase 3** — maintenance coordination (triage → quotes → owner approval → scheduling → close-out) — `docs/PHASE_3_MAINTENANCE.md`
- **Phase 4** — statutory document engine (Form 9, rent-increase, Form 11, Form 12) — `docs/PHASE_4_DOCUMENTS.md`
- **Phase 5** — SMS front door (inbound → classify → draft → PM sends) — `docs/PHASE_5_SMS.md`

## Develop

```sh
pnpm install
pnpm -r typecheck
pnpm exec biome check .        # lint/format
pnpm -r test                   # unit/integration
pnpm --filter worker dev       # http://localhost:8787/health
pnpm --filter web dev
```

## Deploy / operate

Pushing `main` runs CI (typecheck + lint + test) then deploys (`wrangler deploy` + `pages deploy`).
DB migrations are applied with `supabase db push` (the hosted project is linked). See
**`docs/RUNBOOK.md`** for the full deploy + activation steps.

Start here: `CLAUDE.md` (working agreement + stack), then `docs/HANDOFF.md` (current state + next steps).
