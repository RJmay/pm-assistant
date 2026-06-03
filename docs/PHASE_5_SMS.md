# Phase 5 — SMS front door

Master spec §11. Remove the interrupt load of "what's happening with my repair?" texts. Inbound
SMS is captured, classified, linked to context, and given a **drafted** reply for the PM to review
and send.

## The §11 ↔ §13 decision

§11 says routine status queries are answered "automatically"; §13 (the hard rule) says **never
auto-send to a tenant without human approval — explicitly including SMS**. The hard rule wins:
inbound SMS → **capture + classify + draft → queue for PM review/send**. Nothing is auto-sent. (A
narrow read-only auto-reply could be a deliberate future carve-out, but it would be exactly that.)

## Flow

1. **Twilio inbound webhook** `POST /webhook/sms/:agencyId` — the agency is in the path (each
   agency points its number's webhook at its own URL). The request is **signature-verified**
   (X-Twilio-Signature, HMAC-SHA1 over the URL + sorted params, Web Crypto) — unverified → 403.
   It returns **empty TwiML**, so Twilio sends no automatic reply.
2. **Classify** (`services/sms-classify.ts`, deterministic): the **escalation check runs first**
   (§13) — a sensitive message (DV, self-harm, QCAT, …) is flagged and **not** auto-drafted.
   Otherwise → `status_query`, `maintenance`, or `general`.
3. **Resolve context**: tenant by phone (trailing-digit match), property via tenancy, and the
   tenant's open maintenance job.
4. **Draft a reply**: a status query draws an accurate status from the open job
   ("your plumbing job is scheduled (visit 2026-06-12)…"); everything else gets a holding ack.
   Escalations get no draft. Stored on `sms_messages` (`status` drafted / escalated).
5. **PM reviews + sends** on the `/sms` page → `POST /api/sms/:id/send` → Twilio send → an outbound
   `sms_messages` row + the inbound marked `sent`. Full transcript retained for audit (§11 DoD).

## Data model

`sms_messages` (migration 0019): direction, from/to numbers, body, provider_sid, `intent`,
`escalation_flag` (reused enum), tenant/property/maintenance_job links, `draft_reply`, `status`,
`reply_to_sms_id` (outbound→inbound), sent_by/sent_at. RLS + realtime.

## Setup needed to RUN it (flagged per spec §11)

- A **Twilio number** (Twilio account off the trial plan — the trial blocks unverified
  recipients; A2P registration for production).
- Configure that number's **inbound SMS webhook** to `https://<worker>/webhook/sms/<agency_id>`.
- Worker secrets already exist from Phase 1/M7: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_FROM_NUMBER`.

## Deferred

- **Voice** (the "/voice" half of §11) — an AI voice layer is a larger, separate provider
  integration; SMS is the high-value first cut.
- **Per-agency SMS number** stored in config (v1 puts the agency id in the webhook path).
- A narrow auto-reply for purely read-only status (would be a deliberate §13 carve-out).

## Runtime DoD (pending Twilio config — same code-now-runtime-later pattern as Phases 1–4)

- A real inbound status text is captured, classified, and a correct status reply is drafted; the
  PM sends it; escalations are flagged and never auto-handled.
