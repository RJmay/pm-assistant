// ============================================================================
// Per-source hash + content snapshot store for the monitoring bot (spec §12)
// ============================================================================
// The scan needs to remember each source's last-seen state to diff against.
// Backed by Workers KV in production; the interface keeps scan.ts testable with
// an in-memory fake. We store the content snapshot (not just the hash) so the
// LLM gets a real previous-vs-current diff on a change.
// ============================================================================

export interface SourceSnapshot {
  hash: string;
  content: string;
}

export interface MonitoringStore {
  get(key: string): Promise<SourceSnapshot | null>;
  set(key: string, value: SourceSnapshot): Promise<void>;
}

/** KV-backed store (keys namespaced under `src:`). */
export function kvMonitoringStore(kv: KVNamespace): MonitoringStore {
  return {
    async get(key) {
      return (await kv.get(`src:${key}`, "json")) as SourceSnapshot | null;
    },
    async set(key, value) {
      await kv.put(`src:${key}`, JSON.stringify(value));
    },
  };
}
