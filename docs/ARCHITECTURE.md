# ARCHITECTURE.md

## System overview

Three deploy targets, one database.

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Gmail API     │ ──push──│  Google Cloud    │ ──push──│  Cloudflare     │
│  (per agency)   │         │     Pub/Sub      │         │     Worker      │
└─────────────────┘         └──────────────────┘         └────────┬────────┘
                                                                  │
                                                                  ▼
┌─────────────────┐                                       ┌─────────────────┐
│  Anthropic API  │ ◄─────────── draft requests ────────► │   Supabase      │
└─────────────────┘                                       │  (Postgres +    │
                                                          │   Auth + Vault) │
┌─────────────────┐                                       └────────┬────────┘
│   Twilio / SMS  │ ◄──── emergency alerts ───┐                    │
│   Resend / mail │                            │                   │ realtime
└─────────────────┘                            │                   │
                                               │                   ▼
                                               │           ┌─────────────────┐
                                               └───────────│  SvelteKit      │
                                                           │  Dashboard      │
                                                           │  (CF Workers)   │
                                                           └─────────────────┘
                                                                  ▲
                                                                  │ PMs log in
                                                           ┌─────────────────┐
                                                           │  Property       │
                                                           │  Managers       │
                                                           └─────────────────┘
```

## Inbound email pipeline

1. Each agency completes Gmail OAuth on first onboarding. Refresh token stored in Supabase Vault, scoped by `agency_id`.
2. Worker calls Gmail API `users.watch` on the agency's monitored mailbox(es) to subscribe to new mail. Re-subscription runs daily via a Cron Trigger (watch expires after 7 days).
3. Gmail publishes to a single Pub/Sub topic. Pub/Sub pushes to the Worker's `/webhook/gmail` route.
4. Worker verifies the Pub/Sub JWT (don't trust the payload without verification), pulls the `historyId`, calls Gmail to fetch new messages.
5. For each new inbound message:
   a. Resolve `agency_id` from recipient mailbox.
   b. Persist to `email_threads` (upsert by `gmail_thread_id`) and `email_messages`.
   c. Run the matcher to identify `property_id` / `tenant_id` / `owner_id`.
   d. Load `agency_config` + `prompt_versions` (active row for that agency).
   e. Call `assemble()` to template the prompt.
   f. Call `drafter()` (Anthropic API, tool use with JSON schema).
   g. Persist `ai_drafts` row with structured fields and the draft body.
   h. If `emergency_landlord_alert: true`, look up `owner_notification_preferences` for the property/owner, dispatch via Twilio/Resend, write `notification_log`.
   i. Push realtime event to the dashboard so the PM's queue updates without refresh.

The whole inbound flow runs in a single Worker invocation. Target latency: under 8 seconds from Pub/Sub push to draft persisted. Anthropic call is the dominant cost.

## Outbound send pipeline

1. PM opens the dashboard, reviews queue.
2. PM clicks a draft, optionally edits subject/body, clicks Approve & Send.
3. Dashboard POSTs to Worker `/api/drafts/:id/send` with the (possibly edited) content.
4. Worker:
   a. RLS check via authed JWT.
   b. Write `draft_edits` row capturing the diff (if edited).
   c. Use the PM's Gmail token to send the message in-thread.
   d. Persist outbound `email_messages` row.
   e. Update `ai_drafts.status = 'sent'`.
   f. Write `audit_log` entry.

## Multi-tenancy and security

### Tenant model

`agency_id` is the tenant key. Every business table carries it. Every query (in user-context code) filters by it implicitly via RLS.

### RLS pattern

A helper function reads the agency claim from the JWT:

```sql
create or replace function auth.current_agency_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.app_metadata', true)::jsonb->>'agency_id',
      (current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'agency_id')
    ),
    ''
  )::uuid;
$$;
```

Every table has a policy like:

```sql
create policy tenant_isolation on properties
  for all
  using (agency_id = auth.current_agency_id())
  with check (agency_id = auth.current_agency_id());
