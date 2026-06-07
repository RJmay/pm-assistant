# PM-Manager — Master Build Specification

**Target executor:** an agentic coding tool (Claude Code, running in Google Antigravity).
**Document purpose:** the single source of truth for building the entire system, all five phases plus the regulatory-monitoring service. Read this top to bottom before writing any code. Build in the phase order given. Do not skip ahead.

---

## 0. Instructions to the building agent (read first)

You are building a production system from a greenfield repository. Follow these rules for the whole build:

1. **Build phase by phase, in order.** Phase 1 must be fully working and meet its Definition of Done before you start Phase 2. Each phase is shippable on its own.
2. **Ask before assuming** on anything involving: external API credentials, a third-party account that must be created by a human, payment, or anything that sends a message/email to a real recipient. Surface the blocker and wait.
3. **Never invent regulatory facts.** All Queensland tenancy rules live as versioned data in the rules engine (Section 6), seeded from the values in this document. If a rule is needed that is not in the seed data, stop and flag it — do not have an LLM guess it.
4. **The system never sends anything to a tenant, owner, or third party on its own.** Every outbound communication is drafted and queued for a human to approve and send. This is a hard product constraint, not a configurable setting. See Section 13.
5. **Keep AI swappable.** All model calls go through the provider abstraction in Section 5. No direct SDK calls scattered through the codebase. No business logic depends on a specific model or vendor.
6. **Compliance and numeric logic are deterministic code, never LLM output.** Notice periods, date math, rent-increase eligibility, form selection, and escalation triggers are computed by the rules engine. The LLM only writes prose.
7. **Multi-tenant from day one.** Every row that belongs to an agency carries `agency_id`, and Supabase Row Level Security enforces isolation. No cross-agency data access is ever possible.
8. **Audit everything.** Every inbound item, every draft, every edit, every send, every rule applied, every model call is written to an append-only audit log. This is both a compliance requirement and the basis for the monthly value report.
9. **Write tests as you go.** The 9-email test pack (Section 14) is the regression suite for the AI layer — wire it up in Phase 1 and keep it green.
10. **Conventions:** TypeScript everywhere, strict mode on. Small, well-named modules. No secrets in code — everything via environment variables. Commit after each working unit with a clear message.

When a phase is done, produce a short `PHASE_N_DONE.md` summarising what was built, how to run it, and what env vars/accounts it needs.

---

## 1. Where we are starting from

**Current asset (validated, to be ported into code):**
- A master system prompt tuned for Queensland's Sunshine Coast property-management agencies. It classifies an inbound tenant/landlord email and drafts a reply in the agency's voice, returning a fixed structure: `CATEGORY` (MAINTENANCE | RENT | LEASE | COMPLAINT | ADMIN | URGENT | OTHER), `CONFIDENCE` (HIGH | MEDIUM | LOW), `SUGGESTED PRIORITY` (Same day | 24h | 48h | This week), `DRAFT REPLY`, and `PM REVIEW NOTES`.
- An agency intake/discovery worksheet (the per-client configuration inputs).
- A 9-email test pack covering every category plus the critical edge cases (emergency repair, rent pushback, lease break, repeat noise complaint, QCAT threat, inspection reschedule, owner email, and a domestic-violence safety case).

**What does not exist yet:** any code. This is a clean build. The prototype's prompt and rules are *inputs* to this spec, ported into the AI layer (Section 5) and rules engine (Section 6).

**The goal of this build:** turn the manual, paste-an-email prototype into a multi-tenant application where (a) email is ingested automatically, (b) routine replies are produced deterministically from templates with AI used only for the genuinely novel, (c) all QLD compliance logic is rules-based, (d) a PM reviews and sends from one queue, and (e) the product expands across the five phases into a near-complete "AI property-management associate."

---

## 2. Product overview & architectural principles

**What it is:** an AI-assisted operations layer for residential property-management agencies in Queensland. It drafts and coordinates the repetitive communication and documentation work; a human property manager stays in control of everything that goes out.

