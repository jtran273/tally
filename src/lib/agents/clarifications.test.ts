import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReimbursementClarificationQuestion,
  decideReimbursementClarification,
  normalizeReimbursementClarificationAnswer,
  type OpenClarificationRequestSummary,
  type ReimbursementClarificationCandidate,
  type ReimbursementClarificationPolicy
} from "./clarifications";

const policy: ReimbursementClarificationPolicy = {
  highConfidenceThreshold: 0.8,
  maxOpenRequests: 2,
  mediumConfidenceThreshold: 0.55,
  meaningfulImpactAmount: 20
};

function candidate(input: Partial<ReimbursementClarificationCandidate> = {}): ReimbursementClarificationCandidate {
  return {
    accountingImpactAmount: 48,
    amount: -96,
    candidateId: "candidate-venmo-dinner",
    confidence: 0.74,
    currency: "USD",
    date: "2026-05-10",
    evidence: ["Dinner charge followed by same-day Venmo credit."],
    merchant: "Taco Guild",
    questionFingerprint: "tx:taco-guild:ryan:2026-05",
    suggestedCounterparty: "Ryan",
    transactionId: "tx-taco-guild",
    ...input
  };
}

function openRequest(questionFingerprint: string): OpenClarificationRequestSummary {
  return {
    questionFingerprint,
    status: "open"
  };
}

test("decideReimbursementClarification asks for meaningful medium-confidence matches", () => {
  const decision = decideReimbursementClarification(candidate(), [], policy);

  assert.equal(decision.action, "ask");
  assert.equal(decision.reason, "ask-meaningful-medium-confidence");
  assert.equal(decision.request?.object, "assistant_clarification_request");
  assert.equal(decision.request?.approvalRequired, true);
  assert.equal(decision.request?.audit.writesAllowed, false);
  assert.equal(
    decision.request?.question,
    "Was $48.00 of Taco Guild on 2026-05-10 Ryan's share to reimburse?"
  );
});

test("decideReimbursementClarification marks high-confidence requests as high priority", () => {
  const decision = decideReimbursementClarification(candidate({ confidence: 0.91 }), [], policy);

  assert.equal(decision.action, "ask");
  assert.equal(decision.reason, "ask-meaningful-high-confidence");
  assert.equal(decision.request?.priority, "high");
});

test("decideReimbursementClarification stays silent for low-value matches", () => {
  const decision = decideReimbursementClarification(candidate({ accountingImpactAmount: 8 }), [], policy);

  assert.deepEqual(decision, {
    action: "silent",
    reason: "below-value-threshold"
  });
});

test("decideReimbursementClarification stays silent for low-confidence matches", () => {
  const decision = decideReimbursementClarification(candidate({ confidence: 0.32 }), [], policy);

  assert.deepEqual(decision, {
    action: "silent",
    reason: "below-confidence-threshold"
  });
});

test("decideReimbursementClarification stays silent when accounting does not change", () => {
  const decision = decideReimbursementClarification(candidate({ accountingImpactAmount: 0 }), [], policy);

  assert.deepEqual(decision, {
    action: "silent",
    reason: "no-accounting-impact"
  });
});

test("decideReimbursementClarification queues repeated questions instead of interrupting again", () => {
  const decision = decideReimbursementClarification(
    candidate(),
    [openRequest("tx:taco-guild:ryan:2026-05")],
    policy
  );

  assert.deepEqual(decision, {
    action: "app-only-queue",
    reason: "batch-similar-open-request"
  });
});

test("decideReimbursementClarification queues when too many questions are already open", () => {
  const decision = decideReimbursementClarification(
    candidate({ questionFingerprint: "tx:new-question" }),
    [openRequest("tx:first"), openRequest("tx:second")],
    policy
  );

  assert.deepEqual(decision, {
    action: "app-only-queue",
    reason: "too-many-open-requests"
  });
});

test("buildReimbursementClarificationQuestion handles unknown counterparties", () => {
  assert.equal(
    buildReimbursementClarificationQuestion(candidate({ suggestedCounterparty: null })),
    "Was $48.00 of Taco Guild on 2026-05-10 someone else's share to reimburse?"
  );
});

test("normalizeReimbursementClarificationAnswer parses supported short answers", () => {
  assert.deepEqual(normalizeReimbursementClarificationAnswer("yes"), {
    counterparties: [],
    kind: "confirm-reimbursement",
    rawAnswer: "yes"
  });
  assert.deepEqual(normalizeReimbursementClarificationAnswer("Ryan dinner"), {
    counterparties: ["Ryan"],
    kind: "counterparty",
    rawAnswer: "Ryan dinner"
  });
  assert.deepEqual(normalizeReimbursementClarificationAnswer("not reimbursement"), {
    counterparties: [],
    kind: "not-reimbursement",
    rawAnswer: "not reimbursement"
  });
  assert.deepEqual(normalizeReimbursementClarificationAnswer("split between Alex and Sam"), {
    counterparties: ["Alex", "Sam"],
    kind: "split-counterparties",
    rawAnswer: "split between Alex and Sam"
  });
});
