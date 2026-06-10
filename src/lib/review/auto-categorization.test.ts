import assert from "node:assert/strict";
import test from "node:test";
import type { CategoryRecord, Json } from "@/lib/db";
import {
  AUTO_CATEGORIZATION_CONFIDENCE_THRESHOLD,
  evaluateAutoCategorization
} from "./auto-categorization";

const userId = "11111111-1111-1111-1111-111111111111";
const reviewedAt = "2026-05-07T12:00:00.000Z";
const categories: CategoryRecord[] = [
  {
    color: null,
    icon: null,
    id: "cat-ai-tools",
    isSystem: true,
    name: "Software / AI Tools",
    parentId: null,
    userId
  },
  {
    color: null,
    icon: null,
    id: "cat-entertainment",
    isSystem: true,
    name: "Entertainment",
    parentId: null,
    userId
  },
  {
    color: null,
    icon: null,
    id: "cat-food",
    isSystem: true,
    name: "Food / Restaurants",
    parentId: null,
    userId
  }
];

function suggestion(overrides: Record<string, unknown> = {}): Json {
  return {
    category: {
      confidence: 0.95,
      reason: "Known AI software merchant.",
      source: "openai",
      value: {
        id: "cat-ai-tools",
        name: "Software / AI Tools"
      }
    },
    confidence: AUTO_CATEGORIZATION_CONFIDENCE_THRESHOLD,
    intent: {
      confidence: 0.94,
      reason: "Work software.",
      source: "openai",
      value: "business"
    },
    merchantCleanup: {
      confidence: 0.95,
      reason: "Normalized merchant.",
      source: "openai",
      value: {
        normalized: "OpenAI",
        original: "OPENAI *CHATGPT"
      }
    },
    reason: "Known AI software merchant.",
    signals: ["merchant cue: OPENAI"],
    ...overrides
  } as Json;
}

function deterministicSuggestion(overrides: Record<string, unknown> = {}): Json {
  return suggestion({
    category: {
      confidence: 0.96,
      reason: "Known bowling and entertainment venue merchant.",
      source: "merchant-cue",
      value: {
        id: "cat-entertainment",
        name: "Entertainment"
      }
    },
    confidence: 0.96,
    intent: {
      confidence: 0.96,
      reason: "Personal entertainment spend.",
      source: "merchant-cue",
      value: "personal"
    },
    merchantCleanup: {
      confidence: 0.96,
      reason: "Normalized merchant.",
      source: "merchant-cue",
      value: {
        normalized: "Lucky Strike",
        original: "LUCKY STRIKE BOWLING"
      }
    },
    provider: { id: "mock-deterministic", kind: "mock", label: "Mock", version: "mock-v1" },
    reason: "Known bowling and entertainment venue merchant.",
    signals: ["merchant cue: LUCKY STRIKE"],
    ...overrides
  });
}

function decision(overrides: Partial<Parameters<typeof evaluateAutoCategorization>[0]> = {}) {
  return evaluateAutoCategorization({
    categories,
    rawTransaction: {
      merchant_name: "OpenAI",
      name: "OPENAI *CHATGPT",
      status: "posted"
    },
    reviewReason: "missing-category",
    reviewedAt,
    suggestion: suggestion(),
    transaction: {
      amount: -20,
      id: "tx-openai",
      merchant_name: "OpenAI",
      status: "posted",
      user_id: userId
    },
    ...overrides
  });
}

test("evaluateAutoCategorization leaves OpenAI suggestions for explicit approval", () => {
  const result = decision();

  assert.equal(result.shouldApply, false);
  assert.equal(result.reason, "ai-suggestion-requires-approval");
  assert.equal(result.patch, null);
});

test("evaluateAutoCategorization auto-applies high-confidence Entertainment suggestions", () => {
  const result = decision({
    rawTransaction: {
      merchant_name: "Lucky Strike",
      name: "LUCKY STRIKE BOWLING",
      status: "posted"
    },
    suggestion: deterministicSuggestion(),
    trustedSuggestionSourceKind: "deterministic",
    transaction: {
      amount: -64,
      id: "tx-lucky-strike",
      merchant_name: "Lucky Strike",
      status: "posted",
      user_id: userId
    }
  });

  assert.equal(result.shouldApply, true);
  assert.equal(result.patch?.categoryId, "cat-entertainment");
  assert.equal(result.patch?.categoryName, "Entertainment");
  assert.equal(result.patch?.intent, "personal");
  assert.equal(result.patch?.merchantName, "Lucky Strike");
  assert.equal(result.patch?.reviewedAt, reviewedAt);
  assert.equal(result.patch?.source, "ai");
});

test("evaluateAutoCategorization leaves low-confidence OpenAI suggestions for approval", () => {
  const result = decision({
    suggestion: suggestion({ confidence: AUTO_CATEGORIZATION_CONFIDENCE_THRESHOLD - 0.01 })
  });

  assert.equal(result.shouldApply, false);
  assert.equal(result.reason, "ai-suggestion-requires-approval");
});

