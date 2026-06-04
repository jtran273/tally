import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantContextSafe } from "@/lib/agents";
import { openClawSignalsFixture } from "@/lib/agents/openclaw-fixtures";
import type { ReviewQueueItem, TransactionRecord } from "@/lib/db";
import {
  buildOpenClawRecentTransactionsResponse,
  buildOpenClawReimbursementsResponse,
  buildOpenClawReviewItemsResponse,
  buildOpenClawSafeToSpendResponse,
  parseOpenClawLimit,
  parseSafeToSpendAmount
} from "./finance-read-api";

function transaction(input: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: "tx-1",
    accountId: "account-1",
    accountName: "Checking",
    accountMask: "1234",
    amount: -42.5,
    category: "Food",
    categoryId: "category-food",
    confidence: 0.9,
    date: "2026-05-21",
    institutionName: "Bank",
    intent: "personal",
    merchant: "Cafe",
    note: "",
    plaidCategory: null,
    plaidTransactionId: null,
    plaidMerchant: null,
    plaidName: null,
    rawTransactionId: "raw-tx-1",
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId: "user-1",
    ...input
  };
}

function reviewItem(input: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: "review-1",
    createdAt: "2026-05-21T12:00:00.000Z",
    aiSuggestion: {},
    confidence: 0.42,
    explanation: "Needs category confirmation.",
    reason: "low-confidence",
    resolutionNote: null,
    resolutionKind: null,
    resolvedAt: null,
    status: "open",
    transaction: transaction(),
    transactionId: "tx-1",
    ...input
  };
}

test("recent transaction response exposes only safe transaction fields", () => {
  const response = buildOpenClawRecentTransactionsResponse([transaction()], {
    generatedAt: "2026-05-21T12:00:00.000Z",
    limit: 5
  });
  const serialized = JSON.stringify(response);

  assert.equal(response.object, "ledger.openclaw.recent_transactions");
  assert.equal(response.transactions[0]?.accountNickname, "Checking");
  assert.equal("accountMask" in response.transactions[0]!, false);
  assert.doesNotMatch(serialized, /1234|raw_payload|plaid_transaction|access_token|service_role/i);
  assertAssistantContextSafe(response);
});

test("review items response summarizes open review queue", () => {
  const response = buildOpenClawReviewItemsResponse([
    reviewItem(),
    reviewItem({ id: "review-closed", status: "resolved" })
  ], { limit: 5 });

  assert.equal(response.object, "ledger.openclaw.review_items");
  assert.equal(response.openCount, 1);
  assert.deepEqual(response.items.map((item) => item.id), ["review-1"]);
  assertAssistantContextSafe(response);
});

test("reimbursements response surfaces outstanding reimbursable transactions", () => {
  const response = buildOpenClawReimbursementsResponse([
    transaction({
      id: "tx-dinner",
      amount: -80,
      intent: "reimbursable",
      merchant: "Dinner"
    }),
    transaction({ id: "tx-normal" })
  ], { limit: 5 });

  assert.equal(response.object, "ledger.openclaw.reimbursements");
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.outstandingAmount, 80);
  assert.equal(response.summary.outstandingAmount, 80);
  assert.equal(response.pageSummary.outstandingAmount, 80);
  assertAssistantContextSafe(response);
});

test("reimbursements response summary covers transactions beyond the page limit", () => {
  const response = buildOpenClawReimbursementsResponse([
    transaction({
      id: "tx-large",
      amount: -120,
      intent: "reimbursable",
      merchant: "Group Hotel"
    }),
    transaction({
      id: "tx-small",
      amount: -40,
      intent: "reimbursable",
      merchant: "Rideshare"
    })
  ], { limit: 1 });

  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.transactionId, "tx-large");
  assert.equal(response.pageSummary.outstandingAmount, 120);
  assert.equal(response.summary.outstandingAmount, 160);
  assertAssistantContextSafe(response);
});

test("safe-to-spend response is bounded and explainable", () => {
  const response = buildOpenClawSafeToSpendResponse(openClawSignalsFixture, { amount: 80 });

  assert.equal(response.object, "ledger.openclaw.safe_to_spend");
  assert.equal(response.amount, 80);
  assert.match(response.rationale, /\$80/);
  assertAssistantContextSafe(response);
});

test("OpenClaw read parsers validate bounded inputs", () => {
  assert.equal(parseOpenClawLimit("5"), 5);
  assert.equal(parseOpenClawLimit(null), 5);
  assert.throws(() => parseOpenClawLimit("26"), /limit/);
  assert.equal(parseSafeToSpendAmount("80.555"), 80.56);
  assert.equal(parseSafeToSpendAmount(null), null);
  assert.throws(() => parseSafeToSpendAmount("-1"), /amount/);
});