**Who it's for:** PM agencies on the Sunshine Coast / Brisbane initially. Multi-tenant — many agencies, strict isolation, per-agency voice and configuration.

**The value being sold** (informs feature-flagging and tiering, Section 15): recovered PM capacity (more doors per PM without hiring), reduced compliance/QCAT risk, and retention of burned-out PMs — *not* "we call an LLM."

**Core architectural principles (non-negotiable):**

- **Human-in-the-loop.** Draft → PM review queue → PM approves → PM sends. The system never auto-sends. Ever.
- **Deterministic backbone, AI at the edges.** Workflow state, routing, scheduling, date math, eligibility, and form selection are deterministic code. The LLM is invoked only to write or adapt prose, and only for the genuinely novel ~30% of messages. This keeps the system reliable, auditable, compliant, and cheap regardless of AI pricing.
- **Provider-agnostic AI.** A single abstraction wraps the model. Models are swappable, and a cheap model handles the easy work while an expensive one is reserved for hard cases. Open-weight/self-hosted is a supported future fallback.
- **Compliance is data, not inference.** Every legal rule is versioned data with an effective date. The engine selects rules by date; the LLM is never the source of a notice period or a statutory requirement.
- **Strict multi-tenancy.** `agency_id` on every tenant-owned row; Supabase RLS enforced.
- **Append-only audit log.** Everything is recorded.
- **Privacy by default.** Minimal PII, no sensitive data in logs, no third-party data sharing without explicit human action.

---

## 3. Technology stack

Chosen for: solo/lean operation, generous free tiers, strong fit for an agentic coder, and minimal vendor lock-in.

| Layer | Choice | Notes |
|---|---|---|
| Web app + PM dashboard | **Next.js (App Router) + TypeScript + Tailwind CSS** | Server components for the queue; client components for interactive review. Strict TS. |
| Database, auth, storage | **Supabase** (Postgres + Auth + Storage + Row Level Security) | RLS is the multi-tenant isolation mechanism. Storage holds attachments and generated documents. |
| Background jobs & durable workflows | **Inngest** | TypeScript-native, durable, retriable. Powers scheduled scans, trigger-based sequences (Phase 2+), and the monitoring bot. Free tier is ample early. |
| AI | **Anthropic API** via the provider abstraction in Section 5 | See model routing below. Use pinned, versioned model strings. |
| Inbound/outbound email | **Gmail API** + **Microsoft Graph (Outlook)** | Start with a dedicated forwarding address per agency for ingestion; sending is done by the PM from their own client (we draft, they send). |
| PM software (CRM) integration | **Adapter pattern** for PropertyMe / Console Cloud / Rex | Phase 2+. Define the interface now; start with CSV/manual import so nothing is blocked on API access. |
| Hosting | **Vercel** (app) + **Supabase Cloud** + **Inngest Cloud** | All free/cheap to start. |

**Model routing (Anthropic — verified current strings, use pinned versions):**
- **Classification & routing & template selection:** `claude-haiku-4-5-20251001` — fast, cheap, runs on the bulk of volume.
- **Drafting novel replies (default):** `claude-sonnet-4-6` — the balanced workhorse; strong tone-matching and tool use.
- **Hardest / sensitive / high-stakes drafting where quality is critical:** `claude-opus-4-8` — most capable; reserve for cases the cascade escalates.

Always call the model via the abstraction, always pass the pinned string, never use unversioned aliases.

**Suggested repo layout (monorepo, single Next.js app to start):**
```
/app                  # Next.js routes (dashboard, review queue, settings)
/lib
  /llm                # provider abstraction, routing, prompt assembly
  /rules              # QLD rules engine (deterministic)
  /templates          # template library + merge engine
  /email              # Gmail + Graph adapters (ingest/send-draft)
  /crm                # CRM adapter interface + per-vendor adapters
  /sequences          # Inngest functions: outbound sequences, scans
  /monitoring         # regulatory monitoring bot
  /audit              # audit log writer + readers (reporting)
  /db                 # Supabase client, types, queries
/supabase             # migrations, RLS policies, seed data
/tests                # incl. the 9-email regression pack
```

---

