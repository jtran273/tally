import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProposalRecord, Json, ReviewQueueItem, ReviewReason, TransactionRecord } from "@/lib/db";
import {
  buildAgentInboxProposals,
  summarizeAgentInbox
} from "./proposal-inbox";

function transaction(input: Partial<TransactionRecord> = {}): TransactionRecord {
  const id = input.id ?? "tx-test";

  return {
    accountId: "acct-checking",
    accountMask: "1234",
    accountName: "Checking",
    amount: -42.25,
    category: "Food",
    categoryId: "cat-food",
    confidence: 0.82,
    date: "2026-05-05",
    id,
    institutionName: "Bank",
    intent: "personal",
    merchant: "Cafe",
    note: "private note",
    plaidCategory: "Restaurants",
    plaidMerchant: "CAFE",
    plaidName: "CAFE PURCHASE",
    plaidTransactionId: "plaid-secret-id",
    rawTransactionId: `raw-${id}`,
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId: "user-test",
    ...input
  };
}

function reviewItem(input: {
  aiSuggestion?: Json;
  id: string;
  reason?: ReviewReason;
  transaction?: TransactionRecord;
}): ReviewQueueItem {
  const tx = input.transaction ?? transaction({ id: `tx-${input.id}` });

  return {
    aiSuggestion: input.aiSuggestion ?? {},
    confidence: 0.76,
    createdAt: "2026-05-06T12:00:00.000Z",
    explanation: "Needs review.",
    id: input.id,
    reason: input.reason ?? "missing-category",
    resolutionKind: null,
    resolutionNote: null,
    resolvedAt: null,
    status: "open",
    transaction: tx,
    transactionId: tx.id
  };
}

function agentProposal(input: Partial<AgentProposalRecord> = {}): AgentProposalRecord {
  return {
    acceptedAt: null,
    answeredAt: null,
    clarificationAnswer: null,
    clarificationAnswerKind: null,
    clarificationQuestion: null,
    confidence: 0.82,
    createdAt: "2026-05-06T13:00:00.000Z",
    dismissedAt: null,
    evidence: {},
    expiresAt: null,
    id: "proposal-test",
    proposalType: "reimbursement_candidate",
    proposedPatch: {},
    questionFingerprint: "reimbursement-candidate:tx-dinner:tx-venmo",
    sourceAgent: "ledger-reimbursement-candidate-detector",
    sourceCandidateId: "candidate-test",
    sourceContextId: "reimbursement-candidate:tx-dinner",
    status: "pending",
    targetId: "tx-dinner",
    targetKind: "enriched_transaction",
    updatedAt: "2026-05-06T13:00:00.000Z",
    userId: "user-test",
    ...input
  };
}

test("agent inbox turns accept-ready review suggestions into safe proposals", () => {
  const [proposal] = buildAgentInboxProposals([
    reviewItem({
      aiSuggestion: {
        category: { value: { id: "cat-groceries", name: "Groceries" } },
        confidence: 0.91,
        intent: "personal",
        reason: "Merchant name matches grocery spend.",
        recurring: false
      },
      id: "review-grocery"
    })
  ]);

  assert.equal(proposal?.status, "accept-ready");
  assert.equal(proposal?.action, "review-suggestion");
  if (proposal?.action !== "review-suggestion") {
    throw new Error("Expected a review suggestion proposal.");
  }
  assert.equal(proposal?.recommendation.categoryName, "Groceries");
  assert.equal(proposal?.recommendation.confidence, 0.91);
  assert.equal(proposal?.context.accountLabel, "Checking ending 1234");
  assert.equal("plaidTransactionId" in proposal!, false);
  assert.equal("rawTransactionId" in proposal!, false);
  assert.equal("raw_payload" in proposal!, false);
});

test("agent inbox routes peer-to-peer and empty suggestions to manual review", () => {
  const proposals = buildAgentInboxProposals([
    reviewItem({ id: "review-empty" }),
    reviewItem({ id: "review-venmo", reason: "venmo" })
  ]);

  assert.deepEqual(proposals.map((proposal) => proposal.status), ["needs-review", "needs-review"]);
  assert.deepEqual(proposals.map((proposal) => proposal.action), ["manual-review", "manual-review"]);
});

test("agent inbox does not surface provider diagnostics as recommendation signals", () => {
  const [proposal] = buildAgentInboxProposals([
    reviewItem({
      aiSuggestion: {
        categoryName: "Groceries",
        confidence: 0.91,
        signals: [
          "merchant cue: grocery",
          "OpenAI unavailable or returned no additional signals"
        ]
      },
      id: "review-diagnostic"
    })
  ]);

  assert.deepEqual(proposal?.recommendation.signals, ["merchant cue: grocery"]);
});

test("agent inbox surfaces AI reimbursement candidates as draft-only proposals", () => {
  const [proposal] = buildAgentInboxProposals([], [
    agentProposal({
      evidence: {
        aiProvider: { kind: "openai", version: "test" },
        candidateInflows: [
          {
            amount: 40,
            category: "Transfer",
            date: "2026-05-07",
            id: "tx-venmo",
            merchant: "Venmo"
          }
        ],
        heuristicReasons: ["Nearby positive inflow could be a reimbursement."],
        signals: ["Shared dining pattern"],
        transaction: {
          amount: -80,
          category: "Food",
          date: "2026-05-05",
          id: "tx-dinner",
          intent: "personal",
          merchant: "Dinner"
        }
      },
      proposedPatch: {
        question: "Was $40 of Dinner reimbursed by Venmo?",
        reason: "Nearby Venmo inflow suggests this may be shared.",
        suggestedInflowIds: ["tx-venmo"],
        suggestedIntent: "reimbursable"
      }
    })
  ]);

  assert.equal(proposal?.action, "reimbursement-candidate");
  if (proposal?.action !== "reimbursement-candidate") {
    throw new Error("Expected a reimbursement candidate proposal.");
  }
  assert.equal(proposal.status, "needs-review");
  assert.equal(proposal.question, "Was $40 of Dinner reimbursed by Venmo?");
  assert.equal(proposal.recommendation.suggestedIntent, "reimbursable");
  assert.deepEqual(proposal.recommendation.signals, [
    "Shared dining pattern",
    "Nearby positive inflow could be a reimbursement."
  ]);
  assert.equal(proposal.candidateInflows[0]?.merchant, "Venmo");
  assert.equal("aiProvider" in proposal, false);
  assert.equal("plaidTransactionId" in proposal, false);
});

test("agent inbox summary counts proposals and changed fields", () => {
  const proposals = buildAgentInboxProposals([
    reviewItem({
      aiSuggestion: {
        categoryName: "Travel",
        intent: "business",
        merchantName: "Hotel",
        recurring: false
      },
      id: "review-ready"
    }),
    reviewItem({ id: "review-empty" })
  ]);

  assert.deepEqual(summarizeAgentInbox(proposals), {
    acceptReadyCount: 1,
    manualReviewCount: 1,
    proposedFieldCount: 4,
    totalCount: 2
  });
});
