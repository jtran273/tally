import assert from "node:assert/strict";
import test from "node:test";
import type { CategoryRecord, Json } from "@/lib/db";
import {
  buildAcceptedReviewSuggestionPatch,
  describeReviewSuggestionRefresh,
  hasReviewSuggestionValue,
  normalizeReviewSuggestion
} from "./suggestions";

const userId = "11111111-1111-1111-1111-111111111111";

function cat(id: string, name: string): CategoryRecord {
  return { color: null, icon: null, id, isSystem: true, name, parentId: null, userId };
}

const categories = [
  cat("cat-ai", "Software / AI Tools"),
  cat("cat-food", "Food / Restaurants"),
  cat("cat-transfer", "Transfer")
];

// Simulates the serialized shape that TransactionAiSuggestion produces after JSON round-trip.
function mockAiSuggestion(overrides: Record<string, unknown> = {}): Json {
  return {
    category: {
      confidence: 0.95,
      reason: "Known AI software subscription merchant.",
      source: "merchant-cue",
      value: { id: "cat-ai", name: "Software / AI Tools" }
    },
    confidence: 0.94,
    intent: {
      confidence: 0.92,
      reason: "Business software.",
      source: "merchant-cue",
      value: "business"
    },
    merchantCleanup: {
      confidence: 0.96,
      reason: "Normalized name.",
      source: "merchant-cue",
      value: { normalized: "OpenAI", original: "OPENAI *CHATGPT" }
    },
    provider: { id: "mock-deterministic", kind: "mock", label: "Mock", version: "mock-v1" },
    rawTransactionId: "raw-openai",
    reason: "Known AI software subscription merchant.",
    recurring: {
      confidence: 0.9,
      reason: "Subscription merchant.",
      source: "merchant-cue",
      value: true
    },
    signals: ["merchant cue: OPENAI"],
    suggestionId: "mock-abc123",
    ...overrides
  } as Json;
}

test("normalizeReviewSuggestion: extracts all fields from serialized TransactionAiSuggestion", () => {
  const result = normalizeReviewSuggestion(mockAiSuggestion());

  assert.equal(result.categoryName, "Software / AI Tools");
  assert.equal(result.categoryId, "cat-ai");
  assert.equal(result.intent, "business");
  assert.equal(result.merchantName, "OpenAI");
  assert.equal(result.recurring, true);
  assert.equal(result.confidence, 0.94);
  assert.equal(result.reason, "Known AI software subscription merchant.");
  assert.equal(result.sourceKind, "deterministic");
  assert.equal(result.sourceLabel, "Deterministic heuristics");
  assert.deepEqual(result.signals, ["merchant cue: OPENAI"]);
});

test("normalizeReviewSuggestion: labels OpenAI provider suggestions", () => {
  const result = normalizeReviewSuggestion(mockAiSuggestion({
    category: {
      confidence: 0.95,
      reason: "Model matched merchant context.",
      source: "openai",
      value: { id: "cat-ai", name: "Software / AI Tools" }
    },
    provider: { id: "openai", kind: "openai", label: "OpenAI", version: "gpt-test" }
  }));

  assert.equal(result.sourceKind, "openai");
  assert.equal(result.sourceLabel, "OpenAI");
  assert.match(result.sourceDetail ?? "", /configured OpenAI provider/);
});

test("normalizeReviewSuggestion: labels saved merchant rule suggestions", () => {
  const result = normalizeReviewSuggestion(mockAiSuggestion({
    category: {
      confidence: 0.98,
      reason: "Matched a saved rule.",
      source: "merchant-rule",
      value: { id: "cat-food", name: "Food / Restaurants" }
    },
    provider: undefined
  }));

  assert.equal(result.sourceKind, "merchant-rule");
  assert.equal(result.sourceLabel, "Saved merchant rule");
});

test("normalizeReviewSuggestion: handles flat categoryName string", () => {
  const result = normalizeReviewSuggestion({ categoryName: "Food / Restaurants" } as Json);

  assert.equal(result.categoryName, "Food / Restaurants");
  assert.equal(result.categoryId, undefined);
});

test("normalizeReviewSuggestion: handles flat intent string", () => {
  const result = normalizeReviewSuggestion({ intent: "personal" } as Json);
  assert.equal(result.intent, "personal");
});

test("normalizeReviewSuggestion: rejects unknown intent value", () => {
  const result = normalizeReviewSuggestion({ intent: "invalid-intent" } as Json);
  assert.equal(result.intent, undefined);
});

test("normalizeReviewSuggestion: handles nested recurring boolean", () => {
  const withRecurring = normalizeReviewSuggestion(mockAiSuggestion({ recurring: { value: false, confidence: 0.8 } }));
  assert.equal(withRecurring.recurring, false);

  const noRecurring = normalizeReviewSuggestion(mockAiSuggestion({ recurring: undefined }));
  assert.equal(noRecurring.recurring, undefined);
});

test("normalizeReviewSuggestion: handles flat merchantName string", () => {
  const result = normalizeReviewSuggestion({ merchantName: "Whole Foods" } as Json);
  assert.equal(result.merchantName, "Whole Foods");
});

