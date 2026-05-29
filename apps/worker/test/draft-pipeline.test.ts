import type { Client } from "@pm/db";
import type { DraftSubmission } from "@pm/prompts";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("../src/services/supabase", () => ({
  writeAuditLog: vi.fn(async () => undefined),
}));

import { createLogger } from "../src/lib/log";
import {
  type DraftPipelineDeps,
  type DraftPipelineInput,
  runDraftPipeline,
} from "../src/services/draft-pipeline";
import type { MatchResult } from "../src/services/matcher";
import type { NotifyResult } from "../src/services/notifier";
import { writeAuditLog } from "../src/services/supabase";

const writeAuditLogMock = writeAuditLog as Mock;

// ----------------------------------------------------------------------------
// Hand-rolled supabase mock — only the call shapes the pipeline uses.
// ----------------------------------------------------------------------------

interface ThreadState {
  property_id: string | null;
  property_match_confidence: "high" | "medium" | "low" | "none";
}

interface MockState {
  agency: Record<string, unknown> | null;
  agencyConfig: Record<string, unknown> | null;
  prompt: { id: string; content: string } | null;
  pms: Array<Record<string, unknown>>;
  thread: ThreadState | null;
  draftInsertResult: { data: { id: string } | null; error: { message: string } | null };
  modelCallInsertError: { message: string } | null;
  // Recorded calls for assertions
  threadUpdates: Array<Record<string, unknown>>;
  draftInserts: Array<Record<string, unknown>>;
  modelCallInserts: Array<Record<string, unknown>>;
}

let state: MockState;

function reset() {
  state = {
    agency: {
      id: "agency-aaa",
      name: "Sunshine Coast Test Agency",
      suburb: "Mooloolaba",
      business_hours: "Mon-Fri 9am-5pm AEST",
      after_hours_emergency_line: "+61 7 5555 1111",
      principal_email: "casey@example.com",
    },
    agencyConfig: {
      agency_id: "agency-aaa",
      voice_samples: [],
      approved_tradies: [],
      nominated_repairer: { name: "Coast Plumbing Co", number: "+61 400 555 001" },
      routine_approval_threshold_cents: 25000,
      written_quote_threshold_cents: 50000,
      per_owner_quote_exceptions: [],
      house_rules: null,
      lean_notes: [],
    },
    prompt: { id: "prompt-v22", content: BASE_PROMPT_STUB },
    pms: [{ full_name: "Jess Bowman", email: "jess@example.com" }],
    thread: { property_id: null, property_match_confidence: "none" },
    draftInsertResult: { data: { id: "draft-1" }, error: null },
    modelCallInsertError: null,
    threadUpdates: [],
    draftInserts: [],
    modelCallInserts: [],
  };
}

const BASE_PROMPT_STUB = `# Stub prompt for tests
Agency: [AGENCY_NAME]
[NOMINATED_REPAIRER]
[VOICE_SAMPLES]
[APPROVED_TRADIES]
[SPENDING_THRESHOLD]
[WRITTEN_QUOTE_THRESHOLD]
[PER_OWNER_QUOTE_EXCEPTIONS]
[HOUSE_RULES]
[PMS]
[SUBURB]
[BUSINESS_HOURS]
[AFTER_HOURS_LINE]
[PRINCIPAL]
[DATE]
### Current tuning leans

These are recent directional notes set by the PM. If empty, this section is absent.

[LEAN_NOTES]

`;

function fakeClient(): Client {
  return {
    from(table: string) {
      if (table === "agencies") return agenciesBuilder();
      if (table === "agency_config") return agencyConfigBuilder();
      if (table === "prompt_versions") return promptBuilder();
      if (table === "agency_users") return pmsBuilder();
      if (table === "email_threads") return threadBuilder();
      if (table === "ai_drafts") return draftBuilder();
      if (table === "model_calls") return modelCallBuilder();
      throw new Error(`unexpected table ${table} in pipeline fake`);
    },
    // biome-ignore lint/suspicious/noExplicitAny: only the shape the pipeline touches is mocked
  } as any;
}

function agenciesBuilder() {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: state.agency, error: null }) }),
    }),
  };
}

function agencyConfigBuilder() {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: state.agencyConfig, error: null }) }),
    }),
  };
}

function promptBuilder() {
  return {
    select: () => ({
      eq: () => ({
        is: () => ({ maybeSingle: async () => ({ data: state.prompt, error: null }) }),
      }),
    }),
  };
}

function pmsBuilder() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: state.pms, error: null }),
        }),
      }),
    }),
  };
}

