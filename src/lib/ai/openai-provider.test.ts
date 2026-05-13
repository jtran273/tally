import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAiSuggestionAdapter } from "./openai-provider";
import type {
  AiSuggestionAdapter,
  ReimbursementCandidateAiSuggestion,
  ReimbursementCandidateAiRequest,
  TransactionAiSuggestion,
  TransactionSuggestionRequest
} from "./types";

const baseline: TransactionAiSuggestion = {
  category: {
    confidence: 0.95,
    reason: "Known AI merchant.",
    source: "merchant-cue",
    value: {
      id: "cat-ai",
      name: "Software / AI Tools"
    }
  },
  confidence: 0.94,
  intent: {
    confidence: 0.94,
    reason: "Known AI merchant.",
    source: "merchant-cue",
    value: "business"
  },
  merchantCleanup: {
    confidence: 0.95,
    reason: "Normalized merchant.",
    source: "merchant-cue",
    value: {
      normalized: "OpenAI",
      original: "OPENAI *CHATGPT"
    }
  },
  provider: {
    id: "mock-deterministic",
    kind: "mock",
    label: "Mock",
    version: "mock-v1"
  },
  rawTransactionId: "raw-openai",
  reason: "Known AI merchant.",
  recurring: {
    confidence: 0.9,
    reason: "Subscription merchant.",
    source: "merchant-cue",
    value: true
  },
  signals: ["merchant cue: OPENAI"],
  suggestionId: "mock-openai"
};

const fallback: AiSuggestionAdapter = {
  descriptor: baseline.provider,
  async suggestReimbursementCandidate() {
    return reimbursementBaseline;
  },
  async suggestTransaction() {
    return baseline;
  }
};

const reimbursementBaseline: ReimbursementCandidateAiSuggestion = {
  confidence: 0.72,
  provider: baseline.provider,
  question: "Was Ace Hotel reimbursable or split with someone?",
  reason: "Nearby peer-payment inflow.",
  signals: ["nearby peer-payment inflow"],
  suggestedInflowIds: ["tx-zelle"],
  suggestedIntent: "reimbursable",
  suggestionId: "mock-reimbursement",
  targetTransactionId: "tx-hotel"
};

const reimbursementRequest: ReimbursementCandidateAiRequest = {
  candidateInflows: [{
    amount: 120,
    category: "Uncategorized",
    date: "2026-05-05",
    id: "tx-zelle",
    merchant: "Zelle Alex"
  }],
  heuristicConfidence: 0.68,
  heuristicReasons: ["Nearby positive inflow could be a reimbursement."],
  transaction: {
    amount: -240,
    category: "Travel / Hotel",
    date: "2026-05-01",
    id: "tx-hotel",
    intent: "personal",
    merchant: "Ace Hotel"
  }
};

const reimbursementRequestWithExtraInflow: ReimbursementCandidateAiRequest = {
  ...reimbursementRequest,
  candidateInflows: [
    ...reimbursementRequest.candidateInflows,
    {
      amount: 80,
      category: "Uncategorized",
      date: "2026-05-06",
      id: "tx-paypal",
      merchant: "PayPal Jamie"
    }
  ]
};

const request: TransactionSuggestionRequest = {
  categories: [
    {
      color: null,
      icon: null,
      id: "cat-ai",
      isSystem: true,
      name: "Software / AI Tools",
      parentId: null,
      userId: "user-test"
    }
  ],
  rawTransaction: {
    amount: -20,
    id: "raw-openai",
    iso_currency_code: "USD",
    merchant_name: "OpenAI",
    name: "OPENAI *CHATGPT",
    payment_channel: "online",
    plaid_category: "Service",
    transaction_type: "place"
  }
};