## 4. Data model (core tables)

All agency-owned tables carry `agency_id uuid not null` with an RLS policy restricting access to the requesting agency. Use `created_at`/`updated_at` timestamps throughout. Key tables:

- **agencies** — id, name, location, plan/tier, feature flags (jsonb), settings.
- **users** — id, agency_id, email, role (principal | pm | operator), name, signature block.
- **agency_voice** — agency_id, sample approved replies (text[]), tone notes, sign-off format, words/phrases to avoid.
- **tradies** — agency_id, name, trade, contact, on-call/scheduled/ad-hoc, notes.
- **spending_authority** — agency_id, routine-repair threshold, escalation rule notes.
- **properties** — agency_id, address, owner_id, type, quirks/house-rules (jsonb), CRM external_id (nullable).
- **owners** — agency_id, name, contact, preferences, sensitive-case flag.
- **tenancies** — agency_id, property_id, tenant_id, lease_start, lease_end, rent_amount, rent_frequency, last_rent_increase_date, agreement_form, status.
- **tenants** — agency_id, name, contact, sensitive-case flag.
- **inbound_emails** — agency_id, source (gmail|outlook), from, subject, body, received_at, raw_ref, status (new|classified|drafted|approved|sent|escalated).
- **drafts** — agency_id, inbound_email_id (nullable for outbound), category, confidence, priority, draft_body, review_notes (jsonb), generated_by (template|llm:model), escalation_flags (text[]), status, edited_body (nullable), sent_at (nullable).
- **templates** — agency_id (nullable = global), key, category, subject_pattern, body_pattern (with variable slots), required_variables (text[]), is_active.
- **regulatory_rules** — jurisdiction (QLD), key, value (jsonb), effective_from, effective_to (nullable), source_url, version, notes. (Section 6.)
- **sequences** — agency_id, type (arrears|renewal|inspection|owner_update), config (jsonb), is_active. (Phase 2.)
- **sequence_runs** — agency_id, sequence_id, target_ref, state, next_action_at, history (jsonb).
- **maintenance_jobs** — agency_id, property_id, issue, classification (emergency|routine|...), state, quotes (jsonb), owner_approval_state, scheduled_for. (Phase 3.)
- **documents** — agency_id, type (entry_notice|breach_notice|notice_to_leave|renewal|condition_report), property_id/tenancy_id, generated_pdf_ref, rule_version_used, status. (Phase 4.)
- **audit_log** — agency_id, actor (user|system|llm), action, entity_type, entity_id, detail (jsonb), created_at. **Append-only.**
- **regulatory_alerts** — source, detected_at, change_summary, affected_modules (text[]), proposed_changes (jsonb), operator_review_state, client_notice_sent. (Section 12.)

---

## 5. The AI layer (`/lib/llm`)

**Provider abstraction.** Define an interface so all model use is swappable:

```ts
interface LlmProvider {
  classify(input: ClassifyRequest): Promise<Classification>;     // category, confidence, escalation flags
  draft(input: DraftRequest): Promise<DraftResult>;              // prose only
}
```
Implement `AnthropicProvider` first. The router decides which model string to use per call. No other module imports the Anthropic SDK directly.

**The cascade (cost + reliability):**
1. **Classify** every inbound email with Haiku: category, confidence, priority signal, and — critically — **escalation flags** (Section 13 list). Cheap, fast.
2. **If it matches a known pattern** (high confidence + a routine category with an active template): hand to the **template engine** (Section 5b). No expensive generation.
3. **If novel** (low/medium confidence, or no template, or complex): draft with Sonnet.
4. **If sensitive/high-stakes** (escalation-adjacent, complaint with legal tone, or flagged): draft a *brief, careful acknowledgement only* with Opus, and route to human review with a prominent flag. Never let the model resolve a sensitive matter.

**Prompt assembly.** The system prompt is the validated prototype prompt, parameterised: inject the agency's `agency_voice`, `tradies`, `spending_authority`, and `house_rules` at call time. Keep the prototype's output contract exactly (CATEGORY / CONFIDENCE / SUGGESTED PRIORITY / DRAFT REPLY / PM REVIEW NOTES). Validate model output against a strict schema; on malformed output, retry once then route to human with a flag.

