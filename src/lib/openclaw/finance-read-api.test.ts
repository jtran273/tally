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

test("recent transaction response redacts secret-shaped display text", () => {
  const response = buildOpenClawRecentTransactionsResponse([
    transaction({
      accountName: "Checking Bearer abcdefghijklmnop",
      merchant: "Cafe access-production-abcdefghijkl"
    })
  ], {
    generatedAt: "2026-05-21T12:00:00.000Z",
    limit: 5
  });

  assert.equal(response.transactions[0]?.accountNickname, "Checking [redacted]");
  assert.equal(response.transactions[0]?.merchant, "Cafe [redacted]");
  assert.doesNotMatch(JSON.stringify(response), /Bearer|access-production-abcdefghijkl/);
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

test("review items response redacts secret-shaped explanation and merchant text", () => {
  const response = buildOpenClawReviewItemsResponse([
    reviewItem({
      explanation: "Needs check service_role_key=abcdefghijkl",
      transaction: transaction({
        merchant: "Coffee sk-proj-abcdefghijklmnopqrst"
      })
    })
  ], { limit: 5 });

  assert.equal(response.items[0]?.explanation, "Needs check [redacted]");
  assert.equal(response.items[0]?.merchant, "Coffee [redacted]");
  assert.doesNotMatch(JSON.stringify(response), /service_role_key|sk-proj-abcdefghijklmnopqrst/);
  assertAssistantContextSafe(response);
});

test("reimbursements response surfaces outstanding reimbursable transactions", () => {
  const response = buildOpenClawReimbursementsResponse([
    transaction({
      id: "tx-dinner",
      amount: -80,
      intent: "reimbursable",
      merchant: "Dinner",
      reimbursements: [
        {
          counterparty: "Alex",
          dueDate: null,
          expectedAmount: 50,
          id: "reimb-alex",
          notes: null,
          receivedAmount: 10,
          receivedAt: "2026-05-08",
          receivedTransactionId: "tx-venmo",
          splitId: null,
          status: "requested",
          transactionId: "tx-dinner"
        }
      ]
    }),
    transaction({ id: "tx-normal" })
  ], { limit: 5 });

  assert.equal(response.object, "ledger.openclaw.reimbursements");
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.outstandingAmount, 40);
  assert.deepEqual(response.items[0]?.records, [
    {
      counterparty: "Alex",
      dueDate: null,
      expectedAmount: 50,
      outstandingAmount: 40,
      receivedAmount: 10,
      receivedAt: "2026-05-08",
      status: "requested"
    }
  ]);
  assert.equal(response.summary.outstandingAmount, 40);
  assert.equal(response.pageSummary.outstandingAmount, 40);
  assertAssistantContextSafe(response);
});

test("reimbursements response redacts secret-shaped merchant and counterparty text", () => {
  const response = buildOpenClawReimbursementsResponse([
    transaction({
      amount: -80,
      intent: "reimbursable",
      merchant: "Dinner postgres://secret.example/db",
      reimbursements: [
        {
          counterparty: "Ryan Bearer abcdefghijklmnop",
          dueDate: null,
          expectedAmount: 80,
          id: "reimb-ryan",
          notes: null,
          receivedAmount: 0,
          receivedAt: null,
          receivedTransactionId: null,
          splitId: null,
          status: "expected",
          transactionId: "tx-1"
        }
      ]
    })
  ], { limit: 5 });

  assert.equal(response.items[0]?.merchant, "Dinner [redacted]");
  assert.equal(response.items[0]?.records[0]?.counterparty, "Ryan [redacted]");
  assert.doesNotMatch(JSON.stringify(response), /postgres:\/\/secret\.example\/db|Bearer abcdefghijklmnop/);
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
