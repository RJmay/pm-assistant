import type { WorkerBindings } from "../lib/env";
import { createLogger } from "../lib/log";
import { kvMonitoringStore } from "../services/monitoring/kv-store";
import { scanRegulatorySources } from "../services/monitoring/scan";
import { createServiceClient } from "../services/supabase";

/**
 * Daily regulatory monitoring scan (spec §12). Hash-and-diffs the monitored
 * QLD sources and raises a `regulatory_alerts` row on a detected change.
 * Self-contained + idempotent: the per-source hash store dedupes, so re-runs
 * don't re-alert an unchanged source.
 */
export async function handleRegulatoryScan(
  _controller: ScheduledController,
  env: WorkerBindings,
): Promise<void> {
  const log = createLogger({ base: { request_id: crypto.randomUUID() } });
  const supabase = createServiceClient(env);
  const store = kvMonitoringStore(env.MONITORING_CACHE);
  await scanRegulatorySources({
    supabase,
    store,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    logger: log,
  });
}
