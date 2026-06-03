import { describe, expect, it } from "vitest";
import {
  buildGeneralAck,
  buildStatusReply,
  classifyInboundSms,
} from "../src/services/sms-classify";

describe("classifyInboundSms", () => {
  it("flags escalation FIRST, independent of intent", () => {
    const c = classifyInboundSms("I'm going to QCAT about this and my lawyer will call");
    expect(c.intent).toBe("escalation");
    expect(c.escalationFlag).toBe("LEGAL");
  });

  it("escalates a welfare case even if it reads like a status query", () => {
    const c = classifyInboundSms("any update? honestly I don't want to live like this");
    expect(c.intent).toBe("escalation");
    expect(c.escalationFlag).toBe("WELFARE");
  });

  it("detects a routine status query", () => {
    expect(classifyInboundSms("Hi any update on my repair?").intent).toBe("status_query");
    expect(classifyInboundSms("when will the plumber come").intent).toBe("status_query");
  });

  it("detects a maintenance report", () => {
    expect(classifyInboundSms("the hot water is not working").intent).toBe("maintenance");
  });

  it("falls back to general", () => {
    expect(classifyInboundSms("thanks heaps, appreciate it").intent).toBe("general");
  });
});

describe("reply drafting", () => {
  it("draws a status reply from the open job", () => {
    const r = buildStatusReply({
      firstName: "Alex",
      agencyName: "Sunshine Coast Test Agency",
      job: { trade: "plumbing", state: "scheduled", scheduledFor: "2026-06-12T00:00:00Z" },
    });
    expect(r).toContain("Hi Alex,");
    expect(r).toContain("plumbing");
    expect(r).toContain("scheduled");
    expect(r).toContain("2026-06-12");
    expect(r).toContain("Sunshine Coast Test Agency");
  });

  it("gives a holding reply when there's no open job", () => {
    const r = buildStatusReply({ firstName: null, agencyName: "X", job: null });
    expect(r).toContain("don't have an open job");
  });

  it("builds a general acknowledgement", () => {
    expect(buildGeneralAck("Sam", "X")).toContain("a property manager will be in touch");
  });
});
