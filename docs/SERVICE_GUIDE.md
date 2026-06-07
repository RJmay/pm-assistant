# PM Assistant — Service Guide

*A complete reference: what it is, how it helps property managers, what it saves them,
how it works, how to price it, and how to run it (dashboard, Google Cloud, onboarding).*
*Last updated: June 2026.*

---

# Part 1 — The pitch (for property managers)

## What it is
PM Assistant is an AI assistant that **reads every inbound email to a property
management agency, understands it, and writes a ready-to-send reply** that complies
with Queensland residential tenancy law. The property manager reviews a daily queue,
edits if needed, and sends with one click. **The AI never sends anything itself** —
a human approves every message.

It is **not** a chatbot and **not** a new system to migrate to. It sits quietly on top
of the agency's existing mailbox and trust-accounting setup and removes the single
biggest time sink in property management: the inbox.

## The problem it solves
A property manager fields 30–80+ emails a day — tenants reporting maintenance, owners
asking questions, tradies, agents, routine admin. Each one needs reading, triaging
("is this urgent? does the owner need to know?"), and a careful, compliant reply.
It's relentless, it bleeds into after-hours, and a wrong answer on notice periods or
entry rules is a real compliance risk.

## How it helps — directly
- **Clears the inbox for them.** Every email arrives in the daily queue already
  categorised (Maintenance / Rent / Lease / Complaint / Admin), triaged by urgency,
  and with a drafted reply. The PM reviews instead of writing from scratch.
- **Catches the emergencies.** It flags statutory **emergency repairs** (RTRA s214 —
  e.g. no hot water, burst pipe, no power) and raises an **owner alert**, so urgent
  issues don't sit unread.
- **Keeps them compliant.** Notice periods, entry rules, and rent-increase timing come
  from a deterministic QLD rules engine — not guesswork. It also generates the
  statutory documents (entry notice, rent increase, Forms 11/12/13) as print-ready
  PDFs.
- **Sounds like them.** Drafts match the agency's tone (from sample replies) and house
  rules, and sign off in the PM's name.
- **Reduces risk, keeps control.** Nothing is ever auto-sent. Every draft is reviewed
  by the PM, and every generated document carries a "not legal advice — check every
  detail" note.

## What it (realistically) saves
*Illustrative — validate with each agency's real volume.* If a PM handles ~40 inbound
emails a day and the assistant turns "read + think + write" into "read + tweak + send,"
saving ~2–4 minutes each, that's roughly **1.5–2.5 hours per PM per day** — time back
for inspections, leasing, and owners. The compounding win is fewer missed urgent items
and fewer compliance slips.

## What's included (capability tiers — suggested packaging)
- **Tier 1 — Inbox (the core):** AI-drafted replies + daily review queue (sortable /
  filterable) + QLD compliance floor + emergency owner alerts.
- **Tier 2 — Proactive:** Tier 1 **+** outbound sequences (arrears reminders, lease
  renewals, inspection scheduling, owner updates) **+** one-click statutory documents
  (entry notice, rent increase, Forms 11/12/13) as PDFs.
- **Tier 3 — Coordinator:** Tier 2 **+** maintenance coordination (triage → tradie quote
  requests → spending-gated owner approval → scheduling) **+** regulatory-change
  monitoring **+** (later) an SMS front door for tenant status texts.

---

# Part 2 — How it works (under the hood)

1. **Email arrives** at the agency mailbox → Google pushes a notification → the
   PM Assistant worker ingests it.
2. **Classify + triage:** an Anthropic (Claude) model, constrained to a strict
   structured format, returns category, priority, whether the owner needs an emergency
   alert, any escalation flag (welfare/legal/etc.), and a drafted reply.
3. **Compliance floor:** all dates, notice periods, and form numbers come from the
   deterministic `@pm/rules` engine (QLD RTRA Act 2008 + 2024/25 reforms) — never the
   model. If a rule isn't confirmed, the system refuses rather than guess.
4. **Review queue:** the draft lands on the dashboard. The PM sorts/filters, opens it,
   edits, and **Approves & Sends** — the reply goes out from the agency mailbox.
5. **Everything is logged** (audit trail + the model call) and **nothing is auto-sent.**

Multi-tenant + isolated: each agency's data is walled off (row-level security), so you
can serve many agencies safely from one system.

---

# Part 3 — Pricing & economics (your business)

**Model: per door, per month** (PMs think in "doors" / managed properties). This is
recurring and mostly passive — your effort is sales + onboarding, not per-email work.