```

### Worker access

The Worker uses the Supabase **service-role key** (bypasses RLS) because it processes cross-agency events from Pub/Sub. Every Worker query MUST include an explicit `agency_id` filter. There is no implicit isolation in Worker code. Audit your queries.

A lint rule (Biome custom rule or simple grep in CI) should fail any query in `apps/worker/src/services/supabase.ts` callers that doesn't include `.eq('agency_id', ...)`.

### Secrets

| Secret | Where | Why |
|---|---|---|
| Anthropic API key | Wrangler secret on the Worker | Worker calls Claude |
| Supabase service-role key | Wrangler secret on the Worker | Worker bypasses RLS |
| Supabase anon key | Public, in web app build | Dashboard uses RLS |
| Per-agency Gmail refresh token | Supabase Vault, keyed by `agency_id` | Worker fetches and uses to call Gmail |
| Pub/Sub verification public keys | Worker fetches and caches | Verify push tokens |
| Twilio / Resend keys | Wrangler secrets | Notifications |

Gmail tokens NEVER live in a regular column. Always Vault.

## Property/tenant matcher

Cascade, in order. Stops at first confident match.

1. **Exact email match.** Sender address → `tenants.email` or `owners.email` (scoped to agency). If unique, match.
2. **Thread continuity.** Existing `email_threads` row with `gmail_thread_id` → inherit its `property_id`.
3. **Subject fuzzy match.** Tokenise subject, look for street/suburb tokens that appear in `properties.address_line1`. Score with simple overlap. If score > threshold, match.
4. **Body scan.** Same approach on body (first 500 chars).
5. **Fallback.** `property_id: null, needs_triage: true`. Surface a disambiguation widget in the dashboard.

Track match confidence on the draft row (`match_confidence: 'high' | 'medium' | 'low' | 'none'`) and surface it to PMs. Don't try to be clever — getting this 80% right is fine.

## Prompt assembly

The base prompt is a markdown file in `packages/prompts/src/base/pm-drafting-v{X.Y}.md`. It contains placeholders:

```
[AGENCY_NAME]
[SUBURB]
[BUSINESS_HOURS]
[AFTER_HOURS_LINE]
[PM_NAME]
[APPROVED_TRADIES]
[NOMINATED_REPAIRER]
[SPENDING_THRESHOLD]
[VOICE_SAMPLES]
[HOUSE_RULES]
```

`assemble(opts)` reads from `agency_config` and templates these in. Returns the final system prompt string. Pure function, no I/O — fetch the config in the caller, pass it in. Testable.

## Drafter (Anthropic API)

Use tool use with a JSON schema. The "tool" is `submit_draft` and Claude's only job is to call it with the right arguments. Schema is the canonical mapping to the `ai_drafts` table.

```ts
const tool = {
  name: "submit_draft",
  description: "Submit the structured draft reply for PM review.",
  input_schema: {
    type: "object",
    required: [
      "category", "category_confidence", "priority",
      "escalation_flag", "emergency_landlord_alert",
      "do_not_send", "draft_confidence",
      "draft_subject", "draft_body", "pm_review_notes"
    ],
    properties: {
      category: { type: "string", enum: ["MAINTENANCE","RENT","LEASE","COMPLAINT","ADMIN","OTHER"] },
      category_confidence: { type: "string", enum: ["HIGH","MEDIUM","LOW"] },
      priority: { type: "string", enum: ["STANDARD","PRIORITY","EMERGENCY_ALERT"] },
      escalation_flag: { type: "string", enum: ["NONE","WELFARE","LEGAL","REPUTATIONAL","INCIDENT"] },
      emergency_landlord_alert: { type: "boolean" },
      do_not_send: { type: "boolean" },
      draft_confidence: { type: "string", enum: ["HIGH","MEDIUM","LOW"] },
      draft_subject: { type: "string" },
      draft_body: { type: "string" },
      pm_review_notes: { type: "array", items: { type: "string" } }
    }
  }
};
```

Set `tool_choice: { type: "tool", name: "submit_draft" }` to force the model to use it. Validate the result with zod before persisting.

Model selection:
- Default: `claude-sonnet-4-6`
- For LEGAL or REPUTATIONAL escalation drafts: `claude-opus-4-7` (decide based on a fast pre-classifier or just always-on for these — measure)

## Owner notification routing

When `emergency_landlord_alert: true`:

1. Look up `owner_notification_preferences` for the property (property-level override beats owner-level default).
2. Apply the profile:
   - `immediate` → SMS via Twilio + email via Resend, immediately
   - `business_hours` → if now() is in business hours: immediate. Else queue to next business day digest.
   - `safety_critical_only` → only send if the AI's `pm_review_notes` indicate property is unsafe/insecure/structural/insurance. Otherwise log suppression and queue to digest.
   - `email_only` → email via Resend only, no SMS
   - `pm_proxy` → no immediate alert; queue to owner's daily digest
3. Write `notification_log` row regardless (including suppressions).

Daily digest is a Cron Trigger that runs at 7am AEST per agency, aggregates queued notifications per owner, sends a summary email.

## Realtime dashboard updates

Supabase Realtime broadcasts on the `ai_drafts` table (filtered by `agency_id` via RLS). Dashboard subscribes; new drafts appear in the queue without polling. Cheap and reliable.

## Audit and observability

- Every state change writes to `audit_log` with `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, and a metadata blob.
- Worker emits structured JSON logs to Cloudflare Logs.
- Anthropic responses are stored (request/response pair, redacted) for 90 days in a `model_calls` table — useful for debugging drift and for QCAT evidence if it ever comes up.

## What we explicitly defer

- Trust accounting (regulated, separate problem)
- Tenant and owner portals (Phase 2)
- Form generation (Phase 2)
- Inspection scheduling (Phase 2)
- Mobile native apps (web is mobile-responsive for v1)
- Multi-region / data residency controls (all data in Supabase Sydney region for v1)