function threadBuilder() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.thread, error: null }) }),
      }),
    }),
    update: (row: Record<string, unknown>) => {
      state.threadUpdates.push(row);
      return { eq: () => ({ eq: async () => ({ error: null }) }) };
    },
  };
}

function draftBuilder() {
  return {
    insert: (row: Record<string, unknown>) => {
      state.draftInserts.push(row);
      return {
        select: () => ({
          single: async () => state.draftInsertResult,
        }),
      };
    },
  };
}

function modelCallBuilder() {
  return {
    insert: async (row: Record<string, unknown>) => {
      state.modelCallInserts.push(row);
      return { error: state.modelCallInsertError };
    },
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const silentLog = createLogger({ level: "error" });

const VALID_DRAFT: DraftSubmission = {
  category: "MAINTENANCE",
  category_confidence: "HIGH",
  priority: "STANDARD",
  escalation_flag: "NONE",
  emergency_landlord_alert: false,
  safety_critical: false,
  do_not_send: false,
  draft_confidence: "HIGH",
  draft_subject: "Re: kitchen tap",
  draft_body: "Hi Alex, thanks for letting us know — Sunshine Coast Test Agency will be in touch.",
  pm_review_notes: ["Plumber to engage."],
};

function pipelineInput(overrides: Partial<DraftPipelineInput> = {}): DraftPipelineInput {
  return {
    agencyId: "agency-aaa",
    emailMessageId: "msg-1",
    threadId: "thread-1",
    gmailThreadId: "gmail-thread-1",
    fromAddress: "alex@example.com",
    fromName: "Alex Tan",
    toAddresses: ["jess@example.com"],
    subject: "Kitchen tap is dripping",
    bodyPlain: "Hi Jess, the kitchen tap is dripping.",
    bodyHtml: null,
    receivedAt: "2026-05-28T09:00:00Z",
    ...overrides,
  };
}

function pipelineDeps(
  matcherResult: MatchResult,
  draftResult: DraftSubmission | Error = VALID_DRAFT,
  notifierResult: NotifyResult = { dispatched: 0, queued: 0, suppressed: 0, failed: 0 },
): DraftPipelineDeps & { notifier: ReturnType<typeof vi.fn> } {
  const matcherMock = vi.fn(async () => matcherResult);
  const drafterMock = vi.fn(async () => {
    if (draftResult instanceof Error) throw draftResult;
    return draftResult;
  });
  const notifierMock = vi.fn(async () => notifierResult);
  return {
    anthropicApiKey: "sk-ant-test",
    env: fakeEnv,
    logger: silentLog,
    matcher: matcherMock as DraftPipelineDeps["matcher"],
    drafter: drafterMock as DraftPipelineDeps["drafter"],
    notifier: notifierMock as unknown as DraftPipelineDeps["notifier"] & ReturnType<typeof vi.fn>,
    now: () => new Date("2026-05-28T10:00:00Z"),
  };
}

const fakeEnv = {
  TWILIO_ACCOUNT_SID: "AC0000000000000000000000000000test",
  TWILIO_AUTH_TOKEN: "00000000000000000000000000000test",
  TWILIO_FROM_NUMBER: "+61400000000",
  RESEND_API_KEY: "re_0000000000000000000000000000test",
  RESEND_FROM_EMAIL: "noreply@scta-test.example",
} as unknown as DraftPipelineDeps["env"];

beforeEach(() => {
  reset();
  writeAuditLogMock.mockClear();
});

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("runDraftPipeline", () => {
  it("happy path: persists draft + model_call + audit + updates thread", async () => {
    const match: MatchResult = {
      propertyId: "p-1",
      tenantId: "t-1",
      ownerId: null,
      confidence: "high",
      source: "exact_email",
    };

    const result = await runDraftPipeline(fakeClient(), pipelineInput(), pipelineDeps(match));

    expect(result).toEqual({
      kind: "ok",
      draftId: "draft-1",
      matchConfidence: "high",
      matchedVia: "exact_email",
    });

    // ai_drafts insert carries the matcher result + structured fields
    expect(state.draftInserts).toHaveLength(1);
    const draftRow = state.draftInserts[0];
    expect(draftRow).toMatchObject({
      agency_id: "agency-aaa",
      email_message_id: "msg-1",
      category: "MAINTENANCE",
      priority: "STANDARD",
      match_confidence: "high",
      matched_via: "exact_email",
      model_used: "claude-sonnet-4-6",
      prompt_version_id: "prompt-v22",
    });

    // model_calls captures duration + the model
    expect(state.modelCallInserts).toHaveLength(1);
    expect(state.modelCallInserts[0]).toMatchObject({
      agency_id: "agency-aaa",
      draft_id: "draft-1",
      model: "claude-sonnet-4-6",
      prompt_version_id: "prompt-v22",
    });
    expect(state.modelCallInserts[0]?.duration_ms).toBeTypeOf("number");

    // Thread updated because confidence is high and existing was none
    expect(state.threadUpdates).toHaveLength(1);
    expect(state.threadUpdates[0]).toMatchObject({
      property_id: "p-1",
      property_match_confidence: "high",
    });

    // Audit log
    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
    expect(writeAuditLogMock.mock.calls[0]?.[1]).toMatchObject({
      action: "draft.created",
      actor_type: "ai",
      agency_id: "agency-aaa",
      entity_type: "ai_drafts",
      entity_id: "draft-1",
    });
  });

  it("does NOT call the notifier when emergency_landlord_alert is false", async () => {
    const match: MatchResult = {
      propertyId: "p-1",
      tenantId: null,
      ownerId: "o-1",
      confidence: "high",
      source: "exact_email",
    };
    const deps = pipelineDeps(match, VALID_DRAFT);
    await runDraftPipeline(fakeClient(), pipelineInput(), deps);
    expect(deps.notifier).not.toHaveBeenCalled();
  });

  it("calls the notifier with safetyCritical + match propertyId/ownerId on emergency", async () => {
    const emergencyDraft: DraftSubmission = {
      ...VALID_DRAFT,
      priority: "EMERGENCY_ALERT",
      emergency_landlord_alert: true,
      safety_critical: true,
    };
    const match: MatchResult = {
      propertyId: "p-1",
      tenantId: null,
      ownerId: "o-1",
      confidence: "high",
      source: "exact_email",
    };
    const deps = pipelineDeps(match, emergencyDraft, {
      dispatched: 2,
      queued: 0,
      suppressed: 0,
      failed: 0,
    });
    const result = await runDraftPipeline(fakeClient(), pipelineInput(), deps);

    expect(deps.notifier).toHaveBeenCalledTimes(1);
    const [, notifyInput] = deps.notifier.mock.calls[0] ?? [];
    expect(notifyInput).toMatchObject({
      draftId: "draft-1",
      agencyId: "agency-aaa",
      propertyId: "p-1",
      ownerId: "o-1",
      safetyCritical: true,
    });

    // Result carries the notifier summary
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.notifier).toEqual({ dispatched: 2, queued: 0, suppressed: 0, failed: 0 });

    // Audit metadata includes the notification counts
    expect(writeAuditLogMock.mock.calls[0]?.[1]?.metadata).toMatchObject({
      notifications_dispatched: 2,
      notifications_queued: 0,
      notifications_suppressed: 0,
      notifications_failed: 0,
      safety_critical: true,
    });
  });

  it("swallows notifier failures — draft still ok, audit logs the attempt", async () => {
    const emergencyDraft: DraftSubmission = {
      ...VALID_DRAFT,
      emergency_landlord_alert: true,
    };
    const match: MatchResult = {
      propertyId: "p-1",
      tenantId: null,
      ownerId: "o-1",
      confidence: "high",
      source: "exact_email",
    };
    const deps = pipelineDeps(match, emergencyDraft);
    deps.notifier.mockReset();
    deps.notifier.mockRejectedValue(new Error("supabase down"));
    const result = await runDraftPipeline(fakeClient(), pipelineInput(), deps);
    expect(result.kind).toBe("ok");
    // Audit still ran — notifier counts default to 0
    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
    expect(writeAuditLogMock.mock.calls[0]?.[1]?.metadata).toMatchObject({
      notifications_dispatched: 0,
    });
  });

  it("does NOT update thread when match confidence < medium", async () => {
    const match: MatchResult = {
      propertyId: "p-1",
      tenantId: null,
      ownerId: null,
      confidence: "low",
      source: "body_scan",
    };
    await runDraftPipeline(fakeClient(), pipelineInput(), pipelineDeps(match));
    expect(state.threadUpdates).toHaveLength(0);
  });

  it("does NOT downgrade an existing high-confidence thread link", async () => {
    state.thread = { property_id: "p-prior", property_match_confidence: "high" };
    const match: MatchResult = {
      propertyId: "p-new",
      tenantId: null,
      ownerId: null,
      confidence: "medium",
      source: "subject_fuzzy",
    };
    await runDraftPipeline(fakeClient(), pipelineInput(), pipelineDeps(match));
    expect(state.threadUpdates).toHaveLength(0);
  });

  it("upgrades an existing low-confidence thread link to medium", async () => {
    state.thread = { property_id: "p-prior", property_match_confidence: "low" };
    const match: MatchResult = {
      propertyId: "p-new",
      tenantId: null,
      ownerId: null,
      confidence: "medium",
      source: "subject_fuzzy",
    };
    await runDraftPipeline(fakeClient(), pipelineInput(), pipelineDeps(match));
    expect(state.threadUpdates).toHaveLength(1);
    expect(state.threadUpdates[0]).toMatchObject({ property_match_confidence: "medium" });
  });

  it("returns skipped when agency_config is missing", async () => {
    state.agencyConfig = null;
    const match: MatchResult = {
      propertyId: null,
      tenantId: null,
      ownerId: null,
      confidence: "none",
      source: "fallback",
    };
    const result = await runDraftPipeline(fakeClient(), pipelineInput(), pipelineDeps(match));
    expect(result).toEqual({ kind: "skipped", reason: "agency_config_not_found" });
    expect(state.draftInserts).toHaveLength(0);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("returns skipped when no active prompt_versions row exists for the agency", async () => {
    state.prompt = null;
    const match: MatchResult = {
      propertyId: null,
      tenantId: null,
      ownerId: null,
      confidence: "none",
      source: "fallback",
    };
    const result = await runDraftPipeline(fakeClient(), pipelineInput(), pipelineDeps(match));
    expect(result).toEqual({ kind: "skipped", reason: "no_active_prompt_version" });
  });

  it("returns skipped when nominated_repairer is missing (assemble throws)", async () => {
    if (state.agencyConfig) state.agencyConfig.nominated_repairer = null;
    const match: MatchResult = {
      propertyId: null,
      tenantId: null,
      ownerId: null,
      confidence: "none",
      source: "fallback",
    };
    const result = await runDraftPipeline(fakeClient(), pipelineInput(), pipelineDeps(match));
    expect(result).toEqual({ kind: "skipped", reason: "missing_nominated_repairer" });
    expect(state.draftInserts).toHaveLength(0);
  });

  it("returns error (does not throw) when the drafter throws", async () => {
    const match: MatchResult = {
      propertyId: null,
      tenantId: null,
      ownerId: null,
      confidence: "none",
      source: "fallback",
    };
    const result = await runDraftPipeline(
      fakeClient(),
      pipelineInput(),
      pipelineDeps(match, new Error("anthropic 500")),
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.error.message).toContain("anthropic 500");
    }
    expect(state.draftInserts).toHaveLength(0);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("returns error when the ai_drafts insert fails", async () => {
    state.draftInsertResult = { data: null, error: { message: "unique violation" } };
    const match: MatchResult = {
      propertyId: null,
      tenantId: null,
      ownerId: null,
      confidence: "none",
      source: "fallback",
    };
    const result = await runDraftPipeline(fakeClient(), pipelineInput(), pipelineDeps(match));
    expect(result.kind).toBe("error");
    expect(state.modelCallInserts).toHaveLength(0); // never reached
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("compliance floor raises a welfare escalation the LLM missed; raw stays original", async () => {
    const match: MatchResult = {
      propertyId: null,
      tenantId: null,
      ownerId: null,
      confidence: "none",
      source: "fallback",
    };
    const result = await runDraftPipeline(
      fakeClient(),
      pipelineInput({ bodyPlain: "I am experiencing domestic violence and feel unsafe" }),
      pipelineDeps(match), // drafter returns VALID_DRAFT (escalation NONE, do_not_send false)
    );
    expect(result.kind).toBe("ok");

    // The persisted draft reflects the floored values...
    expect(state.draftInserts[0]).toMatchObject({ escalation_flag: "WELFARE", do_not_send: true });
    // ...but raw_response + model_calls keep the ORIGINAL LLM output.
    expect((state.draftInserts[0]?.raw_response as DraftSubmission).escalation_flag).toBe("NONE");
    const mc = state.modelCallInserts[0]?.response as { submission: DraftSubmission };
    expect(mc.submission.escalation_flag).toBe("NONE");
  });

  it("compliance floor bumps priority on a possible s214 emergency", async () => {
    const match: MatchResult = {
      propertyId: null,
      tenantId: null,
      ownerId: null,
      confidence: "none",
      source: "fallback",
    };
    await runDraftPipeline(
      fakeClient(),
      pipelineInput({ bodyPlain: "there is a burst pipe flooding the laundry" }),
      pipelineDeps(match),
    );
    expect(state.draftInserts[0]).toMatchObject({ priority: "PRIORITY" });
  });
});
