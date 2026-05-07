import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuditEventRow,
  CategoryRecord,
  ReviewItemRecord,
  ReviewQueueItem,
  ReviewReason,
  ReviewStatus,
  TransactionRecord
} from "@/lib/db";
import {
  buildAiBulkPreviewMetrics,
  deriveReviewProductivityMetrics
} from "./productivity-metrics";

const userId = "11111111-1111-1111-1111-111111111111";

function category(id: string, name: string): CategoryRecord {
  return { color: null, icon: null, id, isSystem: true, name, parentId: null, userId };
}

const categories = [
  category("cat-ai", "Software / AI Tools"),
  category("cat-food", "Food / Restaurants")
];

function aiSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    category: {
      value: { id: "cat-ai", name: "Software / AI Tools" }
    },
    confidence: 0.94,
    intent: { value: "business" },
    provider: { id: "mock-deterministic", kind: "mock", label: "Mock" },
    reason: "Known software merchant.",
    ...overrides
  };
}

function transaction(input: Partial<TransactionRecord> & Pick<TransactionRecord, "id" | "merchant">): TransactionRecord {
  const { id, merchant, ...overrides } = input;

  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Checking",
    amount: -20,
    category: "Software / AI Tools",
    categoryId: "cat-ai",
    confidence: 0.8,
    date: "2026-05-06",
    id,
    institutionName: "Seed Bank",
    intent: "business",
    merchant,
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidName: null,
    plaidTransactionId: `plaid-${id}`,
    rawTransactionId: `raw-${id}`,
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId,
    ...overrides
  };
}

function reviewItem(input: {
  id: string;
  reason?: ReviewReason;
  status?: ReviewStatus;
  transaction: TransactionRecord;
  aiSuggestion?: ReviewQueueItem["aiSuggestion"];
  resolutionNote?: string | null;
}): ReviewQueueItem {
  const review: ReviewItemRecord = {
    aiSuggestion: input.aiSuggestion ?? aiSuggestion(),
    confidence: 0.91,
    createdAt: "2026-05-06T12:00:00.000Z",
    explanation: "Fixture review.",
    id: input.id,
    reason: input.reason ?? "low-confidence",
    resolutionNote: input.resolutionNote ?? null,
    resolvedAt: input.status && input.status !== "open" ? "2026-05-06T13:00:00.000Z" : null,
    status: input.status ?? "open",
    transactionId: input.transaction.id
  };
  return { ...review, transaction: { ...input.transaction, reviewItems: [review] } };
}

function auditEvent(input: Partial<AuditEventRow> & Pick<AuditEventRow, "action">): AuditEventRow {
  const { action, ...overrides } = input;

  return {
    action,
    actor_id: userId,
    after_data: null,
    before_data: null,
    created_at: "2026-05-06T14:00:00.000Z",
    entity_id: null,
    entity_table: "review_items",
    id: `audit-${action}`,
    metadata: {},
    user_id: userId,
    ...overrides
  };
}

test("deriveReviewProductivityMetrics: counts accepted, dismissed, edited, and repeated avoided work", () => {
  const acceptedTx = transaction({ id: "tx-accepted", merchant: "OpenAI" });
  const dismissedTx = transaction({ category: "Food / Restaurants", categoryId: "cat-food", id: "tx-dismissed", merchant: "Cafe" });
  const editedTx = transaction({ id: "tx-edited", merchant: "Cursor" });
  const accepted = reviewItem({ id: "review-accepted", status: "resolved", transaction: acceptedTx });
  const dismissed = reviewItem({ id: "review-dismissed", status: "dismissed", transaction: dismissedTx });
  const edited = reviewItem({ id: "review-edited", transaction: editedTx });

  const metrics = deriveReviewProductivityMetrics({
    auditEvents: [
      auditEvent({ action: "review.suggestion_accepted", entity_id: accepted.id }),
      auditEvent({ action: "review.dismissed", entity_id: dismissed.id }),
      auditEvent({
        action: "transaction.enrichment_updated",
        entity_id: editedTx.id,
        entity_table: "enriched_transactions",
        metadata: { transactionId: editedTx.id }
      }),
      auditEvent({ action: "merchant_rule.ai_accepted_upserted", entity_id: "rule-openai", entity_table: "merchant_rules" })
    ],
    reviewItems: [accepted, dismissed, edited]
  });

  assert.equal(metrics.acceptedSuggestions, 1);
  assert.equal(metrics.dismissedSuggestions, 1);
  assert.equal(metrics.editedReviews, 1);
  assert.equal(metrics.repeatedReviewsAvoided, 1);
  assert.equal(metrics.savingsScore, 2);
  assert.deepEqual(metrics.byReason, [{ count: 3, label: "low-confidence" }]);
  assert.equal(metrics.byMerchant[0]?.label, "Cafe");
  assert(metrics.byProvider.some((group) => group.label === "Mock"));
});

test("deriveReviewProductivityMetrics: falls back to resolved review notes without audit rows", () => {
  const acceptedTx = transaction({ id: "tx-accepted", merchant: "OpenAI" });
  const accepted = reviewItem({
    id: "review-accepted",
    resolutionNote: "Accepted suggestion fields: category, intent.",
    status: "resolved",
    transaction: acceptedTx
  });

  const metrics = deriveReviewProductivityMetrics({
    auditEvents: [],
    reviewItems: [accepted]
  });

  assert.equal(metrics.acceptedSuggestions, 1);
  assert.equal(metrics.repeatedReviewsAvoided, 0);
});

test("buildAiBulkPreviewMetrics: skips peer-to-peer, missing suggestions, and stale categories", () => {
  const ready = reviewItem({ id: "review-ready", transaction: transaction({ id: "tx-ready", merchant: "OpenAI" }) });
  const peerToPeer = reviewItem({
    id: "review-p2p",
    reason: "venmo",
    transaction: transaction({ id: "tx-p2p", merchant: "Venmo" })
  });
  const missing = reviewItem({
    aiSuggestion: { reason: "Needs review." },
    id: "review-missing",
    transaction: transaction({ id: "tx-missing", merchant: "Unknown" })
  });
  const stale = reviewItem({
    aiSuggestion: aiSuggestion({
      category: { value: { id: "cat-deleted", name: "Deleted Category" } }
    }),
    id: "review-stale",
    transaction: transaction({ id: "tx-stale", merchant: "Old Rule" })
  });

  const preview = buildAiBulkPreviewMetrics([ready, peerToPeer, missing, stale], categories);

  assert.equal(preview.eligible, 3);
  assert.equal(preview.acceptReady, 1);
  assert.deepEqual(preview.skipped, {
    "missing-suggestion": 1,
    "peer-to-peer": 1,
    "stale-category": 1
  });
});
