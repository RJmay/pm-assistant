# PM Assistant — Handoff Package

This folder is the starting point for building **PM Assistant**: a multi-tenant SaaS that drafts email replies to inbound tenant/landlord emails for Queensland residential property management agencies. Phase 1 builds the email drafting layer for one pilot agency on the Sunshine Coast, designed multi-tenant from day one. Phase 2+ extends into a full PMS companion.

## Drop this into a fresh Claude Code session

1. Create a new git repository for the project (e.g., `gh repo create pm-assistant --private`)
2. Copy everything in this folder into the repo root
3. Open the repo in your editor / start Claude Code from the repo root
4. Tell Claude Code: **"Read CLAUDE.md and start Milestone 0 from docs/BUILD_PLAN.md."**

That's it. Claude Code will read `CLAUDE.md`, follow the references, and start scaffolding.

## What's in here

```
CLAUDE.md                     Primary instructions for Claude Code. Read first.
README.md                     This file.
docs/
├── ARCHITECTURE.md           Stack, data flow, security model, key patterns
├── BUILD_PLAN.md             10 ordered milestones with definitions of done
├── ENV.md                    Every env var and where it lives
├── schema.sql                Postgres schema with RLS — drop-in for Supabase
└── system-prompt.md          The AI drafting prompt (v2.1) — agency-agnostic
```

## What you (the human) need to set up before Milestone 5

Claude Code can do milestones 0–4 without external accounts. Before Milestone 5 (Gmail integration), have these ready:

- **Cloudflare account** with Workers + Pages enabled
- **Supabase project** in Sydney region (create when starting Milestone 1)
- **Anthropic API key** (you have one)
- **Google Cloud project** with Gmail API and Pub/Sub enabled (Milestone 5)
- **OAuth consent screen** configured for Gmail (Milestone 5)
- **Twilio account** with one sending number (Milestone 7)
- **Resend account** with verified domain (Milestone 7)
- **Pilot agency's Gmail credentials and consent** to connect their mailbox (Milestone 10)

See `docs/ENV.md` for the full list and a setup-order checklist.

## How to extend later

- New milestones go in `docs/BUILD_PLAN.md` under "Future milestones"
- Prompt changes: insert a new row in `prompt_versions`, set `active_to` on the old. Never edit `docs/system-prompt.md` in place — version it.
- Schema changes: append a new migration in `supabase/migrations/`. Update `docs/schema.sql` to reflect the cumulative state.
- New agency onboarding: a runbook gets added in Milestone 10. Until then, onboarding is manual.

## Decisions baked in

These are committed. Don't reopen without a reason.

- TypeScript + pnpm workspaces monorepo
- SvelteKit on Cloudflare Workers (Static Assets) for the dashboard
- Cloudflare Workers for the backend, Wrangler-managed
- Supabase Postgres + Auth + Realtime + Vault
- Anthropic API with tool use + JSON schema (no free-text parsing)
- Trust accounting is out of scope for v1 (regulated, separate problem)
- Gmail-only for v1 (Outlook support is a Phase 2 question)

## The big picture

The drafting layer is the wedge. The play is building a modern, AI-native PMS companion that sits alongside existing trust accounting systems (PropertyMe, Console Cloud, PropertyTree). Email drafting → maintenance jobs → tradie portal → owner/tenant portals → form generation → inspections. Trust accounting comes much later, after compliance design and probably after 20+ agencies on the platform.

QLD residential tenancy law changed substantially across 2024–2025. The system prompt (`docs/system-prompt.md`) reflects the current state as of v2.1. When the RTA publishes further changes, version the prompt — don't edit it.

## Open questions for the human to resolve

These don't block Milestone 0 but should be answered by Milestone 8–10:

1. Branding for the pilot agency in the dashboard — colours, logo, agency name in nav?
2. Which PM gets the test pilot? One or two seats for v1.
3. Backfill policy — do we process 30 days of historical email on connect, or start fresh?
4. Owner-facing communication — should owners get any direct contact from the system in v1 beyond emergency alerts (e.g., monthly digest)?
5. Onboarding pricing model — per seat, per property under management, flat agency fee?