test("normalizeReviewSuggestion: handles heuristic-only suggestion payload (no rich fields)", () => {
  const result = normalizeReviewSuggestion({
    reason: "Choose the right category before counting this transaction as trusted.",
    signals: ["plaid-category-missing"]
  } as Json);

  assert.equal(result.categoryName, undefined);
  assert.equal(result.intent, undefined);
  assert.equal(result.merchantName, undefined);
  assert.equal(result.recurring, undefined);
  assert.equal(result.sourceKind, "review-rule");
  assert.equal(result.sourceLabel, "Review rule");
  assert.deepEqual(result.signals, ["plaid-category-missing"]);
});

test("normalizeReviewSuggestion: filters provider diagnostics out of user-facing signals", () => {
  const result = normalizeReviewSuggestion({
    categoryName: "Food / Restaurants",
    signals: [
      "merchant cue: cafe",
      "OpenAI unavailable or returned no additional signals"
    ]
  } as Json);

  assert.deepEqual(result.signals, ["merchant cue: cafe"]);
});

test("normalizeReviewSuggestion: empty object returns empty suggestion", () => {
  const result = normalizeReviewSuggestion({} as Json);

  assert.equal(result.categoryName, undefined);
  assert.equal(result.intent, undefined);
  assert.equal(result.merchantName, undefined);
  assert.equal(result.recurring, undefined);
  assert.deepEqual(result.signals, []);
});

test("hasReviewSuggestionValue: true when any meaningful field is present", () => {
  assert.equal(hasReviewSuggestionValue({ categoryName: "Food / Restaurants", signals: [] }), true);
  assert.equal(hasReviewSuggestionValue({ intent: "business", signals: [] }), true);
  assert.equal(hasReviewSuggestionValue({ merchantName: "OpenAI", signals: [] }), true);
  assert.equal(hasReviewSuggestionValue({ recurring: true, signals: [] }), true);
  assert.equal(hasReviewSuggestionValue({ confidence: 0.9, signals: [] }), true);
});

test("hasReviewSuggestionValue: false for heuristic-only payload", () => {
  assert.equal(hasReviewSuggestionValue({ reason: "Some reason", signals: ["signal"] }), false);
  assert.equal(hasReviewSuggestionValue({ signals: [] }), false);
});

test("describeReviewSuggestionRefresh: describes generated source and changed fields", () => {
  const before = normalizeReviewSuggestion({
    reason: "Choose the right category.",
    signals: ["plaid-category-missing"]
  } as Json);
  const after = normalizeReviewSuggestion(mockAiSuggestion({
    provider: { id: "openai", kind: "openai", label: "OpenAI", version: "gpt-test" }
  }));

  assert.equal(
    describeReviewSuggestionRefresh(before, after),
    "Suggestion generated: updated merchant, category, intent, recurring, confidence. Source: OpenAI."
  );
});

test("describeReviewSuggestionRefresh: describes refreshes with no field changes", () => {
  const before = normalizeReviewSuggestion(mockAiSuggestion());
  const after = normalizeReviewSuggestion(mockAiSuggestion());

  assert.equal(
    describeReviewSuggestionRefresh(before, after),
    "Suggestion refreshed: no accept-ready fields changed. Source: Deterministic heuristics."
  );
});

test("buildAcceptedReviewSuggestionPatch: uses known category ID when valid", () => {
  const { patch } = buildAcceptedReviewSuggestionPatch(mockAiSuggestion(), categories, {
    reviewedAt: "2026-05-06T12:00:00.000Z"
  });

  assert.equal(patch.categoryId, "cat-ai");
  assert.equal(patch.categoryName, "Software / AI Tools");
  assert.equal(patch.intent, "business");
  assert.equal(patch.merchantName, "OpenAI");
  assert.equal(patch.isRecurring, true);
  assert.equal(patch.confidence, 0.94);
  assert.equal(patch.reviewedAt, "2026-05-06T12:00:00.000Z");
  assert.equal(patch.source, "ai");
});

test("buildAcceptedReviewSuggestionPatch: falls back to name lookup when category ID is stale", () => {
  const staleId = mockAiSuggestion({
    category: {
      confidence: 0.9,
      reason: "Test.",
      source: "openai",
      value: { id: "cat-deleted-uuid", name: "Food / Restaurants" }
    }
  });

  const { patch } = buildAcceptedReviewSuggestionPatch(staleId, categories, {
    reviewedAt: "2026-05-06T12:00:00.000Z"
  });

  assert.equal(patch.categoryId, "cat-food", "Should resolve by name when ID is unknown");
  assert.equal(patch.categoryName, "Food / Restaurants");
});

test("buildAcceptedReviewSuggestionPatch: null category ID resolves by name", () => {
  const noId = mockAiSuggestion({
    category: {
      confidence: 0.88,
      reason: "Test.",
      source: "mock",
      value: { id: null, name: "Transfer" }
    }
  });

  const { patch } = buildAcceptedReviewSuggestionPatch(noId, categories, {
    reviewedAt: "2026-05-06T12:00:00.000Z"
  });

  assert.equal(patch.categoryId, "cat-transfer");
  assert.equal(patch.categoryName, "Transfer");
});

test("buildAcceptedReviewSuggestionPatch: sets source to ai", () => {
  const { patch } = buildAcceptedReviewSuggestionPatch(mockAiSuggestion(), categories, {
    reviewedAt: "2026-05-06T12:00:00.000Z"
  });

  assert.equal(patch.source, "ai");
});
