import type { Client } from "@pm/db";
import type { WorkerBindings } from "../lib/env";
import { createLogger, type Logger } from "../lib/log";
import { sendEmail } from "../services/resend";
import { createServiceClient } from "../services/supabase";

/**
 * Daily owner digest — fires 21:00 UTC = 07:00 AEST.
 *
 * For each active agency, aggregate notification_log rows with
 * `status='queued' and scheduled_for <= now`, group by owner_id, send one
 * combined email per owner, and mark the rows `sent` so the next run
 * doesn't re-send them.
 *
 * Idempotent because the query filters on `status='queued'`. If Resend fails
 * for a particular owner the rows stay queued and the next run retries.
 */

export interface OwnerDigestResult {
  agenciesInspected: number;
  ownersDigested: number;
  rowsMarkedSent: number;
  failures: number;
}

export async function runOwnerDigest(
  env: WorkerBindings,
  log: Logger,
  now: Date = new Date(),
): Promise<OwnerDigestResult> {
  const supabase = createServiceClient(env);

  // Scan active agencies once. Pulling queued rows per-agency keeps the
  // dataset small and audit-friendly even at scale.
  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, name")
    .eq("status", "active");
  if (error) {
    throw new Error(`owner digest: agencies scan failed: ${error.message}`);
  }

  let ownersDigested = 0;
  let rowsMarkedSent = 0;
  let failures = 0;

  for (const agency of agencies ?? []) {
    const agencyLog = log.child({ agency_id: agency.id });
    try {
      const r = await processAgency(supabase, env, agency.id, agency.name, now, agencyLog);
      ownersDigested += r.ownersDigested;
      rowsMarkedSent += r.rowsMarkedSent;
      failures += r.failures;
    } catch (err) {
      failures += 1;
      agencyLog.error("owner digest: per-agency failure", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    agenciesInspected: agencies?.length ?? 0,
    ownersDigested,
    rowsMarkedSent,
    failures,
  };
}

interface QueuedRow {
  id: string;
  owner_id: string | null;
  property_id: string | null;
  body: string | null;
  triggered_by_draft_id: string | null;
  scheduled_for: string | null;
}

async function processAgency(
  client: Client,
  env: WorkerBindings,
  agencyId: string,
  agencyName: string,
  now: Date,
  log: Logger,
): Promise<{ ownersDigested: number; rowsMarkedSent: number; failures: number }> {
  const { data: rows, error } = await client
    .from("notification_log")
    .select("id, owner_id, property_id, body, triggered_by_draft_id, scheduled_for")
    .eq("agency_id", agencyId)
    .eq("channel", "digest")
    .eq("status", "queued")
    .lte("scheduled_for", now.toISOString());
  if (error) {
    throw new Error(`notification_log scan failed: ${error.message}`);
  }
  const queued = (rows ?? []) as QueuedRow[];
  if (queued.length === 0) {
    return { ownersDigested: 0, rowsMarkedSent: 0, failures: 0 };
  }

  // Group by owner
  const byOwner = new Map<string, QueuedRow[]>();
  for (const r of queued) {
    if (!r.owner_id) continue; // shouldn't happen for digest rows but be defensive
    const key = r.owner_id;
    const list = byOwner.get(key) ?? [];
    list.push(r);
    byOwner.set(key, list);
  }

  let ownersDigested = 0;
  let rowsMarkedSent = 0;
  let failures = 0;

  for (const [ownerId, ownerRows] of byOwner) {
    try {
      const { data: owner } = await client
        .from("owners")
        .select("id, full_name, email")
        .eq("agency_id", agencyId)
        .eq("id", ownerId)
        .maybeSingle();
      if (!owner?.email) {
        log.warn("owner digest: skip owner (no email)", { owner_id: ownerId });
        continue;
      }

      const { subject, text } = composeDigest(agencyName, owner.full_name, ownerRows);
      await sendEmail(
        { from: env.RESEND_FROM_EMAIL, to: owner.email, subject, text },
        { apiKey: env.RESEND_API_KEY },
      );

      const ids = ownerRows.map((r) => r.id);
      const sentAt = now.toISOString();
      const { error: updErr } = await client
        .from("notification_log")
        .update({ status: "sent", sent_at: sentAt })
        .eq("agency_id", agencyId)
        .in("id", ids);
      if (updErr) {
        // Email already sent — but we couldn't flip the rows to sent. Next
        // run will re-send. Log loud so we can spot the duplication if it
        // happens repeatedly.
        log.error("owner digest: failed to mark rows sent after email succeeded", {
          owner_id: ownerId,
          row_ids: ids,
          error: updErr.message,
        });
        failures += 1;
        continue;
      }
      ownersDigested += 1;
      rowsMarkedSent += ids.length;
      log.info("owner digest sent", { owner_id: ownerId, row_count: ids.length });
    } catch (err) {
      failures += 1;
      log.error("owner digest: per-owner failure", {
        owner_id: ownerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ownersDigested, rowsMarkedSent, failures };
}

function composeDigest(
  agencyName: string,
  ownerName: string,
  rows: QueuedRow[],
): { subject: string; text: string } {
  const firstName = ownerName.split(/\s+/)[0] ?? ownerName;
  const subject =
    rows.length === 1
      ? `${agencyName} property update`
      : `${agencyName} property update — ${rows.length} items`;
  const itemLines = rows.map((r, i) => {
    const body = (r.body ?? "(no detail recorded)").split("\n").slice(0, 4).join("\n");
    return `${i + 1}. ${body}`;
  });
  const text = [
    `Hi ${firstName},`,
    "",
    `Daily digest from ${agencyName}. The following items came in for properties under your ownership; your property manager has reviewed each.`,
    "",
    ...itemLines,
    "",
    "Reply to this email if you'd like the PM to follow up on any specific item.",
    "",
    `Kind regards,`,
    agencyName,
  ].join("\n");
  return { subject, text };
}

/**
 * Cron handler for the daily owner digest trigger (`0 21 * * *` UTC).
 */
export async function handleOwnerDigest(
  controller: ScheduledController,
  env: WorkerBindings,
): Promise<void> {
  const log = createLogger({
    base: { request_id: crypto.randomUUID(), cron: controller.cron },
  });
  log.info("cron tick: owner digest", {
    scheduled_time: new Date(controller.scheduledTime).toISOString(),
  });
  try {
    const result = await runOwnerDigest(env, log, new Date(controller.scheduledTime));
    log.info("cron tick complete", { ...result });
  } catch (err) {
    log.error("cron tick failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
