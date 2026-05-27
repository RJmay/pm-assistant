# PM Assistant

Multi-tenant SaaS that drafts QLD-compliant email replies to inbound tenant, landlord, and third-party emails for Queensland residential property management agencies. The AI produces a structured draft for every inbound email; property managers review, edit, and send from a daily queue. The AI never sends.

## Layout

- `apps/web` — SvelteKit dashboard (Cloudflare Workers)
- `apps/worker` — Cloudflare Worker: Gmail ingestion + AI drafting
- `packages/db` — Supabase migrations + generated types
- `packages/prompts` — prompt assembly + Anthropic drafter
- `packages/shared` — shared types, enums, zod schemas
- `docs/` — architecture, build plan, schema, system prompt

## Develop

```sh
pnpm install
pnpm -r typecheck
pnpm lint
pnpm --filter worker dev   # http://localhost:8787/health
pnpm --filter web dev
```

Start here: `CLAUDE.md` for the working agreement and stack, `docs/BUILD_PLAN.md` for milestones.