test("evaluateAutoCategorization leaves peer-to-peer transactions for review", () => {
  assert.equal(decision({
    rawTransaction: {
      merchant_name: "Venmo",
      name: "VENMO PAYMENT",
      status: "posted"
    },
    transaction: {
      amount: -20,
      id: "tx-venmo",
      merchant_name: "Venmo",
      status: "posted",
      user_id: userId
    }
  }).reason, "peer-to-peer");
});

test("evaluateAutoCategorization leaves high-confidence large OpenAI suggestions for review", () => {
  const result = decision({
    transaction: {
      amount: -750,
      id: "tx-large",
      merchant_name: "OpenAI",
      status: "posted",
      user_id: userId
    }
  });

  assert.equal(result.shouldApply, false);
  assert.equal(result.reason, "ai-suggestion-requires-approval");
});

test("evaluateAutoCategorization keeps deterministic low-confidence suggestions in review", () => {
  const result = decision({
    suggestion: deterministicSuggestion({ confidence: AUTO_CATEGORIZATION_CONFIDENCE_THRESHOLD - 0.01 }),
    trustedSuggestionSourceKind: "deterministic"
  });

  assert.equal(result.shouldApply, false);
  assert.equal(result.reason, "low-confidence");
});

test("evaluateAutoCategorization keeps deterministic manual-intent suggestions in review", () => {
  const result = decision({
    suggestion: deterministicSuggestion({
      intent: {
        confidence: 0.95,
        reason: "Needs split context.",
        source: "merchant-cue",
        value: "shared"
      }
    }),
    trustedSuggestionSourceKind: "deterministic"
  });

  assert.equal(result.shouldApply, false);
  assert.equal(result.reason, "manual-intent");
});

test("evaluateAutoCategorization keeps deterministic unknown categories in review", () => {
  const result = decision({
    suggestion: deterministicSuggestion({
      category: {
        confidence: 0.95,
        reason: "Unknown category.",
        source: "merchant-cue",
        value: {
          id: "cat-missing",
          name: "Mystery"
        }
      }
    }),
    trustedSuggestionSourceKind: "deterministic"
  });

  assert.equal(result.shouldApply, false);
  assert.equal(result.reason, "unknown-category");
});

test("evaluateAutoCategorization requires approval for review-rule suggestions", () => {
  const result = decision({
    suggestion: {
      category: {
        confidence: 0.95,
        reason: "Looks like software.",
        value: {
          id: "cat-ai-tools",
          name: "Software / AI Tools"
        }
      },
      confidence: 0.95,
      intent: {
        confidence: 0.95,
        reason: "Looks business related.",
        value: "business"
      },
      merchantCleanup: {
        confidence: 0.95,
        reason: "Normalized merchant.",
        value: {
          normalized: "OpenAI",
          original: "OPENAI *CHATGPT"
        }
      },
      reason: "Review rule generated this suggestion."
    } as Json,
    trustedSuggestionSourceKind: "review-rule"
  });

  assert.equal(result.shouldApply, false);
  assert.equal(result.reason, "ai-suggestion-requires-approval");
});

test("evaluateAutoCategorization does not trust forged local source fields without local provider", () => {
  const result = decision({
    suggestion: deterministicSuggestion({
      provider: { id: "openai", kind: "openai", label: "OpenAI", version: "v1" }
    }),
    trustedSuggestionSourceKind: "openai"
  });

  assert.equal(result.shouldApply, false);
  assert.equal(result.reason, "ai-suggestion-requires-approval");
});

test("evaluateAutoCategorization does not auto-apply source-only local-looking suggestions", () => {
  const result = decision({
    suggestion: deterministicSuggestion({ provider: undefined })
  });

  assert.equal(result.shouldApply, false);
  assert.equal(result.reason, "ai-suggestion-requires-approval");
});

test("evaluateAutoCategorization ignores forged mock provider payload without trusted provenance", () => {
  const result = decision({
    suggestion: deterministicSuggestion()
  });

  assert.equal(result.shouldApply, false);
  assert.equal(result.reason, "ai-suggestion-requires-approval");
});

test("evaluateAutoCategorization keeps OpenAI manual-intent and unknown categories approval-gated", () => {
  assert.equal(decision({
    suggestion: suggestion({
      intent: {
        confidence: 0.95,
        reason: "Needs split context.",
        source: "openai",
        value: "shared"
      }
    })
  }).reason, "ai-suggestion-requires-approval");

  assert.equal(decision({
    suggestion: suggestion({
      category: {
        confidence: 0.95,
        reason: "Unknown category.",
        source: "openai",
        value: {
          id: "cat-missing",
          name: "Mystery"
        }
      }
    })
  }).reason, "ai-suggestion-requires-approval");
});
