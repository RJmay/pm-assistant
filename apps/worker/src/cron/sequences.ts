import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import { runArrearsScan } from "./arrears";
import { runInspectionScan } from "./inspection";
import { runLeaseRenewalScan } from "./lease-renewal";
import { runQuoteChaserScan } from "./maintenance-chasers";
import { runOwnerUpdateScan } from "./owner-update";

// ============================================================================
// Daily outbound-sequence sweep (Phase 2, spec §8)
// ============================================================================
// All four sequence scanners run under ONE daily cron rather than four, to keep
// the Worker's cron-trigger count low (Cloudflare caps triggers per Worker) and
// to give a single, ordered entry point. Each scanner is independent and
// idempotent (one run per cycle, unique on sequence_runs.dedupe_key), so:
//   - running them together is safe, and
//   - owner-update (logically monthly) self-gates: run daily it produces a
//     month-end summary only once per calendar month and is a no-op otherwise.
// A failure in one scanner is logged and does not stop the others.
// ============================================================================

export async function handleDailySequences(
  controller: ScheduledController,
  env: WorkerBindings,
): Promise<void> {
  const log = createLogger({
    base: { request_id: crypto.randomUUID(), cron: controller.cron },
  });
  const now = new Date(controller.scheduledTime);
  log.info("cron tick: daily sequences", { scheduled_time: now.toISOString() });

  const scanners: Array<[string, () => Promise<unknown>]> = [
    ["lease_renewal", () => runLeaseRenewalScan(env, log, now)],
    ["inspection", () => runInspectionScan(env, log, now)],
    ["arrears", () => runArrearsScan(env, log, now)],
    ["owner_update", () => runOwnerUpdateScan(env, log, now)],
    ["quote_chaser", () => runQuoteChaserScan(env, log, now)],
  ];

  for (const [name, run] of scanners) {
    try {
      const result = await run();
      log.info("sequence scan complete", { sequence: name, ...(result as object) });
    } catch (err) {
      log.error("sequence scan failed (continuing)", {
        sequence: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
