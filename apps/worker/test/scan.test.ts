import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createLogger } from "../src/lib/log";
import { extractText } from "../src/services/monitoring/html-text";
import type { MonitoringStore, SourceSnapshot } from "../src/services/monitoring/kv-store";
import { type ScanDeps, scanRegulatorySources } from "../src/services/monitoring/scan";
import { contentHash } from "../src/services/monitoring/source-diff";
import type { MonitoredSource } from "../src/services/monitoring/sources";

const SOURCES: MonitoredSource[] = [
  { key: "src-a", name: "Source A", url: "https://example.test/a", priority: 1 },
];

const ASSESSMENT = {
  change_summary: "Routine-inspection notice extended to 14 days.",
  effective_date: "2026-09-01",
  affected_modules: ["entry_notice_routine"],
  proposed_changes: [
    { module: "entry_notice_routine", description: "routineInspectionNoticeDays 7 -> 14" },
  ],
};

const silentLog = createLogger({ level: "error" });

let inserts: Array<Record<string, unknown>>;
let insertError: { message: string } | null;
let store: MonitoringStore & { data: Map<string, SourceSnapshot> };
let fetchMock: Mock;
let summarizeMock: Mock;

function memStore(initial: Record<string, SourceSnapshot> = {}) {
  const data = new Map<string, SourceSnapshot>(Object.entries(initial));
  return {
    data,
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: SourceSnapshot) => {
      data.set(k, v);
    },
  };
}

function htmlResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as unknown as Response;
}

function fakeSupabase(): Client {
  return {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: insertError };
      },
    }),
    // biome-ignore lint/suspicious/noExplicitAny: only the insert shape is used
  } as any;
}

function deps(over: Partial<ScanDeps> = {}): ScanDeps {
  return {
    supabase: fakeSupabase(),
    store,
    anthropicApiKey: "sk-ant-test",
    logger: silentLog,
    fetchImpl: fetchMock as unknown as typeof fetch,
    summarize: summarizeMock as unknown as ScanDeps["summarize"],
    sources: SOURCES,
    ...over,
  };
}

beforeEach(() => {
  inserts = [];
  insertError = null;
  store = memStore();
  fetchMock = vi.fn(async () => htmlResponse("<p>baseline content</p>"));
  summarizeMock = vi.fn(async () => ASSESSMENT);
});

describe("scanRegulatorySources", () => {
  it("captures a baseline on first scan without alerting", async () => {
    const result = await scanRegulatorySources(deps());
    expect(result).toMatchObject({ scanned: 1, baselined: 1, changed: 0, alerted: 0, errors: 0 });
    expect(store.data.get("src-a")).toBeTruthy();
    expect(inserts).toHaveLength(0);
    expect(summarizeMock).not.toHaveBeenCalled();
  });

  it("does nothing when the source is unchanged", async () => {
    const text = extractText("<p>baseline content</p>");
    store = memStore({ "src-a": { hash: contentHash(text), content: text } });
    const result = await scanRegulatorySources(deps());
    expect(result).toMatchObject({ changed: 0, alerted: 0, baselined: 0 });
    expect(inserts).toHaveLength(0);
  });

  it("on a change: summarises + writes an alert with the proposed diff, then stores the new hash", async () => {
    store = memStore({ "src-a": { hash: "old-hash", content: "old content" } });
    fetchMock = vi.fn(async () =>
      htmlResponse("<p>Routine inspections now need 14 days notice.</p>"),
    );

    const result = await scanRegulatorySources(deps());
    expect(result).toMatchObject({ changed: 1, alerted: 1, errors: 0 });

    expect(summarizeMock).toHaveBeenCalledTimes(1);
    expect(summarizeMock.mock.calls[0]?.[0]).toMatchObject({ previousText: "old content" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      source: "src-a",
      source_url: "https://example.test/a",
      change_summary: ASSESSMENT.change_summary,
      effective_date: "2026-09-01",
      affected_modules: ["entry_notice_routine"],
      proposed_changes: ASSESSMENT.proposed_changes,
    });

    // hash advanced so the next scan won't re-alert
    expect(store.data.get("src-a")?.hash).not.toBe("old-hash");
  });

  it("coerces a non-ISO effective_date to null", async () => {
    store = memStore({ "src-a": { hash: "old-hash", content: "old" } });
    fetchMock = vi.fn(async () => htmlResponse("<p>changed</p>"));
    summarizeMock = vi.fn(async () => ({ ...ASSESSMENT, effective_date: "soon" }));
    await scanRegulatorySources(deps());
    expect(inserts[0]?.effective_date).toBeNull();
  });

  it("counts a fetch error and skips the source (no alert)", async () => {
    store = memStore({ "src-a": { hash: "old-hash", content: "old" } });
    fetchMock = vi.fn(async () => htmlResponse("err", false, 503));
    const result = await scanRegulatorySources(deps());
    expect(result).toMatchObject({ errors: 1, alerted: 0 });
    expect(summarizeMock).not.toHaveBeenCalled();
  });

  it("does not advance the hash when the alert insert fails (so it retries)", async () => {
    store = memStore({ "src-a": { hash: "old-hash", content: "old" } });
    fetchMock = vi.fn(async () => htmlResponse("<p>changed content</p>"));
    insertError = { message: "db down" };
    const result = await scanRegulatorySources(deps());
    expect(result).toMatchObject({ changed: 1, alerted: 0, errors: 1 });
    expect(store.data.get("src-a")?.hash).toBe("old-hash"); // unchanged → retried next scan
  });

  it("continues the batch when summarise throws", async () => {
    store = memStore({ "src-a": { hash: "old-hash", content: "old" } });
    fetchMock = vi.fn(async () => htmlResponse("<p>changed</p>"));
    summarizeMock = vi.fn(async () => {
      throw new Error("anthropic 500");
    });
    const result = await scanRegulatorySources(deps());
    expect(result).toMatchObject({ alerted: 0, errors: 1 });
    expect(inserts).toHaveLength(0);
    expect(store.data.get("src-a")?.hash).toBe("old-hash");
  });
});
