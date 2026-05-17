import assert from "node:assert/strict";
import test from "node:test";
import { openClawSignalsFixture } from "@/lib/agents/openclaw-fixtures";
import { assertAssistantContextSafe } from "@/lib/agents";
import type { OpenClawClarificationQuestion, OpenClawSignalsResponse } from "./types";
import {
  buildOpenClawClarificationMessage,
  createOpenClawHttpClient,
  emptyOpenClawClarificationState,
  runOpenClawClarificationLoop,
  selectOpenClawClarificationReplyTarget,
  selectOpenClawClarificationToAsk,
  type OpenClawClarificationClient
} from "./live-clarification-loop";

const now = new Date("2026-05-17T17:00:00.000Z");

function signal(overrides: Partial<OpenClawClarificationQuestion> = {}): OpenClawClarificationQuestion {
  return {
    confidence: 0.74,
    createdAt: "2026-05-17T16:30:00.000Z",
    evidence: { reason: "Safe signal evidence." },
    expiresAt: null,
    proposalId: "33333333-3333-4333-8333-333333333333",
    proposedPatch: { suggestedCounterparty: "Ryan" },
    question: "Was $48.00 of Taco Guild on 2026-05-10 Ryan's share to reimburse?",
    questionFingerprint: "taco-guild-ryan-window",
    targetId: "tx-dinner",
    targetKind: "enriched_transaction",
    ...overrides
  };
}

function signals(questions: OpenClawClarificationQuestion[]): OpenClawSignalsResponse {
  return {
    ...openClawSignalsFixture,
    generatedAt: now.toISOString(),
    nextCursor: now.toISOString(),
    openClarificationQuestions: questions,
    pendingProposals: []
  };
}

function fakeClient(response: OpenClawSignalsResponse): OpenClawClarificationClient & {
  postedReplies: Array<{ proposalId: string; rawText: string }>;
} {
  const postedReplies: Array<{ proposalId: string; rawText: string }> = [];
  return {
    postedReplies,
    async fetchSignals() {
      return response;
    },
    async postReply(proposalId, rawText) {
      postedReplies.push({ proposalId, rawText });
      return {
        answer_kind: "counterparty",
        proposal_id: proposalId,
        status: "answered"
      };
    }
  };
}

test("selectOpenClawClarificationToAsk suppresses duplicate proposal ids and fingerprints", () => {
  const state = emptyOpenClawClarificationState();
  state.asked.push({
    answeredAt: null,
    askedAt: now.toISOString(),
    proposalId: "already-asked",
    questionFingerprint: "duplicate-fingerprint"
  });

  const selected = selectOpenClawClarificationToAsk(signals([
    signal({ proposalId: "already-asked", questionFingerprint: "new-fingerprint" }),
    signal({ proposalId: "new-proposal", questionFingerprint: "duplicate-fingerprint" }),
    signal({ proposalId: "fresh-proposal", questionFingerprint: "fresh-fingerprint" })
  ]), state);

  assert.equal(selected?.proposalId, "fresh-proposal");
});

test("runOpenClawClarificationLoop asks at most one concise question and posts the answer", async () => {
  const state = emptyOpenClawClarificationState();
  const client = fakeClient(signals([
    signal({ proposalId: "33333333-3333-4333-8333-333333333333" }),
    signal({ proposalId: "44444444-4444-4444-8444-444444444444", questionFingerprint: "second" })
  ]));
  const askedMessages: string[] = [];

  const result = await runOpenClawClarificationLoop({
    client,
    messenger: {
      async ask(_question, message) {
        askedMessages.push(message);
        return "Ryan";
      }
    },
    now,
    state
  });

  assert.equal(result.status, "answered");
  assert.equal(askedMessages.length, 1);
  assert.match(askedMessages[0], /^Tally reimbursement check:/);
  assert.ok(askedMessages[0].length < 160);
  assert.deepEqual(client.postedReplies, [{
    proposalId: "33333333-3333-4333-8333-333333333333",
    rawText: "Ryan"
  }]);
  assert.equal(state.asked[0]?.answeredAt, now.toISOString());
  assertAssistantContextSafe({ askedMessages, state });
});

