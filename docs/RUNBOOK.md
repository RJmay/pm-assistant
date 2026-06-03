# RUNBOOK — activating Phases 2–5 + deploy

How to finish the runtime side of the work that's now code-complete on `main`. Do **Step 0 first**
— the deploy needs it or some features error.

---

## ⚠️ Step 0 (REQUIRED) — apply the new DB migrations to the hosted Supabase

Phases 2–5 added migrations **0012–0019** (new tables/columns/enums). The deployed worker + web
read them — most importantly the **Approve & Send** route selects new `ai_drafts` columns, so it
will 500 until these are applied. Apply them to the hosted project (`deisxzmquxjaovubosil`):

```bash
# from the repo root, with the Supabase CLI linked to the hosted project
supabase db push                      # applies 0012–0019 to the hosted DB
# then regenerate the typed client from the live schema (optional but tidy):
supabase gen types typescript --project-id deisxzmquxjaovubosil > packages/db/src/types.ts
```

The migrations are **additive and low-risk** (new tables, new nullable columns, new enum values,
one check-constraint swap on `ai_drafts`). Do this **before or immediately alongside** the deploy.

> If the CLI isn't linked: `supabase link --project-ref deisxzmquxjaovubosil` (needs the DB
> password — per the project notes it contains an `@`, so percent-encode it as `%40` in any URL).

---

## A. Deploy (git push → CI → Cloudflare)

Pushing `main` runs `.github/workflows/ci.yml`: **ci** (typecheck + lint + test on a throwaway
Supabase) → **deploy** (`wrangler deploy` for the worker + `pages deploy` for the web). Docs-only
pushes skip CI/deploy.

```bash
git push origin main
gh run watch                          # follow the CI/deploy run (or watch the Actions tab)
```

After it's green: worker at `pm-assistant-worker.ryanmay065.workers.dev`, web at
`pm-assistant-web.pages.dev`. Smoke-test the queue, then the new `/maintenance`, `/documents`,
`/sms` pages.

---

## B. Activate Form 11 & Form 12 (statutory documents)

These are built but **dormant**: their notice/remedy periods are seeded `needsHumanConfirmation:
true` so the engine refuses to invent them. Confirm the current values from **rta.qld.gov.au**,
then edit `packages/rules/src/seed.ts` — for each of the three rules, set `value: { days: N }` and
flip `needsHumanConfirmation: false`:

- `notice_remedy_breach_rent_arrears` — Form 11 remedy period for unpaid rent
- `notice_to_leave_unremedied_breach` — Form 12 notice after an unremedied breach
- `notice_to_leave_end_of_fixed_term` — Form 12 end-of-fixed-term notice

Also: if a value introduces a new hard date, add it to `SPEC_ASSERTED_DATES` in the same file
(the anti-invention test enforces this), and add positive-path tests in
`packages/rules/test/notices.test.ts` + `packages/documents/test/forms-11-12.test.ts`. This is a
**code change only — no migration**; commit + push to deploy. The `/documents` page already offers
both forms (they currently return a 409 "rule not confirmed yet").

---

## C. Run Phase 5 (SMS front door)

Code is live after the deploy; it needs a Twilio number wired up:

1. **Twilio:** use a number on a **paid** account (the trial blocks unverified recipients); for
   production AU/US messaging, complete A2P registration.
2. **Inbound webhook:** in the Twilio console, set that number's *"A message comes in"* webhook to
   **`https://pm-assistant-worker.ryanmay065.workers.dev/webhook/sms/<AGENCY_ID>`** (HTTP POST).
   `<AGENCY_ID>` is the agency's UUID (the request is signature-verified + scoped to it).
3. **Secrets:** confirm the worker has them — `wrangler secret list` should show
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (set in Phase 1/M7; re-put with
   `wrangler secret put NAME` if missing).
4. **Test:** text the number "any update on my repair?" → it appears on the dashboard **/sms** page
   with a drafted reply for you to review and send. A message mentioning QCAT/DV/self-harm is
   flagged for you and **not** auto-drafted.

---

## D. Deferred (when you want them)

- **Binary PDF for documents** — currently documents render as print-ready HTML (Print / Save as
  PDF from `/documents/[id]`). To produce real PDFs: add a renderer (e.g. `pdf-lib`) behind
  `@pm/documents`' `renderDocumentHtml` seam and upload to a Supabase Storage `documents` bucket;
  store the path instead of inline HTML.
- **Voice** (the other half of §11) — an AI voice layer is a separate telephony integration.
- Owner/tenant portals; listings & leasing; trust accounting (spec's later scope).

---

## Quick reference

| Thing | Where |
|---|---|
| Phase handoffs | `docs/PHASE_2_OUTBOUND.md` … `PHASE_5_SMS.md` |
| Migrations | `supabase/migrations/0012`–`0019` |
| Rules to confirm (Form 11/12) | `packages/rules/src/seed.ts` |
| Worker | `pm-assistant-worker.ryanmay065.workers.dev` |
| Web | `pm-assistant-web.pages.dev` |
