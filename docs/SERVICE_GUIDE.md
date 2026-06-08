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

## B. Getting a client up and running

### B1. Information to collect from the client

> 📄 **Downloadable intake sheet:** [`docs/client-intake.csv`](client-intake.csv) — open in
> Excel/Google Sheets and have the client fill the "Your value" column. The tables below are the
> same fields for reference.

**Agency details**

| Field | Example | Required |
|---|---|---|
| Agency name | Acme Property Management | **Yes** |
| Suburb / region | Maroochydore | Optional |
| Business hours | Mon–Fri 9am–5pm AEST | Optional |
| After-hours emergency line | +61 7 5555 0000 | Optional |
| Principal's email | principal@acme.com.au | Optional |

**Mailbox & compliance config**

| Field | Example | Required |
|---|---|---|
| Mailbox to monitor (dedicated agency inbox) | rentals@acme.com.au | **Yes** |
| Nominated repairer — name + phone | Coast Plumbing · +61 7 5443 0000 | **Yes** |
| Approved tradies — name + business-hrs + after-hrs phone, per trade | Coast Plumbing, Sparkwise Electrical | Optional |
| Spending thresholds — auto-approve $ / written-quote $ | $250 / $500 | Optional |
| Voice samples — 2–3 real example replies in their tone | their past emails | Recommended |
| House rules / quirks | "Pet requests reviewed in 7 days" | Optional |

**People & rent roll**

| Field | Example | Required |
|---|---|---|
| Property managers — full name + email (one per login) | Jess Bowman · jess@acme.com.au | **Yes** |
| Owners — name, email, phone | Jordan Reeves · jordan@… | **Yes** |
| Properties — address + owner | 35 Pakenham St → Jordan Reeves | **Yes** |
| Tenancies — rent, frequency, dates | $600/wk · periodic | **Yes** |
| Tenants — name + **email** + phone | Ryan May · ryan@… | **Yes** |

> ⚠️ The **tenant email** is the key that links an inbound message to a property. Make sure the
> rent roll includes it, or drafts arrive as "property unknown."

### B2. Provision + go live
1. **Fill the config:** `cp scripts/agency.example.json scripts/agency.<client>.json` and enter the B1 values.
2. **Provision:** `node --env-file=packages/db/.env.local scripts/onboard-agency.mjs scripts/agency.<client>.json`
   → creates the agency, config, active prompt, mailbox state. Prints the `agency_id`.
3. **Create PM logins:** Supabase → Authentication → add each PM with **App Metadata**
   `{ "agency_id": "<agency_id>" }`; put each new user's id into `pms[].authUserId` and re-run
   step 2 to link them. (A single-PM agency auto-signs drafts in that PM's name.)
4. **Connect the mailbox** (section C) — `/oauth/gmail/start?agency_id=<agency_id>`.
5. **Import the rent roll** (owners → properties → tenancies → tenants) via **Supabase Studio**
   (point-and-click table editor; no SQL).
6. **Smoke test:** email the mailbox as a "tenant" → a draft appears in `/queue` → Approve & Send.

## C. The Google OAuth client + connecting a mailbox

### C1. The OAuth client — set up **once for the platform** (not per client)
In Google Cloud Console (the project that owns the worker), one time:
1. **Enable APIs:** Gmail API + Cloud Pub/Sub API.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - **Application type:** Web application
   - **Name:** "PM Assistant"
   - **Authorized redirect URIs:** add **both**
     `https://pm-assistant-worker.ryanmay065.workers.dev/oauth/gmail/callback/` **and**
     `…/oauth/gmail/callback` (with and without the trailing slash)
   - (Authorized JavaScript origins: not needed — it's a server-side flow.)
   - Save → copy the **Client ID** + **Client secret** into worker secrets
     `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET`.
3. **OAuth consent screen → scopes:** `gmail.modify`, `userinfo.email`, `userinfo.profile`.
4. **Pub/Sub:** create the topic (`PUBSUB_TOPIC`) + a **push** subscription to
   `https://pm-assistant-worker.ryanmay065.workers.dev/webhook/gmail` (auth = the push service
   account, `GOOGLE_PUBSUB_AUDIENCE` = that URL); grant
   `gmail-api-push@system.gserviceaccount.com` the **Publisher** role on the topic.

> `gmail.modify` is a Google **restricted scope**, and your clients are external orgs, so:
> **Pilot** → add each client's mailbox under **OAuth consent → Test users** (works now; the
> refresh token re-auths ~weekly). **Production / many clients** → complete Google's one-time
> **restricted-scope verification** so any client mailbox can connect with no test-user step.
> (A client's own Workspace can't make *your* app "Internal" — that's only for your own org.)

### C2. Connect each client's mailbox (per client)
1. Open `https://pm-assistant-worker.ryanmay065.workers.dev/oauth/gmail/start?agency_id=<agency_id>`.
2. Sign in / consent with the **client's agency mailbox** → "Mailbox connected."
3. Inbound email now flows into that agency's queue automatically.

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
