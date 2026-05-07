import assert from "node:assert/strict";
import test from "node:test";
import type { Json, ReviewQueueItem, ReviewReason, TransactionRecord } from "@/lib/db";
import { buildBulkReviewPlan } from "./bulk-actions";

function transaction(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    accountId: "account-hidden",
    accountMask: "1234",
    accountName: "Checking",
    amount: -42.5,
    category: "Uncategorized",
    categoryId: null,
    confidence: 0.3,
    date: "2026-05-07",
    id: "tx-test",
    institutionName: "Bank",
    intent: "personal",
    merchant: "OpenAI *ChatGPT",
    note: "",
    plaidCategory: "Service",
    plaidMerchant: "OpenAI",
    plaidName: "OPENAI *CHATGPT",
    plaidTransactionId: "plaid-hidden",
    rawTransactionId: "raw-hidden",
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: "missing-category",
    reviewStatus: "open",
    splits: [],
    status: "posted",
    userId: "user-test",
    ...overrides
  };
}

function reviewItem(
  id: string,
  reason: ReviewReason,
  aiSuggestion: Json,
  transactionOverrides: Partial<TransactionRecord> = {}
): ReviewQueueItem {
  const tx = transaction({ id: `tx-${id}`, ...transactionOverrides });
  return {
    aiSuggestion,
    confidence: 0.8,
    createdAt: "2026-05-07T12:00:00.000Z",
    explanation: "Needs review.",
    id,
    reason,
    resolvedAt: null,
    resolutionNote: null,
    status: "open",
    transaction: tx,
    transactionId: tx.id
  };
}

test("buildBulkReviewPlan marks only non-manual items with suggestions as accept-ready", () => {
  const plan = buildBulkReviewPlan([
    reviewItem("ready", "missing-category", {
      categoryName: "Software",
      confidence: 0.91,
      intent: "business",
      merchantName: "OpenAI",
      recurring: true
    } as Json),
    reviewItem("manual", "venmo", { categoryName: "Dining" } as Json),
    reviewItem("empty", "low-confidence", { reason: "Not enough signal." } as Json)
  ]);

  assert.deepEqual(plan.acceptReady.map((item) => item.reviewItemId), ["ready"]);
  assert.equal(plan.skipped.length, 2);
  assert.equal(plan.skipped[0]?.skipReason, "Manual-only peer-to-peer item.");
  assert.equal(plan.skipped[1]?.skipReason, "No accept-ready AI suggestion.");
});

test("buildBulkReviewPlan exposes a safe per-item preview without account or provider identifiers", () => {
  const [item] = buildBulkReviewPlan([
    reviewItem("ready", "missing-category", {
      categoryName: "Software",
      confidence: 0.91,
      intent: "business",
      merchantName: "OpenAI"
    } as Json)
  ]).items;

  assert.ok(item);
  assert.equal(item.preview.current.merchantName, "OpenAI *ChatGPT");
  assert.equal(item.preview.suggested.merchantName, "OpenAI");
  assert.equal(item.preview.suggested.categoryName, "Software");
  assert.equal("accountId" in item, false);
  assert.equal("accountMask" in item, false);
  assert.equal("plaidTransactionId" in item, false);
  assert.equal("rawTransactionId" in item, false);
});