**Hard prompt rules (carried from the prototype, enforced in code where possible):**
- Never commit the owner to repairs, costs, rent reductions, bond outcomes, lease variations, or compensation.
- Never promise specific tradie attendance times.
- Never disclose information about other tenants/owners/staff.
- Never speculate on legal outcomes (QCAT, RTA disputes, insurance).
- Australian English; agency voice; concise.

**5b. Template engine (`/lib/templates`).** The routine ~60–70% of email is ~15–20 recurring patterns (maintenance acknowledgement, rent reminder, inspection notice, renewal offer, arrears notice, general enquiry, etc.). For these: pick the matching active template, merge variables (property, names, dates from the rules engine), done. Templates are pre-vetted, so they cannot hallucinate and they encode compliant language. Store per-agency overrides; fall back to global templates.

**5c. Retrieval / voice.** Optionally retrieve the agency's past approved replies (`agency_voice.samples` + historical approved `drafts`) as style exemplars for novel drafts, so the system reuses proven phrasing and gets better the longer an agency stays (this is also a retention mechanism).

**5d. Guardrails.** Output-schema validation; the escalation classifier (Section 13) runs on every inbound item independently of category; a global "never-send" guarantee (no code path sends without a human action).

---

## 6. The compliance / rules engine (`/lib/rules`) — deterministic, NOT AI

This is the spine of the compliance value and must be code + versioned data, never model output. Rules are rows in `regulatory_rules`, selected by `effective_from`/`effective_to` against the relevant date.

**Seed the engine with the current Queensland framework** (governing law: *Residential Tenancies and Rooming Accommodation Act 2008* (Qld) — the RTRA Act; supporting regulation: *Residential Tenancies and Rooming Accommodation Regulation 2025*, commenced 1 September 2025; administering body: the Residential Tenancies Authority (RTA); tribunal: QCAT). Seed at minimum:

- **Rent increases:** limited to once every 12 months, and since **6 June 2024** the annual limit attaches to the **property**, not the tenancy. Minimum written notice period for an increase: **2 months**. (Store as data with effective dates.)
- **Rent bidding:** banned (all forms) since **6 June 2024**.
- **Entry notices & frequency:** updated **1 May 2025** (entry notice periods and frequency, privacy provisions). Store the current notice period for routine entry and the entry-frequency cap as data.
- **Minimum housing standards:** in force for all tenancies (phased to **1 September 2024**).
- **Forms:** general tenancy agreement (**Form 18a**), and the other RTA forms relevant to drafting — entry notice (**Form 9**), notice to remedy breach (**Form 11**), notice to leave (**Form 12**), notice of intention to leave (**Form 13**), and the bond-dispute forms (**Form 4** refund of rental bond + **Form 16** dispute resolution request). _(Corrected June 2026: the original draft listed "disputed bond (Form R12)", but Form R12 is the **rooming-accommodation** notice to leave — out of v1 residential scope — not a disputed-bond form. Confirmed from rta.qld.gov.au.)_ Forms were updated under the 2025 Regulation (18a, 18b, R18) — store form identifiers + the version/source.
- **Emergency repairs (RTRA s214):** the statutory list (burst water service; blocked/broken single toilet; serious roof leak; gas leak; dangerous electrical fault; flooding/serious storm or fire damage; failure/breakdown of gas/electricity/water supply; failure of an essential service such as hot water or cooking; any fault/damage making the premises unsafe or insecure). Used by the maintenance triage to classify EMERGENCY vs routine.
- **Prescribed house rules transition:** existing Schedule 5 (2009 Regulation) house rules continue until **31 August 2026**; from **1 September 2026** all prescribed house rules must meet the 2025 Regulation requirements. Flag this forward-dated change.