test("runOpenClawClarificationLoop supports noninteractive ask-only polls without posting replies", async () => {
  const state = emptyOpenClawClarificationState();
  const client = fakeClient(signals([signal()]));
  let asks = 0;

  const result = await runOpenClawClarificationLoop({
    client,
    messenger: { async ask() { asks += 1; return null; } },
    now,
    state
  });

  assert.equal(result.status, "asked_without_answer");
  assert.equal(result.proposalId, signal().proposalId);
  assert.match(result.askedQuestion ?? "", /^Tally reimbursement check:/);
  assert.equal(asks, 1);
  assert.deepEqual(client.postedReplies, []);
  assert.equal(state.nextCursor, now.toISOString());
  assert.deepEqual(state.asked[0], {
    answeredAt: null,
    askedAt: now.toISOString(),
    proposalId: signal().proposalId,
    questionFingerprint: signal().questionFingerprint
  });
});

test("selectOpenClawClarificationReplyTarget picks the most recent unanswered proposal or explicit id", () => {
  const state = emptyOpenClawClarificationState();
  state.asked.push(
    {
      answeredAt: null,
      askedAt: "2026-05-17T15:00:00.000Z",
      proposalId: "older-unanswered",
      questionFingerprint: "older"
    },
    {
      answeredAt: "2026-05-17T16:00:00.000Z",
      askedAt: "2026-05-17T15:30:00.000Z",
      proposalId: "answered",
      questionFingerprint: "answered"
    },
    {
      answeredAt: null,
      askedAt: "2026-05-17T16:30:00.000Z",
      proposalId: "newer-unanswered",
      questionFingerprint: "newer"
    }
  );

  assert.equal(selectOpenClawClarificationReplyTarget(state)?.proposalId, "newer-unanswered");
  assert.equal(selectOpenClawClarificationReplyTarget(state, "older-unanswered")?.proposalId, "older-unanswered");
  assert.equal(selectOpenClawClarificationReplyTarget(state, "missing"), null);
});

test("runOpenClawClarificationLoop suppresses duplicate questions across repeated polls", async () => {
  const state = emptyOpenClawClarificationState();
  const client = fakeClient(signals([signal()]));
  let asks = 0;

  await runOpenClawClarificationLoop({
    client,
    messenger: { async ask() { asks += 1; return null; } },
    now,
    state
  });
  const second = await runOpenClawClarificationLoop({
    client,
    messenger: { async ask() { asks += 1; return "yes"; } },
    now,
    state
  });

  assert.equal(asks, 1);
  assert.equal(second.status, "no_question");
  assert.equal(client.postedReplies.length, 0);
});

test("buildOpenClawClarificationMessage rejects secret-shaped question payloads", () => {
  assert.throws(
    () => buildOpenClawClarificationMessage(signal({ question: "Bearer abcdefghijklmnop" })),
    /forbidden data|bearer_token/i
  );
});

test("createOpenClawHttpClient polls signals and posts replies with bearer auth", async () => {
  const calls: Array<{ body?: string; headers: Headers; method: string; url: string }> = [];
  const client = createOpenClawHttpClient({
    baseUrl: "https://tally.example.test/",
    token: "test-openclaw-token",
    fetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        body: typeof init?.body === "string" ? init.body : undefined,
        headers,
        method: init?.method ?? "GET",
        url: input.toString()
      });
      const payload = calls.length === 1
        ? signals([signal()])
        : { answer_kind: "confirm-reimbursement", proposal_id: signal().proposalId, status: "answered" };
      return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    }
  });

  await client.fetchSignals("2026-05-17T16:00:00.000Z");
  await client.postReply(signal().proposalId, " yes ");

  assert.equal(calls[0]?.url, "https://tally.example.test/api/openclaw/signals?since=2026-05-17T16%3A00%3A00.000Z");
  assert.equal(calls[0]?.headers.get("authorization"), "Bearer test-openclaw-token");
  assert.equal(calls[1]?.url, "https://tally.example.test/api/openclaw/replies");
  assert.equal(calls[1]?.method, "POST");
  assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), {
    proposal_id: signal().proposalId,
    raw_text: "yes"
  });
});
