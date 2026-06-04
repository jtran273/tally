import assert from "node:assert/strict";
import { test } from "node:test";
import type { MerchantRuleRow, ReviewItemRecord } from "@/lib/db";
import {
  buildEnrichedMerchantCounts,
  hasAiSuggestion,
  isResolvedAccept,
  isResolvedEdit,
  summarizeAiReviewQuality
} from "./quality";

function review(overrides: Partial<ReviewItemRecord> = {}): ReviewItemRecord {
  return {
    id: "rev-1",
    transactionId: "tx-1",
    reason: "low-confidence",
    status: "open",
    explanation: "needs review",
    aiSuggestion: { merchantName: "Aldi", categoryName: "Groceries", confidence: 0.91 },
    confidence: 0.4,
    resolvedAt: null,
    resolutionNote: null,
    resolutionKind: null,
    createdAt: "2026-05-01T00:00:00Z",
    ...overrides
  };
}

function rule(overrides: Partial<MerchantRuleRow> = {}): MerchantRuleRow {
  return {
    id: "rule-1",
    user_id: "user-1",
    merchant_pattern: "Aldi",
    normalized_merchant_name: "aldi",
    category_id: null,
    intent: null,
    is_recurring: null,
    min_amount: null,
    max_amount: null,
    priority: 0,
    enabled: true,
    notes: "ai_accepted_upsert",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides
  };
}

test("hasAiSuggestion returns true only for non-empty suggestion objects", () => {
  assert.equal(hasAiSuggestion({}), false);
  assert.equal(hasAiSuggestion(null), false);
  assert.equal(hasAiSuggestion({ merchantName: "" }), false);
  assert.equal(hasAiSuggestion({ merchantName: "Coffee" }), true);
});

test("isResolvedAccept / isResolvedEdit prefer structured resolution kind with note fallback", () => {
  assert.equal(isResolvedAccept({ status: "resolved", resolutionKind: "accepted_ai", resolutionNote: "Edited later" }), true);
  assert.equal(isResolvedAccept({ status: "resolved", resolutionKind: null, resolutionNote: null }), true);
  assert.equal(isResolvedAccept({ status: "resolved", resolutionKind: null, resolutionNote: "Manually edited" }), false);
  assert.equal(isResolvedEdit({ status: "resolved", resolutionKind: "edited", resolutionNote: "Accepted" }), true);
  assert.equal(isResolvedEdit({ status: "dismissed", resolutionKind: "dismissed", resolutionNote: "Edited" }), false);
});

test("summarizeAiReviewQuality counts accepted, dismissed, edited, and skips open items", () => {
  const summary = summarizeAiReviewQuality({
    reviews: [
      { review: review({ id: "r1", status: "resolved", resolutionKind: "accepted_ai" }), merchant: "Aldi", category: "Groceries" },
      { review: review({ id: "r2", status: "dismissed", resolutionKind: "dismissed" }), merchant: "Aldi", category: "Groceries" },
      { review: review({ id: "r3", status: "resolved", resolutionKind: "edited" }), merchant: "Spotify", category: "Subscriptions" },
      { review: review({ id: "r4", status: "open" }), merchant: "X", category: "Y" },
      { review: review({ id: "r5", status: "resolved", aiSuggestion: {} }) }
    ],
    merchantRules: [],
    enrichedMerchantCounts: new Map()
  });

  assert.equal(summary.totalReviewedWithSuggestion, 3);
  assert.equal(summary.acceptedCount, 1);
  assert.equal(summary.dismissedCount, 1);
  assert.equal(summary.editedCount, 1);
  assert.equal(summary.openCount, 1);
  assert.equal(Math.round(summary.acceptanceRate * 100), 33);
  assert.equal(summary.byMerchant[0]?.label, "Aldi");
  assert.equal(summary.byMerchant[0]?.total, 2);
});

test("summarizeAiReviewQuality estimates reviews avoided from AI-derived rules", () => {
  const summary = summarizeAiReviewQuality({
    reviews: [],
    merchantRules: [
      rule({ id: "ai-1", normalized_merchant_name: "aldi", notes: "ai_accepted_upsert" }),
      rule({ id: "ai-2", normalized_merchant_name: "spotify", notes: "ai" }),
      rule({ id: "manual", normalized_merchant_name: "rent", notes: "manual" })
    ],
    enrichedMerchantCounts: buildEnrichedMerchantCounts([
      { merchant_name: "Aldi" },
      { merchant_name: "Aldi" },
      { merchant_name: "Aldi" },
      { merchant_name: "Spotify" },
      { merchant_name: "Rent" }
    ])
  });

  assert.equal(summary.aiDerivedRuleCount, 2);
  assert.equal(summary.estimatedReviewsAvoided, 2);
});