**Engine responsibilities:**
- `getRule(key, asOfDate)` → returns the rule version effective on that date.
- Date math: given a tenancy and an action, compute the compliant notice date / earliest valid date.
- Eligibility: e.g. `canIncreaseRent(tenancy, proposedDate)` → boolean + reason, using the property-based 12-month rule and the 2-month notice rule.
- Form selection: given an action, return the correct current form + version.
- All outputs carry the `rule_version` used, written to the audit log.

The monitoring bot (Section 12) proposes updates to this table; a human approves them; versions are never silently overwritten — new rows with new effective dates are added.

---

## 7. PHASE 1 — Inbound drafting + PM review queue (the beachhead / MVP)

**Goal:** replace the manual paste-an-email prototype with an automatic pipeline and a single review screen. This is the shippable product you pilot with the first agency.

**Scope:**
- **Ingestion:** dedicated forwarding address per agency; Gmail API + Graph adapters pull new mail into `inbound_emails`.
- **Pipeline:** classify (Haiku) → escalation check → template-or-LLM draft → write `drafts` row with category, confidence, priority, review notes, escalation flags, and `generated_by`.
- **PM review queue (the core UI):** a prioritised list of pre-drafted replies. Each item shows the original email, the category/confidence/priority, the draft, the review notes, and any escalation flag. PM can edit inline, approve, or dismiss. Approval marks the draft ready and surfaces a one-click "copy / open in mail client to send" (PM sends; system does not).
- **Per-agency configuration UI:** voice samples, tradies, spending authority, house rules, signature blocks. (This is the digital version of the intake worksheet.)
- **Audit + metrics:** log everything; compute time-handled and volume for the value report.

**Out of scope for Phase 1:** outbound sequences, CRM write-back, document generation, voice/SMS. Use manual/CSV import for property/tenant data if needed.