async function withMockedFetch<T>(
  handler: typeof globalThis.fetch,
  callback: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  globalThis.fetch = handler;
  console.warn = () => undefined;

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

function adapter() {
  return createOpenAiSuggestionAdapter({
    apiKey: "sk-test",
    fallback,
    model: "gpt-test"
  });
}

test("OpenAI adapter uses fallback signals when model returns no signals array", async () => {
  const suggestion = await withMockedFetch(
    async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        categoryName: "Software / AI Tools",
        confidence: 0.96,
        intent: "business",
        merchantName: "OpenAI",
        reason: "Known AI software merchant.",
        recurring: true
      }),
      status: "completed"
    }), { status: 200 }),
    () => adapter().suggestTransaction(request)
  );

  assert.equal(suggestion.provider.kind, "openai");
  assert.deepEqual(suggestion.signals, baseline.signals);
  assert.equal(suggestion.signals.includes("OpenAI unavailable or returned no additional signals"), false);
});

test("OpenAI adapter falls back when the response is incomplete or empty", async () => {
  const incomplete = await withMockedFetch(
    async () => new Response(JSON.stringify({
      incomplete_details: { reason: "max_output_tokens" },
      status: "incomplete"
    }), { status: 200 }),
    () => adapter().suggestTransaction(request)
  );

  assert.equal(incomplete.provider.kind, "mock");
  assert.equal(incomplete, baseline);

  const empty = await withMockedFetch(
    async () => new Response(JSON.stringify({
      status: "completed"
    }), { status: 200 }),
    () => adapter().suggestTransaction(request)
  );

  assert.equal(empty.provider.kind, "mock");
  assert.equal(empty, baseline);
});

test("OpenAI adapter falls back on provider HTTP failures", async () => {
  const suggestion = await withMockedFetch(
    async () => new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }),
    () => adapter().suggestTransaction(request)
  );

  assert.equal(suggestion.provider.kind, "mock");
  assert.equal(suggestion, baseline);
});

test("OpenAI adapter can refine reimbursement candidate suggestions", async () => {
  const suggestion = await withMockedFetch(
    async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        confidence: 0.84,
        question: "Was Ace Hotel split with Alex?",
        reason: "Hotel charge followed by Zelle from Alex.",
        signals: ["hotel charge", "nearby Zelle"],
        suggestedInflowIds: ["tx-zelle"],
        suggestedIntent: "shared"
      }),
      status: "completed"
    }), { status: 200 }),
    () => adapter().suggestReimbursementCandidate!(reimbursementRequest)
  );

  assert.equal(suggestion.provider.kind, "openai");
  assert.equal(suggestion.suggestedIntent, "shared");
  assert.deepEqual(suggestion.suggestedInflowIds, ["tx-zelle"]);
  assert.equal(suggestion.question, "Was Ace Hotel split with Alex?");
  assert.equal(suggestion.confidence, 0.84);
});

test("OpenAI adapter preserves an empty reimbursement inflow selection", async () => {
  const suggestion = await withMockedFetch(
    async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        confidence: 0.6,
        question: "Was Ace Hotel reimbursable?",
        reason: "Hotel charge may be shared, but no inflow should be attached yet.",
        signals: ["hotel charge"],
        suggestedInflowIds: [],
        suggestedIntent: "reimbursable"
      }),
      status: "completed"
    }), { status: 200 }),
    () => adapter().suggestReimbursementCandidate!(reimbursementRequest)
  );

  assert.deepEqual(suggestion.suggestedInflowIds, []);
});

test("OpenAI adapter preserves baseline reimbursement inflows when output omits ids", async () => {
  const suggestion = await withMockedFetch(
    async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        confidence: 0.78,
        question: "Was Ace Hotel reimbursable?",
        reason: "Hotel charge may be reimbursable.",
        signals: ["hotel charge"],
        suggestedIntent: "reimbursable"
      }),
      status: "completed"
    }), { status: 200 }),
    () => adapter().suggestReimbursementCandidate!(reimbursementRequestWithExtraInflow)
  );

  assert.deepEqual(suggestion.suggestedInflowIds, ["tx-zelle"]);
});
