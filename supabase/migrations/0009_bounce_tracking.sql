-- ============================================================================
-- 0009 — bounce / DSN tracking (M9 send path)
-- ============================================================================
-- When a sent reply bounces, the Delivery Status Notification (DSN) arrives in
-- the agency mailbox we already watch (M5), so the inbound pipeline ingests it.
-- We detect DSNs, link them back to the originating draft, and surface them to
-- the PM instead of generating a reply-to-the-bounce.
--
-- ai_drafts gains bounce state; email_messages gains a self-link from the DSN
-- row to the outbound message it reports on, plus an is_bounce flag so the
-- drafting pipeline can skip DSNs.
-- ============================================================================

alter table ai_drafts
  add column bounced_at timestamptz,
  add column bounce_detail text;

-- Surfaced in the dashboard alerts stream alongside escalations.
create index idx_ai_drafts_bounced
  on ai_drafts(agency_id, bounced_at desc)
  where bounced_at is not null;

alter table email_messages
  add column is_bounce boolean not null default false,
  add column bounce_of_email_message_id uuid references email_messages(id) on delete set null;