- **Illustrative pricing:** ~$2–4 / door / month. A 300-door agency = ~$600–1,200/mo
  recurring, per agency. *(Validate against what local agencies pay for staff/tools.)*
- **Your costs are low + mostly usage-based:**
  - Cloudflare (Workers + Pages): free tier → ~$5/mo at scale.
  - Supabase (Postgres + Auth + Vault): free tier for dev; ~**$25/mo (Pro)** per
    production project (backups, no auto-pause).
  - Anthropic API: **cents per drafted email** — scales with volume, not your time.
- **Margin** is high and improves with scale; many independent agencies stack
  additively (no market cannibalisation — you're a tool on each agency's own book).

---

# Part 4 — How to use it

## A. The dashboard (what PMs use day-to-day)
URL: `https://pm-assistant-web.pages.dev` (sign in with the PM's account).
- **Queue** — the daily review list. Sort by **Highest urgency / Most recent / Oldest**;
  filter by category, escalation, or PM. Open a draft → edit → **Approve & Send**.
- **Alerts** — escalations, emergency owner alerts, safety-critical, do-not-send, bounces.
- **Documents** — generate a statutory document (entry notice, rent increase, Form 11/12/13),
  view it, **Download PDF**.
- **Maintenance** — maintenance jobs: triage → tradie quotes → owner approval → scheduling.
- **SMS** — (when enabled) inbound tenant texts with drafted replies to review and send.
- **Settings** — spending thresholds, approved tradies, voice samples, house rules,
  prompt versions, regulatory alerts.
- **Audit** — a record of what was generated/sent and the compliance rule versions used.

## B. Onboarding a new agency (your job, ~repeatable)
Full runbook: `docs/ONBOARDING.md`. In short:
1. **Fill a config file:** `cp scripts/agency.example.json scripts/agency.<client>.json` —
   agency name, the mailbox to monitor, nominated repairer (required), tradies,
   thresholds, house rules, voice samples.
2. **Provision:** `node --env-file=packages/db/.env.local scripts/onboard-agency.mjs scripts/agency.<client>.json`
   — creates the agency, its config, an active drafting prompt, and mailbox state.
   Prints the `agency_id`.
3. **Create the PM logins:** in Supabase → Authentication → add each PM with
   `app_metadata.agency_id` = the agency id; add their `authUserId` to the config and
   re-run step 2 to link them.
4. **Connect the mailbox** (see C).
5. **Import owners / properties / tenancies** via **Supabase Studio** (the point-and-click
   table editor over the database — no SQL needed) or a seed.
6. **Smoke test:** email the mailbox → a draft appears in the queue → Approve & Send.

## C. Connecting a mailbox (Google Cloud / Gmail)
1. The OAuth app already exists. For the **smoothest** experience, the agency mailbox
   should be **Google Workspace**, and the Cloud project set to **Internal** for that
   org (no "unverified app" warning, tokens don't expire). For a quick pilot on a
   personal `@gmail.com`, set the OAuth app to **External** and add the mailbox under
   **Test users** (works immediately; the refresh token re-auths ~weekly).
2. Open `https://pm-assistant-worker.ryanmay065.workers.dev/oauth/gmail/start?agency_id=<agency_id>`
   and consent with the agency mailbox → "Mailbox connected."
3. Inbound email now flows into the queue automatically.

## D. Admin / infrastructure reference
- **Worker secrets** (Cloudflare): set with `pnpm --filter worker exec wrangler secret put <NAME>`.
  Full list + purpose in `docs/ENV.md`.
- **Database:** Supabase (managed Postgres). Manage data in **Supabase Studio**.
- **Deploys:** push to `main` → CI (typecheck + lint + tests) → auto-deploy to Cloudflare.
- **Day-to-day operations + gotchas:** `docs/HANDOFF.md`.

---

# Part 5 — Trust, compliance & limits (be upfront with clients)
- **Human-in-the-loop:** the AI never sends — every email and document is PM-approved.
- **Compliance:** notice periods/rules are deterministic and sourced from the RTA; but
  generated documents carry a **"not legal advice — check every detail"** disclaimer.
  The PM remains responsible for what they send.
- **Data isolation:** each agency's data is row-level-security isolated; agencies can't
  see each other's.
- **Not yet included:** voice handling; the SMS front door needs an SMS-capable number
  (AU rules differ from the US); a polished in-app screen to manage properties/tenants
  (use Supabase Studio for now). Pilots run from the Singapore region today — recreate
  in Sydney for an Australian production deployment.

---

*This document is a living overview — keep it in step with `docs/HANDOFF.md` (live
state) and `docs/ONBOARDING.md` (provisioning).*
