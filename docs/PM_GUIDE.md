# PM Assistant — Property Manager Guide

A short guide for property managers using the daily review queue. The in-app
version lives at **/help**.

## The one rule that never changes

**PM Assistant never sends anything on its own.** For every inbound email it
writes a *draft* reply and puts it in your queue. You review, edit if needed,
and send. Nothing leaves the agency without a person clicking **Approve & Send**.

## The daily flow

1. **Queue** (`/queue`) — your prioritised list of pre-drafted replies. Default
   order: highest priority first, then oldest waiting first.
2. **Open a draft** — the left panel is the **inbound email** (read-only); the
   right panel is the **draft reply** you can edit (subject + body).
3. **Edit & save** — *Save edit* keeps your changes without sending and records
   them in the draft's history.
4. **Approve & Send** — sends the reply in the original email thread, from the
   agency mailbox. (You'll see a confirmation toast.)
5. **Discard** — removes a draft from the queue with an optional reason (logged).

## What the labels mean

**Priority** — how fast it likely needs a reply:
- **Emergency alert** — urgent; may also have triggered a landlord alert.
- **Priority** — handle today.
- **Standard** — routine.

**Category** — Maintenance · Rent · Lease · Complaint · Admin · Other.

**Escalation flags** — when the AI spots something sensitive, it writes only a
brief, careful acknowledgement and flags it for you. It never tries to resolve
these itself:
- **Welfare** — self-harm, domestic violence, a death, or similar. Handle with
  care; follow your agency's welfare process.
- **Legal** — QCAT, an RTA dispute, a lawyer, or legal action mentioned.
- **Reputational** — media, police, staff-conduct, or discrimination concerns.
- **Incident** — a notable event needing a record.

**Other flags:**
- **Safety critical** — the property may be unsafe, insecure, or have an
  insurance-relevant defect.
- **Landlord alert** — the owner has been (or should be) alerted out-of-band.
- **Do not send** — the AI is *not* confident this should go out as-is. The body
  is a starting point, not a sendable reply — review carefully.
- **Bounced** — a reply you sent could not be delivered. Check the recipient
  address and resend.

**Match confidence** — how sure the system is that it linked the email to the
right property/tenant (High / Medium / Low / None). Low/None means double-check
who you're replying to.

## Other screens

- **Alerts** (`/alerts`) — a focused stream of everything flagged: escalations,
  emergencies, safety-critical, do-not-send, and bounced drafts.
- **Audit log** (`/audit`) — an append-only record of every inbound item, draft,
  edit, send, and system action. Filter by action, actor, or date.
- **Settings** (`/settings`) — agency configuration (tradies, voice samples,
  spending thresholds, house rules). Admins also get **prompt-version
  management** (`/settings/prompts`).

## Good habits

- Read the **PM review notes** under each draft — they flag assumptions and
  things to check.
- The AI will never commit the owner to money, repairs, or timeframes, never
  promise a tradie's arrival time, and never give legal advice. If a draft does
  any of these, edit it out before sending.
- When in doubt on a flagged (escalation) matter, slow down and involve the
  right person — the draft is deliberately minimal.
