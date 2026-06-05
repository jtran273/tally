import assert from "node:assert/strict";
import test from "node:test";
import type { Json, ReviewQueueItem, ReviewReason, TransactionRecord } from "@/lib/db";
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
