import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantContextSafe } from "@/lib/agents";
import { openClawSignalsFixture } from "@/lib/agents/openclaw-fixtures";
import type { AgentProposalRecord } from "@/lib/db";
import {
  OpenClawSignalsBadRequestError,
  buildOpenClawSignalsResponse,
  openClawTransactionWindow,
  resolveOpenClawSince,
  selectOpenClarificationProposals
} from "./signals";
import { OPENCLAW_SIGNAL_CONTRACT_VERSION } from "./types";

const generatedAt = "2026-05-13T12:00:00.000Z";

function proposal(input: Partial<AgentProposalRecord> = {}): AgentProposalRecord {
  return {
    acceptedAt: null,
    answeredAt: null,
    clarificationAnswer: null,
    clarificationAnswerKind: null,
    clarificationQuestion: null,
    confidence: 0.72,
    createdAt: "2026-05-13T11:30:00.000Z",
    dismissedAt: null,
    evidence: { reason: "Safe fixture evidence." },
    expiresAt: null,
    id: "proposal-1",
    proposalType: "reimbursement_candidate",
    proposedPatch: { suggestedIntent: "reimbursable" },
    questionFingerprint: "fingerprint",
    sourceAgent: "test-agent",
    sourceCandidateId: null,
    sourceContextId: null,
    status: "pending",
    targetId: "tx-1",
    targetKind: "enriched_transaction",
    updatedAt: "2026-05-13T11:30:00.000Z",
    userId: "user-1",
    ...input
  };
}

const weeklyPlanningContext = openClawSignalsFixture.weeklyPlanningContext;

test("OpenClaw signals fixture documents the safe response contract", () => {
  assert.equal(openClawSignalsFixture.object, "ledger.openclaw.signals");
  assert.equal(openClawSignalsFixture.contractVersion, OPENCLAW_SIGNAL_CONTRACT_VERSION);
  assert.equal(openClawSignalsFixture.calendarContext.status, "not_configured");
  assert.equal(openClawSignalsFixture.weeklyPlanningContext.action, "read.weekly_planning_context");
  assert.equal(openClawSignalsFixture.openClarificationQuestions.length, 1);
  assert.doesNotMatch(JSON.stringify(openClawSignalsFixture), /fixture-user/);
  assertAssistantContextSafe(openClawSignalsFixture);
});

test("buildOpenClawSignalsResponse projects proposals without provider descriptors", () => {
  const response = buildOpenClawSignalsResponse({
    generatedAt,
    openClarificationProposals: [],
    pendingProposals: [
      proposal({
        evidence: {
          aiProvider: { id: "openai-transaction-review", kind: "openai" },
          reason: "Safe proposal evidence."
        }
      })
    ],
    since: "2026-05-12T12:00:00.000Z",
    weeklyPlanningContext
  });

  assert.equal(response.pendingProposals.length, 1);
  assert.deepEqual(response.pendingProposals[0].evidence, { reason: "Safe proposal evidence." });
  assertAssistantContextSafe(response);
});

test("buildOpenClawSignalsResponse exposes question-bearing reimbursement candidates", () => {
  const response = buildOpenClawSignalsResponse({
    generatedAt,
    openClarificationProposals: [
      proposal({
        clarificationQuestion: "Was Taco Guild reimbursable?",
        id: "candidate-question",
        proposalType: "reimbursement_candidate"
      })
    ],
    pendingProposals: [],
    since: "2026-05-12T12:00:00.000Z",
    weeklyPlanningContext
  });

  assert.deepEqual(response.openClarificationQuestions.map((question) => question.proposalId), ["candidate-question"]);
  assert.equal(response.openClarificationQuestions[0]?.question, "Was Taco Guild reimbursable?");
  assertAssistantContextSafe(response);
});

test("selectOpenClarificationProposals filters questions before applying the limit", () => {
  const selected = selectOpenClarificationProposals(
    [
      proposal({ id: "newer-non-question", clarificationQuestion: null }),
      proposal({
        clarificationQuestion: "Was Taco Guild reimbursable?",
        id: "candidate-question",
        proposalType: "reimbursement_candidate"
      }),
      proposal({
        clarificationQuestion: "Who paid you back?",
        id: "clarification-question",
        proposalType: "clarification_request"
      })
    ],
    1
  );

  assert.deepEqual(selected.map((item) => item.id), ["candidate-question"]);
});

test("buildOpenClawSignalsResponse rejects secret-shaped values before serialization", () => {
  assert.throws(
    () => buildOpenClawSignalsResponse({
      generatedAt,
      openClarificationProposals: [],
      pendingProposals: [
        proposal({
          evidence: { note: "Bearer abcdefghijklmnop" }
        })
      ],
      since: "2026-05-12T12:00:00.000Z",
      weeklyPlanningContext
    }),
    /forbidden data|bearer_token/i
  );
});

test("resolveOpenClawSince defaults to the last 24 hours and rejects invalid cursors", () => {
  const now = new Date(generatedAt);

  assert.equal(resolveOpenClawSince(null, now), "2026-05-12T12:00:00.000Z");
  assert.equal(resolveOpenClawSince("2026-05-13T10:00:00.000Z", now), "2026-05-13T10:00:00.000Z");
  assert.throws(
    () => resolveOpenClawSince("not-a-date", now),
    OpenClawSignalsBadRequestError
  );
});

test("openClawTransactionWindow anchors transaction context to the poll date", () => {
  assert.deepEqual(openClawTransactionWindow(new Date(generatedAt)), {
    asOfDate: "2026-05-13",
    fromDate: "2026-01-13",
    toDate: "2026-05-13"
  });
});
