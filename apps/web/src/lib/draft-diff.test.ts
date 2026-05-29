import { describe, expect, it } from "vitest";
import { computeDraftDiff } from "./draft-diff";

describe("computeDraftDiff", () => {
  it("returns null when nothing changed", () => {
    expect(
      computeDraftDiff({ subject: "Hi", body: "Body" }, { subject: "Hi", body: "Body" }),
    ).toBeNull();
  });

  it("treats null and empty string as equal, and ignores surrounding whitespace", () => {
    expect(computeDraftDiff({ subject: null, body: "x" }, { subject: "", body: "x" })).toBeNull();
    expect(
      computeDraftDiff({ subject: "Hi", body: "Body" }, { subject: "  Hi  ", body: "Body\n" }),
    ).toBeNull();
  });

  it("flags a subject-only change", () => {
    const diff = computeDraftDiff(
      { subject: "Old", body: "Same" },
      { subject: "New", body: "Same" },
    );
    expect(diff).not.toBeNull();
    expect(diff?.subjectChanged).toBe(true);
    expect(diff?.bodyChanged).toBe(false);
    expect(diff?.previous_subject).toBe("Old");
    expect(diff?.new_subject).toBe("New");
  });

  it("flags a body-only change and preserves both values verbatim", () => {
    const diff = computeDraftDiff(
      { subject: "Same", body: "Old body" },
      { subject: "Same", body: "New body" },
    );
    expect(diff?.bodyChanged).toBe(true);
    expect(diff?.subjectChanged).toBe(false);
    expect(diff?.previous_body).toBe("Old body");
    expect(diff?.new_body).toBe("New body");
  });

  it("flags both when both change", () => {
    const diff = computeDraftDiff({ subject: "A", body: "B" }, { subject: "C", body: "D" });
    expect(diff?.subjectChanged).toBe(true);
    expect(diff?.bodyChanged).toBe(true);
  });
});
