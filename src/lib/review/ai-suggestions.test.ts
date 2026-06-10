import assert from "node:assert/strict";
import test from "node:test";
import type { TransactionAiSuggestion } from "@/lib/ai/types";
import type {
  CategoryRecord,
  EnrichedTransactionRow,
  RawTransactionRow,
  ReviewItemRow
} from "@/lib/db";
import { attachAiSuggestionsToReviewItems } from "./ai-suggestions";
import { hasReviewSuggestionValue, normalizeReviewSuggestion } from "./suggestions";

const userId = "11111111-1111-1111-1111-111111111111";

const category: CategoryRecord = {
  color: null,
  icon: null,
  id: "category-ai-tools",
  isSystem: true,
  name: "Software / AI Tools",
  parentId: null,
  userId
};

function transaction(input: Partial<EnrichedTransactionRow>): EnrichedTransactionRow {
  return {
    account_id: "account-checking",
    amount: -20,
    category_id: null,
    category_name: "Uncategorized",
    confidence: 0.42,
    created_at: "2026-05-06T12:00:00.000Z",
    date: "2026-05-06",
    id: "tx-openai",
    intent: "personal",
    is_recurring: false,
    merchant_name: "OpenAI",
    note: "",
    raw_transaction_id: "raw-openai",
    reviewed_at: null,
    source: "plaid",
    status: "posted",
    updated_at: "2026-05-06T12:00:00.000Z",
    user_id: userId,
    ...input
  };
}

function raw(input: Partial<RawTransactionRow>): RawTransactionRow {
  return {
    account_id: "account-checking",
    amount: -20,
    authorized_date: null,
    authorized_datetime: null,
    date: "2026-05-06",
    datetime: null,
    first_seen_at: "2026-05-06T12:00:00.000Z",
    id: "raw-openai",
    iso_currency_code: "USD",
    location: {},
    merchant_name: "OpenAI",
    name: "OPENAI *CHATGPT SUBSCRIPTION",
    payment_channel: "online",
    payment_meta: {},
    pending_transaction_id: null,
    plaid_category: "Service",
    plaid_category_id: null,
    plaid_item_id: "item-1",
    plaid_transaction_id: "plaid-tx-1",
    raw_payload: {},
    status: "posted",
    transaction_type: "place",
    updated_at: "2026-05-06T12:00:00.000Z",
    user_id: userId,
    ...input
  };
}

function reviewItem(input: Partial<ReviewItemRow>): ReviewItemRow {
  return {
    ai_suggestion: {},
    confidence: null,
    created_at: "2026-05-06T12:00:00.000Z",
    enriched_transaction_id: "tx-openai",
    explanation: "Needs AI cleanup.",
    id: "review-openai",
    reason: "low-confidence",
    resolution_kind: null,
    resolution_note: null,
    resolved_at: null,
    status: "open",
    updated_at: "2026-05-06T12:00:00.000Z",
    user_id: userId,
    ...input
  };
}

function suggestion(rawTransactionId: string): TransactionAiSuggestion {
  return {
    category: {
      confidence: 0.95,
      reason: "Known AI software subscription merchant.",
      source: "openai",
      value: {
        id: category.id,
        name: category.name
      }
    },
    confidence: 0.94,
    intent: {
      confidence: 0.92,
      reason: "Work software subscription.",
      source: "openai",
      value: "business"
    },
    merchantCleanup: {
      confidence: 0.96,
      reason: "Cleaned processor suffix.",
      source: "openai",
      value: {
        normalized: "OpenAI",
        original: "OPENAI *CHATGPT SUBSCRIPTION"
      }
    },
    provider: {
      id: "test-openai",
      kind: "openai",
      label: "Test OpenAI",
      version: "test"
    },
    rawTransactionId,
    reason: "OpenAI is a recognized AI software merchant.",
    recurring: {
      confidence: 0.88,
      reason: "Subscription wording.",
      source: "openai",
      value: true
    },
    signals: ["merchant:openai", "subscription"],
    suggestionId: "ai-review-test"
  };
}

test("attachAiSuggestionsToReviewItems stores accept-ready AI suggestions for non-peer review items", async () => {
  const items = [
    reviewItem({ id: "review-openai", reason: "low-confidence" }),
    reviewItem({
      enriched_transaction_id: "tx-venmo",
      id: "review-venmo",
      reason: "venmo"
    })
  ];
  const updates = await attachAiSuggestionsToReviewItems(items, {
    categories: [category],
    rawRows: [raw({ id: "raw-openai" }), raw({ id: "raw-venmo", merchant_name: "Venmo", name: "VENMO" })],
    suggestionService: {
      async suggestTransaction(request) {
        assert.equal(request.rawTransaction.id, "raw-openai");
        assert.deepEqual(Object.keys(request.rawTransaction).sort(), [
          "amount",
          "id",
          "iso_currency_code",
          "merchant_name",
          "name",
          "payment_channel",
          "plaid_category",
          "transaction_type"
        ]);
        const serialized = JSON.stringify(request.rawTransaction);
        assert.doesNotMatch(serialized, /raw_payload|payment_meta|location|plaid_item_id|plaid_transaction_id/i);
        return suggestion(request.rawTransaction.id);
      }
    },
    transactions: [
      transaction({ id: "tx-openai", raw_transaction_id: "raw-openai" }),
      transaction({ id: "tx-venmo", merchant_name: "Venmo", raw_transaction_id: "raw-venmo" })
    ]
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].item.id, "review-openai");
  assert.equal(updates[0].item.confidence, 0.94);

  const normalized = normalizeReviewSuggestion(updates[0].item.ai_suggestion);
  assert.equal(hasReviewSuggestionValue(normalized), true);
  assert.equal(normalized.categoryName, "Software / AI Tools");
  assert.equal(normalized.intent, "business");
  assert.equal(normalized.merchantName, "OpenAI");
  assert.equal(normalized.recurring, true);
});
