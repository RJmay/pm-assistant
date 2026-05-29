import { describe, expect, it } from "vitest";
import {
  contentHash,
  detectChange,
  normalizeForDiff,
} from "../src/services/monitoring/source-diff";

describe("normalizeForDiff", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeForDiff("  the   quick\n\nbrown \t fox  ")).toBe("the quick brown fox");
  });
});

describe("contentHash", () => {
  it("is deterministic", () => {
    expect(contentHash("entry notice period is 7 days")).toBe(
      contentHash("entry notice period is 7 days"),
    );
  });

  it("ignores whitespace-only differences (hashes the normalised text)", () => {
    expect(contentHash("7 days\nnotice")).toBe(contentHash("  7 days   notice  "));
  });

  it("changes when the meaningful content changes", () => {
    expect(contentHash("notice period is 7 days")).not.toBe(
      contentHash("notice period is 14 days"),
    );
  });
});

describe("detectChange", () => {
  it("treats a null previous hash (first scan) as a change", () => {
    const r = detectChange(null, "some page content");
    expect(r.changed).toBe(true);
    expect(r.newHash).toBe(contentHash("some page content"));
  });

  it("reports no change when content is the same", () => {
    const content = "Routine inspections: 7 days notice, once every 3 months.";
    const first = detectChange(null, content);
    const second = detectChange(first.newHash, content);
    expect(second.changed).toBe(false);
  });

  it("reports a change when content differs", () => {
    const prev = contentHash("once every 3 months");
    const r = detectChange(prev, "once every 6 months");
    expect(r.changed).toBe(true);
    expect(r.normalized).toBe("once every 6 months");
  });

  it("ignores reformatting (no false positive)", () => {
    const prev = contentHash("Entry notice 7 days");
    const r = detectChange(prev, "  Entry   notice\n7 days ");
    expect(r.changed).toBe(false);
  });
});
