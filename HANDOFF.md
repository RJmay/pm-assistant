# Handover — 2026-05-29 (autonomous session)

Written for the next session / your return. Read this top to bottom; it records
**a decision you need to make** plus exactly what was built while you were out.

---

## 0. Latest state (2026-05-30, autonomous) — read this first

Since the original handover, a lot has shipped and is **green** (biome clean,
`pnpm -r typecheck` 0 errors; tests: worker **219**, web 43, rules 62, prompts
18, shared 1; db 3 skipped). Delivered + committed:

- **M9 Send path** — Gmail-API send, dashboard JWT auth, bounce handling. *(pushed)*
- **`@pm/rules`** — deterministic QLD compliance engine; **RTA values seeded**
  (7-day routine-entry notice, once-/-3-months frequency, Form 18a/18b); only
  Form R18 still flagged (rooming-accommodation, out of v1 scope). *(pushed)*
- **M10 dashboard slice** — `/audit`, prompt-version management, PM guide; plus a
  settings RBAC fix (admin/principal-only edits). *(pushed)*
- **Compliance floor** — `@pm/rules` wired into the draft pipeline: deterministic
  escalation safety-net (raises, never downgrades; forces `do_not_send` on
  welfare) + s214 emergency triage (priority bump, no auto owner-alert). *(pushed)*
- **`do_not_send` is now hard-enforced on the send route** (was bypassable);
  editing a draft clears the flag. *(pushed)*
- **Regulatory monitoring bot (§12)** — `regulatory_alerts` table (0011),
  hash-and-diff source scan → on change, Sonnet summarises + proposes rule diffs
  → writes an alert; daily cron; never auto-updates live rules. **2 commits not
  yet pushed** (`fdc6695`, `7c0f0b4`).
- **9-email regression pack (§14)** — deterministic assertions that emergency is
  prioritised and DV is escalated + never auto-sent. *(not yet pushed)*

**Push state:** `main` is **2 commits ahead of origin** (the monitoring scan +
9-email pack). Say "push" to publish them.

