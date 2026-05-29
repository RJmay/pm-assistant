import type { Client, Json } from "@pm/db";
import type { Logger } from "../../lib/log";
import { extractText } from "./html-text";
import type { MonitoringStore } from "./kv-store";
import { detectChange } from "./source-diff";
import { MONITORED_SOURCES, type MonitoredSource } from "./sources";
import { summarizeRegulatoryChange } from "./summarize";

// ============================================================================
// Regulatory monitoring scan orchestrator (spec §12)
// ============================================================================
// For each monitored source: fetch → extract text → diff vs the stored hash.
//   - First-ever scan (no stored hash): capture a BASELINE, no alert.
//   - Unchanged: nothing.
//   - Changed: summarise (LLM, once) + write a regulatory_alerts row, THEN
//     store the new hash. (Storing the hash last means a failed summary/insert
//     is retried next scan rather than silently lost.)
// Per-source failures are logged and the batch continues. Nothing here ever
// touches live regulatory_rules — that's the operator-approval flow.
// ============================================================================

const MAX_CONTENT_CHARS = 16000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ScanDeps {
  supabase: Client;
  store: MonitoringStore;
  anthropicApiKey: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  summarize?: typeof summarizeRegulatoryChange;
  sources?: readonly MonitoredSource[];
}

export interface ScanResult {
  scanned: number;
  baselined: number;
  changed: number;
  alerted: number;
  errors: number;
}

function toDateOrNull(value: string | null): string | null {
  return value && ISO_DATE.test(value) ? value : null;
}

export async function scanRegulatorySources(deps: ScanDeps): Promise<ScanResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const summarizeFn = deps.summarize ?? summarizeRegulatoryChange;
  const sources = deps.sources ?? MONITORED_SOURCES;
  const result: ScanResult = { scanned: 0, baselined: 0, changed: 0, alerted: 0, errors: 0 };

  for (const source of sources) {
    const log = deps.logger.child({ source: source.key });
    try {
      result.scanned += 1;
      const res = await fetchImpl(source.url, {
        headers: { "User-Agent": "pm-assistant-monitor/1.0" },
      });
      if (!res.ok) {
        log.warn("source fetch returned non-2xx", { status: res.status });
        result.errors += 1;
        continue;
      }
      const text = extractText(await res.text()).slice(0, MAX_CONTENT_CHARS);
      const prev = await deps.store.get(source.key);
      const { changed, newHash, normalized } = detectChange(prev?.hash ?? null, text);

      if (!changed) continue;

      if (prev === null) {
        // First scan — capture the baseline, don't alert.
        await deps.store.set(source.key, { hash: newHash, content: normalized });
        result.baselined += 1;
        continue;
      }

      result.changed += 1;
      const assessment = await summarizeFn(
        { source, previousText: prev.content, currentText: normalized },
        { apiKey: deps.anthropicApiKey },
      );

      const { error } = await deps.supabase.from("regulatory_alerts").insert({
        source: source.key,
        source_url: source.url,
        content_hash: newHash,
        change_summary: assessment.change_summary,
        effective_date: toDateOrNull(assessment.effective_date),
        affected_modules: assessment.affected_modules,
        proposed_changes: assessment.proposed_changes as unknown as Json,
      });
      if (error) {
        log.error("regulatory_alerts insert failed", { error: error.message });
        result.errors += 1;
        continue; // leave the hash unstored so it retries next scan
      }

      await deps.store.set(source.key, { hash: newHash, content: normalized });
      result.alerted += 1;
      log.info("regulatory change alerted", {
        effective_date: assessment.effective_date,
        affected_modules: assessment.affected_modules,
      });
    } catch (err) {
      log.error("source scan failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      result.errors += 1;
    }
  }

  deps.logger.info("regulatory scan complete", { ...result });
  return result;
}
