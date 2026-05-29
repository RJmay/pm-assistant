import { describe, expect, it } from "vitest";
import { diffStats, lineDiff } from "./prompt-diff";

describe("lineDiff", () => {
  it("marks every line same when unchanged", () => {
    const lines = lineDiff("a\nb\nc", "a\nb\nc");
    expect(lines.every((l) => l.type === "same")).toBe(true);
    expect(lines).toHaveLength(3);
  });

  it("detects a pure insertion", () => {
    const lines = lineDiff("a\nc", "a\nb\nc");
    expect(lines).toEqual([
      { type: "same", text: "a" },
      { type: "add", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("detects a pure deletion", () => {
    const lines = lineDiff("a\nb\nc", "a\nc");
    expect(lines).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("represents a replacement as a delete + add", () => {
    const lines = lineDiff("hello\nworld", "hello\nthere");
    expect(lines).toContainEqual({ type: "del", text: "world" });
    expect(lines).toContainEqual({ type: "add", text: "there" });
    expect(lines[0]).toEqual({ type: "same", text: "hello" });
  });

  it("handles empty inputs", () => {
    expect(lineDiff("", "")).toEqual([{ type: "same", text: "" }]);
    expect(diffStats(lineDiff("a\nb", ""))).toEqual({ added: 1, removed: 2 });
  });
});

describe("diffStats", () => {
  it("counts adds and removes", () => {
    const stats = diffStats(lineDiff("a\nb\nc", "a\nx\nc\nd"));
    expect(stats.added).toBe(2); // x, d
    expect(stats.removed).toBe(1); // b
  });
});