**Decisions / things waiting on you:**
1. **Phase B setup** (only you can) — hosted Supabase + `SUPABASE_JWT_SECRET` +
   Gmail/Twilio/Resend creds + the `MONITORING_CACHE` KV ids. Unblocks every
   runtime DoD (M5–M10 + the monitoring bot's alert writes/operator emails).
2. **RTA Form R18** — left flagged; confirm/remove when rooming accommodation is
   in scope.
3. **Settings is now admin/principal-only to edit** (from a security review). Say
   so if you want regular PMs to edit settings and I'll loosen it.
4. **Operator-review dashboard for `regulatory_alerts`** — NOT built yet. The
   read view is easy, but the approve/dismiss WRITE needs a security-model call:
   `regulatory_alerts` is a global (no-agency) table, so a dashboard write needs
   either a loosened RLS update policy (app-gated admin) or routing through the
   Worker (service-role). Your call — I deferred it rather than decide unilaterally.

---

## 1. ⚠️ Decision: spec vs. committed stack — ✅ RESOLVED 2026-05-29

> **Decision:** keep the **current committed stack** (SvelteKit + Cloudflare
> Workers + Supabase + Anthropic). **Cloudflare, not Vercel.** **Inngest
> deferred** — not introduced unless a Phase 2 sequence shows a critical drawback
> in CF cron/queues (raise first). The spec is treated as product *direction*;
> M0–M8 are kept and **M9 (Gmail-API send) is unblocked**. The rest of this
> section is the original analysis, kept for the record.



You saved `PM-Manager_Build_Spec.md` and said "this will direct." It's an
excellent, comprehensive product vision — but it **conflicts with the stack and
the code you've already built**, and CLAUDE.md forbids me from silently changing
the stack or discarding work. So I did **not** act on the conflicting parts. You
need to choose.

| Topic | The spec says | What exists today (CLAUDE.md + M0–M8) |
|---|---|---|
| Frontend | **Next.js** (App Router) | **SvelteKit** ("committed, do not deliberate") |
| Background jobs | **Inngest** | **Cloudflare Workers + Pub/Sub + cron** (CLAUDE.md: don't add Inngest without raising it) |
| Hosting | **Vercel** | **Cloudflare** |
| Starting point | "no code exists yet… clean build" | **8 milestones built**, 261 tests passing |
| Email sending | "PM sends from their own client… copy / open in mail client" (system never sends programmatically) | **M9 plan = send via Gmail API** |
| DB / Auth | Supabase + RLS | ✅ **Same** — Supabase + RLS (no conflict) |
| AI provider | Anthropic, model routing Haiku→Sonnet→Opus, provider abstraction | ✅ Anthropic + structured output (no abstraction layer yet; single model `claude-sonnet-4-6`) |

**Three ways forward (my read):**

1. **Treat the spec as product *direction*, keep the committed stack.** Map the
   spec's phases onto SvelteKit + CF Workers + Supabase. Lowest waste — keeps
   M0–M8. The stack table in the spec was likely written without knowledge of
   the existing repo. **(My recommendation, pending your call.)**
2. **Adopt the spec literally** — new Next.js/Inngest/Vercel build, port the AI
   layer + this new rules engine, retire the SvelteKit dashboard. Biggest
   rebuild; throws away M8.
3. **Hybrid** — keep the proven CF Worker ingestion/draft pipeline, but build
   new surfaces per the spec. Needs a careful seam design.

Until you decide, I **paused M9** (its Gmail-API send path contradicts the
spec's "PM sends manually" model) and did **not** start any Next.js/Inngest work.

I picked work that is **valuable under all three options** (see below).

---

## 2. ✅ What I built this session: `packages/rules` (the QLD rules engine)

The spec calls the rules engine **"foundational — build early in Phase 1"**
(§6, §14). It's pure deterministic TypeScript + versioned data + tests, so it
**survives any stack decision** and the existing code never had it. It needs no
accounts, credentials, or external services.

**Hard rule honoured (spec §0.3 "never invent a regulatory fact"):** every
seeded value traces to a line in the spec. Where the spec named a change but
*withheld the number*, the rule is seeded with `value: null` +
`needsHumanConfirmation: true` and the engine **throws rather than guess**.

### Package layout
```
packages/rules/
├── src/
│   ├── schema.ts      # zod schemas + types (RegulatoryRule, per-key value shapes)
│   ├── seed.ts        # QLD_RULES — the canonical seed (facts from spec §6)
│   ├── dates.ts       # UTC calendar math: addMonths (day-clamping), addDays, compareIso
│   ├── engine.ts      # getRule / findRule / getConfiguredRule / getActiveRules (by effective date)
│   ├── rent.ts        # assessRentIncrease (12-month + 2-month rules), earliestRentIncreaseDate
│   ├── forms.ts       # selectForm(action) -> RTA form, getFormById, listForms
│   ├── emergency.ts   # RTRA s214 emergency-repair triage (statutory list + heuristic matcher)
│   ├── escalation.ts  # spec §13 deterministic escalation safety-net (WELFARE/LEGAL/REPUTATIONAL)
│   └── index.ts       # barrel exports
└── test/              # 7 specs, 59 tests (incl. an anti-invention guard)
```

### What's seeded (all from spec §6)
- **Rent increase frequency** — once / 12 months; **property-based since 2024-06-06**, tenancy-based before (two versions, boundary-tested).
- **Rent increase notice** — minimum **2 months**.
- **Rent bidding ban** — all forms, since **2024-06-06**.
- **Minimum housing standards** — in force, phased to **2024-09-01**.
- **Emergency repairs (RTRA s214)** — the full 9-item statutory list.
- **RTA forms** — 18a, 9, 11, 12, 13, R12 (with purposes); 18b, R18 flagged (spec gave no purpose).
- **House-rules transition** — Schedule 5 continues to **2026-08-31**; new requirements from **2026-09-01** (forward-dated; flagged to surface ahead of time).
- **Governing framework** — RTRA Act 2008 + 2025 Regulation (commenced **2025-09-01**), RTA, QCAT.

### 🔴 Flagged — needs YOU to confirm from the RTA (spec withheld these)
The engine refuses to use these until you fill them in:
1. **Routine-entry notice period** (`entry_notice_routine`) — updated 1 May 2025; number not in spec.
2. **Routine-entry frequency cap** (`entry_frequency_cap`) — updated 1 May 2025; number not in spec.
3. **Form 18b / R18 purposes** — updated under the 2025 Regulation; purposes not in spec.

When you have these, add them to `packages/rules/src/seed.ts` (set the `value`
and `needsHumanConfirmation: false`). The `seed.test.ts` anti-invention guard
also lists the only dates the spec asserts — add any new asserted date there.

### Verification
- `pnpm --filter @pm/rules typecheck` ✅
- `pnpm --filter @pm/rules test` ✅ **61 tests**
- `pnpm exec biome check .` ✅ (whole repo)
- Whole monorepo still green: **rules 61, worker 154, web 29, prompts 18, shared 1; db 3 skipped.**

### Adversarial verification (3 independent skeptic agents)
- **Fact fidelity: CLEAN** — no invented regulatory facts, no spec omissions, no
  misflagged items. The 3 withheld values are correctly flagged.
- **Date math / logic: CLEAN** — zero bugs across 25+ hand-traced boundary cases
  (month clamping, leap years, negative offsets, inclusive `isInForce`
  boundaries, the 2024-06-06 property/tenancy switch, exactly-12-months /
  exactly-2-months rent edges, `max(interval, notice)`).
- **Coverage: minor, non-blocking.** Two notes carried forward:
  1. *(convenience, Phase 2/4)* only `assessRentIncrease` exists; non-rent lease
     actions (arrears, notice-to-leave, inspections) will want a generic
     notice-date helper later. Not built now — it's also blocked on the entry
     values below and gated on the §1 decision.
  2. *(addressed)* keyword false-positive/negative coverage — added near-miss
     guard tests for the emergency + escalation detectors.

### DB migration
`supabase/migrations/0008_regulatory_rules.sql` creates the `regulatory_rules`
table (spec §4) + RLS (global reference data: authenticated read, service-role
write). `docs/schema.sql` reconciled. **The TS seed in `seed.ts` is the single
source of truth**; DB seeding from it is a follow-up to wire when Supabase is up
(kept as one source to avoid drift).

---

## 3. State of the milestones

- **M0–M7** — done (code complete; M5–M7 runtime DoD pending Phase B).
- **M8 Dashboard** — `[DONE]`. Verified at handover: svelte-check 0/0, biome
  clean, tests green. Two low nits noted in
  `apps/web/src/routes/queue/[draftId]/+page.server.ts` (missing `TODO(types)`
  comment on an `as unknown[]` cast; `discard` allows a null actor_id) — not yet
  fixed.
- **M9 Send path** — `[CURRENT]` in BUILD_PLAN, **but paused** pending the §1
  decision (the spec's manual-send model contradicts the Gmail-API plan). My
  drafted M9 plan + the 3 answered design questions (agency-mailbox send first;
  assigned-PM-only; bounce handling in scope) are in the chat history if you go
  the "keep committed stack" route.

---

## 4. What I did NOT do (and why)
- **No commit.** CLAUDE.md says commit only when asked. The new files are in the
  working tree, ready for you to review and commit. Suggested message:
  `feat(rules): deterministic QLD compliance rules engine (spec §6) + 0008 migration`
- **No stack change, no Next.js, no Inngest, no M9 code** — all gated on §1.
- **No invented regulatory facts** — the three RTA values above are flagged, not
  guessed.

## 5. Suggested next steps for when you're back
1. Make the **§1 stack decision**.
2. Hand me the **3 flagged RTA values** (entry notice period, entry frequency
   cap, Form 18b/R18 purposes) so the engine is complete.
3. Then either resume **M9** (committed stack) or scope the **spec migration**.
4. Phase B setup (hosted Supabase + Gmail/Twilio/Resend creds) still unblocks
   the M5–M8 runtime DoDs regardless of the §1 choice.
