import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  confidenceLabel,
  draftStatusLabel,
  draftStatusVariant,
  escalationVariant,
  formatDate,
  formatMoney,
  jobStateLabel,
  matchVariant,
  ownerApprovalLabel,
  priorityLabel,
  priorityVariant,
  relativeTime,
  rentLabel,
  senderName,
  tenancyStatusLabel,
  tenancyStatusVariant,
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

  it("renders future times as 'in …' instead of 'just now'", () => {
    expect(relativeTime("2026-05-29T12:30:00Z", NOW)).toBe("in 30m");
    expect(relativeTime("2026-05-31T12:00:00Z", NOW)).toBe("in 2d");
    expect(relativeTime("2026-05-29T12:00:10Z", NOW)).toBe("just now");
  });
});

describe("formatDate / formatMoney / rentLabel", () => {
  it("formats date-only strings without timezone drift", () => {
    expect(formatDate("2026-06-08")).toBe("8 Jun 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("nope")).toBe("—");
  });

  it("formats cents as whole dollars, keeping cents only when present", () => {
    expect(formatMoney(60000)).toBe("$600");
    expect(formatMoney(61250)).toBe("$612.50");
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(null)).toBe("—");
  });

  it("appends the rent-frequency suffix", () => {
    expect(rentLabel(60000, "weekly")).toBe("$600/wk");
    expect(rentLabel(120000, "fortnightly")).toBe("$1,200/fn");
    expect(rentLabel(60000, null)).toBe("$600");
    expect(rentLabel(null, "weekly")).toBe("—");
  });
});

describe("rent-roll + status label maps", () => {
  it("maps draft status to label + variant", () => {
    expect(draftStatusLabel("edited")).toBe("Edited");
    expect(draftStatusVariant("sent")).toBe("secondary");
    expect(draftStatusVariant("do_not_send")).toBe("destructive");
  });

  it("maps tenancy status", () => {
    expect(tenancyStatusLabel("active")).toBe("Active");
    expect(tenancyStatusVariant("active")).toBe("secondary");
    expect(tenancyStatusVariant("ended")).toBe("outline");
  });

  it("maps maintenance enums to English", () => {
    expect(jobStateLabel("awaiting_owner_approval")).toBe("Awaiting owner approval");
    expect(ownerApprovalLabel("not_required")).toBe("Not required");
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
