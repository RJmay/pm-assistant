import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  confidenceLabel,
  escalationVariant,
  matchVariant,
  priorityLabel,
  priorityVariant,
  relativeTime,
  senderName,
} from "./format";

const NOW = new Date("2026-05-29T12:00:00Z");

describe("relativeTime", () => {
  it("returns em-dash for null / invalid input", () => {
    expect(relativeTime(null, NOW)).toBe("—");
    expect(relativeTime("not-a-date", NOW)).toBe("—");
  });

  it("renders coarse buckets", () => {
    expect(relativeTime("2026-05-29T11:59:30Z", NOW)).toBe("just now");
    expect(relativeTime("2026-05-29T11:30:00Z", NOW)).toBe("30m ago");
    expect(relativeTime("2026-05-29T09:00:00Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-05-27T12:00:00Z", NOW)).toBe("2d ago");
    expect(relativeTime("2026-05-08T12:00:00Z", NOW)).toBe("3w ago");
  });
});

describe("label + variant maps", () => {
  it("maps priority to label + badge variant", () => {
    expect(priorityLabel("EMERGENCY_ALERT")).toBe("Emergency");
    expect(priorityVariant("EMERGENCY_ALERT")).toBe("destructive");
    expect(priorityVariant("STANDARD")).toBe("secondary");
  });

  it("maps category labels", () => {
    expect(categoryLabel("MAINTENANCE")).toBe("Maintenance");
    expect(categoryLabel("OTHER")).toBe("Other");
  });

  it("escalation variant is destructive unless NONE", () => {
    expect(escalationVariant("NONE")).toBe("secondary");
    expect(escalationVariant("LEGAL")).toBe("destructive");
  });

  it("match variant: high=secondary, none=destructive, else outline", () => {
    expect(matchVariant("high")).toBe("secondary");
    expect(matchVariant("none")).toBe("destructive");
    expect(matchVariant("medium")).toBe("outline");
  });

  it("title-cases confidence", () => {
    expect(confidenceLabel("HIGH")).toBe("High");
    expect(confidenceLabel("LOW")).toBe("Low");
  });
});

describe("senderName", () => {
  it("prefers the display name, falls back to address", () => {
    expect(senderName("Alex Tan", "alex@example.com")).toBe("Alex Tan");
    expect(senderName(null, "alex@example.com")).toBe("alex@example.com");
    expect(senderName("   ", "alex@example.com")).toBe("alex@example.com");
  });
});
