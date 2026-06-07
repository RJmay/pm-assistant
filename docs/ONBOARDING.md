# ONBOARDING — provision a new agency (client)

How to take a new property-management agency from nothing to a working pilot. The
**DB side is scripted** (`scripts/onboard-agency.mjs`); the parts that need an
external console (Supabase Auth, Google OAuth, Twilio) are manual and listed here.

> Prerequisite: the **environment** is already set up (Worker secrets, Pages env,
> Supabase project, Google OAuth + Pub/Sub, Twilio, Resend). See `docs/ENV.md`
> "Setup checklist for a new environment". This doc is per-**agency**, not per-env.

---

## 1. Write the agency config

Copy the template and fill it in:

```bash
cp scripts/agency.example.json scripts/agency.acme.json   # one file per client
```

Required: `agency.name`, `mailbox` (the address to monitor), and
`config.nominatedRepairer { name, number }` (drafting **throws** without it —
RTRA s218). Leave `agency.id` blank the first time; paste the printed id back in
for idempotent re-runs.

## 2. Run the provisioning script

```bash
node --env-file=packages/db/.env.local scripts/onboard-agency.mjs scripts/agency.acme.json
```

This upserts (one transaction): `agencies`, `agency_config`, an **active v2.4**
`prompt_versions` row, and `agency_email_state`. It prints the `agency_id` and the
remaining manual steps. Re-running is safe.

## 3. Create the PM login(s) — Supabase Auth

For each PM, in the Supabase dashboard → **Authentication → Add user** (or the
Admin API):
- email + password (or invite),
- **App Metadata:** `{ "agency_id": "<agency_id from step 2>" }` ← this is what
  the JWT carries; RLS + the worker trust it. Without it the user sees nothing.

Then put each new user's **id** into the config's `pms[].authUserId` and re-run
step 2 — that links the `agency_users` rows (signature block, role, etc.).

## 4. Connect the agency mailbox — Gmail OAuth

Visit (signed in as that agency):

```
https://pm-assistant-worker.ryanmay065.workers.dev/oauth/gmail/start?agency_id=<agency_id>
```

Consent with the **dedicated agency mailbox** (not a personal Gmail). The refresh
token is stored in Supabase Vault; the daily cron keeps the Gmail `watch` alive.
(Publish the Google OAuth consent screen first — in "Testing" refresh tokens
expire after 7 days.)

## 5. Wire SMS — Twilio (optional, Phase 5)

- Set the sending number: `wrangler secret put TWILIO_FROM_NUMBER` (the agency's
  AU number, E.164 e.g. `+61480000000`). Also confirm `TWILIO_ACCOUNT_SID` /
  `TWILIO_AUTH_TOKEN` via `wrangler secret list`.
- In the Twilio console, set that number's **"A message comes in"** webhook to
  `https://pm-assistant-worker.ryanmay065.workers.dev/webhook/sms/<agency_id>` (HTTP POST).

## 6. Import owners / properties / tenancies

No UI yet — insert via SQL (or extend `supabase/seed.sql`). Matching of inbound
email → property/tenant relies on these rows existing (`owners`, `properties`,
`tenancies`, `tenants`). Owner notification preferences live in
`owner_notification_preferences` (also DB-only for now).

## 7. Smoke test (proof of life)

1. Email the agency mailbox a tenant-style message → within ~a minute a draft
   appears on **/queue**.
2. Open it, review, **Approve & Send** → the reply is sent from the mailbox; the
   draft flips to `sent`; an `audit_log` row is written.
3. (If SMS wired) text the Twilio number → a drafted reply appears on **/sms**.
4. Generate a document on **/documents** → review + **Download PDF**.

---

## Per-agency checklist

- [ ] `scripts/agency.<client>.json` filled (name, mailbox, nominated repairer)
- [ ] `onboard-agency.mjs` run → `agency_id` recorded
- [ ] PM Auth users created with `app_metadata.agency_id`; `authUserId` linked
- [ ] Mailbox connected via Gmail OAuth (consent screen published)
- [ ] (SMS) `TWILIO_FROM_NUMBER` set + inbound webhook pointed at the agency id
- [ ] Owners / properties / tenancies imported
- [ ] Smoke test passed (email → draft → Approve & Send)
