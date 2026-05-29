import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import type { QueueItem } from "$lib/types";
import DraftRow from "./DraftRow.svelte";

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "draft-1",
    category: "MAINTENANCE",
    priority: "STANDARD",
    escalation_flag: "NONE",
    emergency_landlord_alert: false,
    safety_critical: false,
    do_not_send: false,
    draft_confidence: "HIGH",
    match_confidence: "high",
    status: "pending",
    assigned_pm_id: null,
    draft_subject: null,
    created_at: "2026-05-29T00:00:00Z",
    from_name: "Alex Tan",
    from_address: "alex@example.com",
    subject: "Kitchen tap is dripping",
    received_at: "2026-05-29T00:00:00Z",
    ...overrides,
  };
}

describe("DraftRow", () => {
  it("links to the draft detail and shows subject + sender + priority", () => {
    const { container } = render(DraftRow, { props: { item: item() } });
    expect(screen.getByText("Kitchen tap is dripping")).toBeInTheDocument();
    expect(screen.getByText("Alex Tan")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/queue/draft-1");
  });

  it("shows the escalation badge only when escalated", () => {
    render(DraftRow, { props: { item: item({ escalation_flag: "LEGAL" }) } });
    expect(screen.getByText("Legal")).toBeInTheDocument();
  });

  it("surfaces safety-critical and do-not-send indicators", () => {
    render(DraftRow, {
      props: { item: item({ safety_critical: true, do_not_send: true }) },
    });
    expect(screen.getByText("Safety")).toBeInTheDocument();
    expect(screen.getByText("Do not send")).toBeInTheDocument();
  });

  it("falls back to the draft subject when the inbound subject is missing", () => {
    render(DraftRow, {
      props: { item: item({ subject: null, draft_subject: "Re: your enquiry" }) },
    });
    expect(screen.getByText("Re: your enquiry")).toBeInTheDocument();
  });
});
