import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type DrafterInput, DrafterValidationError, type DraftSubmission, draft } from "../src";

const VALID_DRAFT: DraftSubmission = {
  category: "MAINTENANCE",
  category_confidence: "HIGH",
  priority: "STANDARD",
  escalation_flag: "NONE",
  emergency_landlord_alert: false,
  safety_critical: false,
  do_not_send: false,
  draft_confidence: "HIGH",
  draft_subject: "Re: dripping tap",
  draft_body: "Hi Alex, thanks for letting us know. Sunshine Coast Test Agency will be in touch.",
  pm_review_notes: ["Plumber to be engaged."],
};

function makeValidResponse(args: DraftSubmission = VALID_DRAFT) {
  return {
    content: [{ type: "tool_use", id: "toolu_test", name: "submit_draft", input: args }],
    stop_reason: "tool_use",
  };
}

function makeMinimalInput(): DrafterInput {
  return {
    systemPrompt: "FAKE SYSTEM PROMPT",
    inboundEmail: {
      from: "alex@example.com",
      to: "jess@scta-test.example",
      subject: "Tap leak",
      body: "Hi, the kitchen tap is dripping.",
      receivedAt: "2026-05-28T10:00:00Z",
    },
  };
}

function makeFakeClient(createMock: Mock): Anthropic {
  return { messages: { create: createMock } } as unknown as Anthropic;
}

function firstCallParams(mock: Mock): {
  model: string;
  system: string;
  tool_choice: unknown;
  tools: Array<{ name: string; input_schema: { type: string } }>;
  messages: Array<{ role: string; content: string }>;
} {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("create was not called");
  return call[0] as ReturnType<typeof firstCallParams>;
}

describe("draft (unit, mocked Anthropic client)", () => {
  let createMock: Mock;
  let client: Anthropic;

  beforeEach(() => {
    createMock = vi.fn();
    client = makeFakeClient(createMock);
  });

  it("uses claude-sonnet-4-6 as the default model", async () => {
    createMock.mockResolvedValue(makeValidResponse());
    await draft(makeMinimalInput(), { apiKey: "irrelevant", client });
    expect(firstCallParams(createMock).model).toBe("claude-sonnet-4-6");
  });

  it("uses claude-opus-4-7 when the caller overrides the model", async () => {
    createMock.mockResolvedValue(makeValidResponse());
    await draft(
      { ...makeMinimalInput(), model: "claude-opus-4-7" },
      { apiKey: "irrelevant", client },
    );
    expect(firstCallParams(createMock).model).toBe("claude-opus-4-7");
  });

  it("forces tool_choice to the submit_draft tool", async () => {
    createMock.mockResolvedValue(makeValidResponse());
    await draft(makeMinimalInput(), { apiKey: "irrelevant", client });
    expect(firstCallParams(createMock).tool_choice).toEqual({
      type: "tool",
      name: "submit_draft",
    });
  });

  it("passes the assembled system prompt straight through", async () => {
    createMock.mockResolvedValue(makeValidResponse());
    await draft(makeMinimalInput(), { apiKey: "irrelevant", client });
    expect(firstCallParams(createMock).system).toBe("FAKE SYSTEM PROMPT");
  });

  it("declares exactly one tool (submit_draft) with a JSON-schema object body", async () => {
    createMock.mockResolvedValue(makeValidResponse());
    await draft(makeMinimalInput(), { apiKey: "irrelevant", client });
    const params = firstCallParams(createMock);
    expect(params.tools).toHaveLength(1);
    expect(params.tools[0]?.name).toBe("submit_draft");
    expect(params.tools[0]?.input_schema.type).toBe("object");
  });

  it("includes inbound email + thread history in the user message", async () => {
    createMock.mockResolvedValue(makeValidResponse());
    await draft(
      {
        ...makeMinimalInput(),
        threadHistory: [
          {
            direction: "outbound",
            from: "jess@scta-test.example",
            body: "Earlier reply from PM.",
            timestamp: "2026-05-27T09:00:00Z",
          },
        ],
      },
      { apiKey: "irrelevant", client },
    );
    const msg = firstCallParams(createMock).messages[0]?.content ?? "";
    expect(msg).toContain("Earlier reply from PM.");
    expect(msg).toContain("Hi, the kitchen tap is dripping.");
    expect(msg).toContain("Tap leak");
  });

  it("returns the parsed DraftSubmission on a valid tool_use response", async () => {
    createMock.mockResolvedValue(makeValidResponse());
    const out = await draft(makeMinimalInput(), { apiKey: "irrelevant", client });
    expect(out.category).toBe("MAINTENANCE");
    expect(out.do_not_send).toBe(false);
    expect(out.pm_review_notes).toEqual(["Plumber to be engaged."]);
  });

  it("throws DrafterValidationError when the response has no tool_use block", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "I refuse to use the tool." }],
      stop_reason: "end_turn",
    });
    await expect(draft(makeMinimalInput(), { apiKey: "irrelevant", client })).rejects.toThrow(
      DrafterValidationError,
    );
  });

  it("throws DrafterValidationError when the tool_use args don't match the schema", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_test",
          name: "submit_draft",
          input: { category: "NOT_A_REAL_CATEGORY" },
        },
      ],
      stop_reason: "tool_use",
    });
    await expect(draft(makeMinimalInput(), { apiKey: "irrelevant", client })).rejects.toThrow(
      DrafterValidationError,
    );
  });
});