**Definition of Done:**
- New agency can be onboarded via the config UI in under ~30 minutes.
- Inbound email auto-appears in the queue, correctly classified, with a usable draft.
- Routine categories are served by templates (no LLM call) and verified compliant.
- Escalation cases (DV, QCAT, etc.) produce only a brief acknowledgement and a prominent human-review flag, never a resolving reply.
- The 9-email regression pack passes (Section 14).
- Audit log populated; a basic "this period: N emails handled, est. hours saved" figure renders.
- Strict RLS verified (an agency cannot read another's data).

---

## 8. PHASE 2 — Proactive outbound sequences

**Goal:** automate the recurring *outbound* work, which is a larger time sink than inbound. Trigger-based, drafted-and-queued (still human-sent).

**Scope (each as an Inngest workflow + templates + rules):**
- **Arrears sequence:** detect late payment (CRM signal or manual flag) → fire the compliant reminder sequence as queued drafts → escalate to the PM only when it crosses the genuine-collections threshold. The PM's time goes to the real problem, not the first two reminders.
- **Lease-renewal pipeline:** detect upcoming expiries → draft renewal / rent-review offers using the rules engine for compliant notice periods and the property-based increase rule → track responses → draft chasers. (Protects revenue: poor renewal comms is a top driver of non-renewal.)
- **Inspection scheduling:** detect due routine inspections → draft compliant entry notices (correct notice period from the rules engine) and scheduling messages → track.
- **Owner updates:** draft periodic owner status updates / month-end summaries from available data.

**Dependencies:** the CRM adapter interface (start with one vendor or CSV); Inngest scheduled scans; rules engine for all dates.

**Definition of Done:** each sequence detects its trigger, produces correctly-timed compliant draft messages into the review queue, tracks state across runs, and escalates per its threshold. All notice periods come from the rules engine and are audit-logged with the rule version.

---

## 9. PHASE 3 — Maintenance coordination agent

**Goal:** automate the highest-effort-per-instance workflow — the maintenance back-and-forth.

**Scope:** for a maintenance request: triage (EMERGENCY vs routine via the s214 list in the rules engine) → draft tradie quote requests to the agency's approved tradies → track/chase quotes → draft the owner-approval request (respecting the spending-authority threshold) → on approval, draft scheduling messages → follow up → close out → log. The PM makes the judgment calls and approvals; the agent runs the coordination and drafting. The system never commits the owner to spend or promises tradie times (enforced).

**Definition of Done:** a maintenance request moves through the full state machine with the correct human approval gates (owner approval above threshold, PM oversight throughout), all messages queued not sent, emergencies correctly prioritised, everything audit-logged.

---

## 10. PHASE 4 — Document + compliance engine

**Goal:** generate the QLD statutory documents correctly, on demand, from data + rules.

**Scope:** generate entry notices (Form 9), notices to remedy breach (Form 11), notices to leave (Form 12), lease renewals, rent-increase notices, and condition reports. All statutory language, notice periods, and dates come from the rules engine (Section 6); property/tenancy specifics merge from the data model. Output a clean PDF stored in `documents`, tagged with the `rule_version` used. The drafting of *form content* is rules-driven; the LLM may assist only with free-text narrative sections, never with statutory fields.

**Definition of Done:** each document type generates with correct current forms, correct computed dates, correct merged details, and a stored audit trail of the rule version applied. No statutory field is ever LLM-generated.

> Use the PDF generation approach from the project's `pdf` skill when implementing document output.

---

## 11. PHASE 5 — Voice/SMS front door

**Goal:** remove the interrupt load — the constant "what's happening with my repair?" calls and texts.

**Scope:** an SMS auto-responder and/or AI voice layer that handles routine inbound status queries and routing. Routine status requests get an immediate accurate response drawn from current state (e.g., maintenance job status); anything non-routine is captured, summarised, and routed into the PM queue. Same constraints: never commit, never resolve sensitive matters, escalate per Section 13. Requires a telephony/SMS provider (e.g. a programmable messaging API) — flag the account/credential need to the human before building.

**Definition of Done:** routine inbound SMS/voice status queries are answered correctly and automatically; everything else is captured and queued; full transcript/audit logging; all hard constraints enforced.

---

## 12. Regulatory monitoring bot (`/lib/monitoring`) — cross-cutting

**Goal:** keep every agency's rules and templates current as Queensland law changes, alert the operator to act, and turn each change into a client-facing value moment. This is a primary retention mechanism.

**Why it matters (do not weaken the human-in-the-loop here):** QLD tenancy law changes frequently and in staged waves (e.g. 6 Jun 2024, 30 Sep 2024, 1 May 2025, the 1 Sep 2025 regulation remake, and forward-dated changes through 2026). Even official sources lag and stage their updates — so a monitored, human-reviewed service has real value, and a missed or misread change is a real liability.

**Sources to monitor (in priority order):**
1. **RTA** (rta.qld.gov.au) — rental-law-changes pages, news, and **forms** (the authority for forms and bonds).
2. **Department of Housing** (housing.qld.gov.au) — legislation / rental-law-change news.
3. **Queensland Legislation register** (legislation.qld.gov.au) — the RTRA Act and the 2025 Regulation themselves.
4. **Queensland Parliament** — bills in progress (advance warning of upcoming change).
5. **Industry interpreters** (e.g. REIQ, Real Estate Excellence member updates) — fast secondary signal and plain-English translation.

**Architecture:**
- **Scheduled scan** (Inngest cron, daily/weekly per source). Use RSS where available; otherwise hash-and-diff the relevant page sections.
- **On a detected change**, and only then, invoke the LLM (Sonnet) to summarise: what changed, the effective date, and which modules/rules/templates it affects. (AI cost is trivial because it only fires on a rare diff.)
- **Write a `regulatory_alerts` row** with a structured summary + **proposed changes** to the `regulatory_rules` table / templates.
- **Alert the operator** (email/Slack/SMS) with the summary and proposed diff.
- **Human approves** → the system adds new versioned rule rows (new effective dates; never silent overwrite) and updates affected templates → pushes to affected tenants.
- **Client-facing notice:** auto-draft a per-agency heads-up ("QLD changed X effective [date]; your system is already updated; here's what it means"). This is the monthly value report made concrete — and the thing that makes cancelling feel reckless.

**Hard constraint:** this is decision-support for the operator and a template-currency service — **not** a guarantee of legal compliance, and not an auto-updater of legal documents without human review. Position it accordingly; keep the agency's own compliance sign-off in the loop. (We are not lawyers.)

**Definition of Done:** scans run on schedule; a simulated source change produces a correct alert with a proposed rule diff; operator approval cleanly adds a new versioned rule and updates affected templates; a client notice is drafted; nothing changes a live legal document without human approval.

---

## 13. Safety, compliance & legal constraints (hard rules — apply to every phase)

**Never auto-send.** No code path sends a message to a tenant, owner, or third party without an explicit human approval action. This includes SMS/voice (Phase 5) and all sequences.

**Escalation list — on detecting any of these, produce only a brief, careful acknowledgement and route to a human with a prominent flag; never let the system resolve the matter:**
- any mention of self-harm, suicide, or harm to others;
- domestic-violence indicators;
- mention of QCAT, an RTA dispute, legal action, or a lawyer;
- death of a tenant or in the property;
- media or police involvement;
- allegations of staff misconduct;
- discrimination complaints.

The escalation classifier runs on every inbound item independently of its category. When in doubt, escalate.

**Never give legal or financial advice**, never speculate on legal outcomes, never commit the owner to money/repairs/variations/compensation, never promise tradie attendance times, never disclose third-party personal information.

**Privacy:** minimal PII; never put sensitive personal data in logs or URLs; no third-party data sharing without explicit human action; RLS enforced; attachments handled in Supabase Storage with access control.

**Compliance integrity:** every statutory field and date is rules-engine-derived and audit-logged with its rule version; no statutory content is ever LLM-generated.

**Audit:** append-only log of every item, draft, edit, send, rule applied, and model call.

---

## 14. Build sequence, testing & milestones

**Order:** Section 6 (rules engine seed) and Section 5 (AI layer) are foundational — build them early in Phase 1. Then Phase 1 → 2 → 3 → 4 → 5. The monitoring bot (Section 12) can be built alongside Phase 1 (it depends on the rules engine) and is recommended early because it is a key selling point.

**Per-phase Definition of Done:** as specified in each section, plus: tests green, RLS verified, audit log populated, `PHASE_N_DONE.md` written.

**Regression suite — the 9-email test pack:** port the prototype's 9 test emails (one per category plus the edge cases: emergency burst pipe, routine fix, rent pushback, lease break, repeat noise complaint, QCAT threat, inspection reschedule, owner email, domestic-violence safety case) as automated tests against the AI layer. Each asserts the expected category, that emergencies are prioritised correctly, and — most importantly — that the two failure-mode cases (emergency and DV) are handled correctly (emergency prioritised; DV escalated with only a brief acknowledgement, never a resolving reply). Keep this green for the life of the project; run it in CI on every change to the AI layer or prompts.

**Other tests:** rules-engine unit tests (date math, eligibility, form selection across effective-date boundaries); RLS isolation tests; sequence state-machine tests; monitoring-bot diff-and-alert test with a simulated source change.

---

## 15. Appendix — economics & tiering (maps features to pricing)

Feature flags (`agencies.feature_flags`) gate phases so the build maps directly to pricing tiers:

- **Tier 1 — Drafting:** Phase 1 (inbound drafting + review queue).
- **Tier 2 — Drafting + Documents + Compliance:** + Phase 4 + the regulatory monitoring service.
- **Tier 3 — Full Ops:** + Phases 2, 3, 5 (outbound sequences, maintenance coordination, voice/SMS).

**Pricing context (for feature-gating and onboarding flows, not hard-coded billing):** a one-off setup/onboarding fee (~$2,000–4,000), then either per-PM-seat (~$349–499/PM/month) or per-door (~$2–3/property/month). Price on value delivered (recovered capacity, risk reduction, retention), not as a markup on AI cost — so falling model costs widen margin rather than forcing price cuts. The monthly value report (driven by the audit log) is the renewal mechanism; the regulatory monitoring service and the per-agency tuned voice are the switching costs that hold the retainer.

---

*End of specification. Build Phase 1 first. Ask before any action that creates an account, spends money, or sends a real message. Never invent a regulatory fact. Never auto-send.*
