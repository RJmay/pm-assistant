/**
 * End-to-end pipeline test against the real Anthropic API.
 *
 * Run with: `RUN_LLM_TESTS=1 ANTHROPIC_API_KEY=… pnpm --filter worker test`
 * (skipped by default — same pattern as packages/prompts/test/drafter.live.test.ts).
 *
 * Mocks Supabase only. Runs matcher (stubbed), assemble (real, uses the v2.2
 * prompt from disk), draft (real call), then asserts the persisted ai_drafts
 * row's structured fields. Body-content constraints come straight from M3's
 * fixture set so this stays consistent with what the drafter is already
 * validated against.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Client } from "@pm/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/supabase", () => ({
  writeAuditLog: vi.fn(async () => undefined),
}));

import { createLogger } from "../src/lib/log";
import { runDraftPipeline } from "../src/services/draft-pipeline";
import type { MatchResult } from "../src/services/matcher";

const RUN = process.env.RUN_LLM_TESTS === "1";
const describeIf = RUN ? describe : describe.skip;

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_PROMPT = readFileSync(
  resolve(__dirname, "../../../packages/prompts/src/base/pm-drafting-v2.2.md"),
  "utf-8",
);

const FORBIDDEN_PHRASES = [
  "The owner will",
  "Don't worry about the cost",
  "That's covered under your bond",
  "You're entitled to a rent reduction",
];

const AGENCY_NAME = "Sunshine Coast Test Agency";

interface MockState {
  draftInserts: Array<Record<string, unknown>>;
  modelCallInserts: Array<Record<string, unknown>>;
}

let state: MockState;
function resetState() {
  state = { draftInserts: [], modelCallInserts: [] };
}

function makeFakeClient(): Client {
  return {
    from(table: string) {
      if (table === "agencies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "agency-aaa",
                  name: AGENCY_NAME,
                  suburb: "Mooloolaba",
                  business_hours: "Mon-Fri 9am-5pm AEST",
                  after_hours_emergency_line: "+61 7 5555 1111",
                  principal_email: "casey@example.com",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "agency_config") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  agency_id: "agency-aaa",
                  voice_samples: [
                    {
                      label: "Sample — warm acknowledgement",
                      body: "Hi Alex, thanks for letting me know about the dripping tap. I've logged it and our plumber will be in touch directly.\n\nKind regards,\nJess",
                    },
                  ],
                  approved_tradies: [
                    {
                      trade: "Plumbing",
                      name: "Coast Plumbing Co",
                      business_hours_contact: "+61 7 5555 0001",
                      after_hours_contact: "+61 400 555 001",
                    },
                  ],
                  nominated_repairer: {
                    name: "Coast Plumbing Co",
                    number: "+61 400 555 001",
                  },
                  routine_approval_threshold_cents: 25000,
                  written_quote_threshold_cents: 50000,
                  per_owner_quote_exceptions: [],
                  house_rules: null,
                  lean_notes: [],
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "prompt_versions") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: { id: "prompt-v22", content: BASE_PROMPT },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "agency_users") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [{ full_name: "Jess Bowman", email: "jess@scta-test.example" }],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "email_threads") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { property_id: null, property_match_confidence: "none" },
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        };
      }
      if (table === "ai_drafts") {
        return {
          insert: (row: Record<string, unknown>) => {
            state.draftInserts.push(row);
            return {
              select: () => ({ single: async () => ({ data: { id: "draft-1" }, error: null }) }),
            };
          },
        };
      }
      if (table === "model_calls") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.modelCallInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table} in LLM-test fake`);
    },
    // biome-ignore lint/suspicious/noExplicitAny: only the surface we touch is mocked
  } as any;
}

interface Fixture {
  id: string;
  label: string;
  email: {
    from: string;
    fromName: string;
    subject: string;
    body: string;
  };
  expected: {
    category: "MAINTENANCE" | "RENT" | "LEASE" | "COMPLAINT" | "ADMIN" | "OTHER";
    priority: "STANDARD" | "PRIORITY" | "EMERGENCY_ALERT";
    escalation_flag: "NONE" | "WELFARE" | "LEGAL" | "REPUTATIONAL" | "INCIDENT";
    do_not_send: boolean;
    emergency_landlord_alert: boolean;
  };
}

// A focused subset of M3 fixtures — three categories: routine, s214 emergency,
// and a reputational escalation. Body assertions only apply to sendable drafts.
const FIXTURES: Fixture[] = [
  {
    id: "01-routine-maintenance",
    label: "Routine maintenance — dripping tap",
    email: {
      from: "alex.tan@example.com",
      fromName: "Alex Tan",
      subject: "Kitchen tap is dripping",
      body: "Hi Jess,\n\nThe kitchen tap is dripping. Not urgent, but figured I should mention it. Happy to be home any weekday afternoon.\n\nThanks,\nAlex (12 Beach Parade, Mooloolaba)",
    },
    expected: {
      category: "MAINTENANCE",
      priority: "STANDARD",
      escalation_flag: "NONE",
      do_not_send: false,
      emergency_landlord_alert: false,
    },
  },
  {
    id: "03-emergency-s214",
    label: "s214 emergency — water through ceiling",
    email: {
      from: "drew.patel@example.com",
      fromName: "Drew Patel",
      subject: "URGENT — water coming through the ceiling",
      body: "Hi,\n\nThere's water pouring through the ceiling — coming down fast and the carpet is soaked. I've turned the mains off but need someone now. My phone is +61 400 200 004.\n\nDrew (17 Lindsay Road, Buderim)",
    },
    expected: {
      category: "MAINTENANCE",
      priority: "EMERGENCY_ALERT",
      escalation_flag: "NONE",
      do_not_send: false,
      emergency_landlord_alert: true,
    },
  },
  {
    id: "09-media-reputational",
    label: "REPUTATIONAL escalation — journalist requesting comment",
    email: {
      from: "investigations@channel7news.example",
      fromName: "M. Reynolds",
      subject: "Story on rental conditions — comment by EOD",
      body: "Hi,\n\nI'm a journalist with Channel 7 News writing about rental conditions on the Sunshine Coast. We've received concerns about one of your managed properties (Buderim area) and would like a comment before publication. Story runs tomorrow at 6pm.\n\nRegards,\nM. Reynolds, Channel 7 News",
    },
    expected: {
      category: "OTHER",
      priority: "EMERGENCY_ALERT",
      escalation_flag: "REPUTATIONAL",
      do_not_send: true,
      emergency_landlord_alert: false,
    },
  },
];

beforeEach(resetState);

describeIf("draft pipeline (live, RUN_LLM_TESTS=1)", () => {
  if (!RUN) return;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("RUN_LLM_TESTS=1 but ANTHROPIC_API_KEY is not set");
  }

  const noopMatcher = async (): Promise<MatchResult> => ({
    propertyId: null,
    tenantId: null,
    ownerId: null,
    confidence: "none",
    source: "fallback",
  });
  const log = createLogger({ level: "error" });

  for (const fixture of FIXTURES) {
    it(`${fixture.id} — ${fixture.label}`, { timeout: 60_000 }, async () => {
      const result = await runDraftPipeline(
        makeFakeClient(),
        {
          agencyId: "agency-aaa",
          emailMessageId: "msg-1",
          threadId: "thread-1",
          gmailThreadId: "gmail-thread-1",
          fromAddress: fixture.email.from,
          fromName: fixture.email.fromName,
          toAddresses: ["jess@scta-test.example"],
          subject: fixture.email.subject,
          bodyPlain: fixture.email.body,
          bodyHtml: null,
          receivedAt: "2026-05-28T10:00:00+10:00",
        },
        {
          anthropicApiKey: apiKey,
          logger: log,
          matcher: noopMatcher,
        },
      );

      expect(result.kind).toBe("ok");
      expect(state.draftInserts).toHaveLength(1);
      const row = state.draftInserts[0] as Record<string, string | boolean | unknown>;

      expect(row.category, "category").toBe(fixture.expected.category);
      expect(row.priority, "priority").toBe(fixture.expected.priority);
      expect(row.escalation_flag, "escalation_flag").toBe(fixture.expected.escalation_flag);
      expect(row.do_not_send, "do_not_send").toBe(fixture.expected.do_not_send);
      expect(row.emergency_landlord_alert, "emergency_landlord_alert").toBe(
        fixture.expected.emergency_landlord_alert,
      );

      if (!fixture.expected.do_not_send) {
        const body = row.draft_body as string;
        expect(body, "must contain agency signoff").toContain(AGENCY_NAME);
        for (const phrase of FORBIDDEN_PHRASES) {
          expect(body, `must not contain "${phrase}"`).not.toContain(phrase);
        }
      }

      // model_calls captured the exchange
      expect(state.modelCallInserts).toHaveLength(1);
      expect(state.modelCallInserts[0]).toMatchObject({
        agency_id: "agency-aaa",
        draft_id: "draft-1",
        model: "claude-sonnet-4-6",
      });
    });
  }
});
