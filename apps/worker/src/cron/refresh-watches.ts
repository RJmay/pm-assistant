import type { WorkerBindings } from "../lib/env";
import { createLogger, type Logger } from "../lib/log";
import { refreshAccessToken, usersWatch } from "../services/gmail";
import { createServiceClient } from "../services/supabase";
import { getGmailRefreshToken } from "../services/vault";

/**
 * Refresh Gmail watch subscriptions that are nearing expiry. Gmail's
 * `users.watch` expires every 7 days; we refresh anything within 48h of
 * expiry (or already expired) so the push pipeline never goes dark.
 *
 * Idempotent: re-running this within the window picks up the same rows and
 * extends them again — no harm beyond a few extra API calls.
 *
 * Returns a summary so the scheduled handler can log counts.
 */
export interface RefreshWatchesResult {
  inspected: number;
  refreshed: number;
  failed: number;
}

export async function refreshExpiringWatches(
  env: WorkerBindings,
  log: Logger,
  now: Date = new Date(),
): Promise<RefreshWatchesResult> {
  const supabase = createServiceClient(env);

  // Window: refresh anything expiring within the next 48h (plus rows where
  // the column is null, which means we don't know when it expires and should
  // re-establish the watch just to be safe).
  const cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("agency_email_state")
    .select("agency_id, mailbox_address, watch_expires_at")
    .or(`watch_expires_at.lte.${cutoff},watch_expires_at.is.null`);

  if (error) {
    log.error("agency_email_state scan for watch refresh failed", { error: error.message });
    throw new Error(`agency_email_state scan failed: ${error.message}`);
  }

  const inspected = rows?.length ?? 0;
  let refreshed = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    const child = log.child({ agency_id: row.agency_id });
    try {
      const refreshToken = await getGmailRefreshToken(supabase, row.agency_id);
      if (!refreshToken) {
        child.warn("watch refresh skipped: no vault token");
        failed += 1;
        continue;
      }

      const tokens = await refreshAccessToken({
        refreshToken,
        clientId: env.GMAIL_OAUTH_CLIENT_ID,
        clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET,
      });

      const watch = await usersWatch({
        accessToken: tokens.access_token,
        mailbox: "me",
        topicName: env.PUBSUB_TOPIC,
      });

      const expiresMs = Number.parseInt(watch.expiration, 10);
      const watchExpiresAt = Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : null;

      const { error: updErr } = await supabase
        .from("agency_email_state")
        .update({ watch_expires_at: watchExpiresAt })
        .eq("agency_id", row.agency_id);
      if (updErr) {
        child.error("agency_email_state update after watch refresh failed", {
          error: updErr.message,
        });
        failed += 1;
        continue;
      }

      child.info("gmail watch refreshed", {
        mailbox_address: row.mailbox_address,
        watch_expires_at: watchExpiresAt,
      });
      refreshed += 1;
    } catch (err) {
      // Per-agency failures must not tank the whole batch — log and continue.
      child.error("gmail watch refresh failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      failed += 1;
    }
  }

  return { inspected, refreshed, failed };
}

/**
 * Top-level scheduled handler exported via `default` in src/index.ts. Wraps
 * `refreshExpiringWatches` with a request_id + structured logging.
 *
 * Signature matches Cloudflare's `ExportedHandlerScheduledHandler`: the first
 * argument is a `ScheduledController` (not the browser-style ScheduledEvent).
 */
export async function handleScheduled(
  controller: ScheduledController,
  env: WorkerBindings,
  _ctx: ExecutionContext,
): Promise<void> {
  const log = createLogger({
    base: { request_id: crypto.randomUUID(), cron: controller.cron },
  });
  log.info("cron tick: refresh gmail watches", {
    scheduled_time: new Date(controller.scheduledTime).toISOString(),
  });
  try {
    const result = await refreshExpiringWatches(env, log);
    log.info("cron tick complete", { ...result });
  } catch (err) {
    log.error("cron tick failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
