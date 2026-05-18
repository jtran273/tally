import assert from "node:assert/strict";
import test from "node:test";
import type { ReimbursementCandidateAiRequest, ReimbursementCandidateAiSuggestion } from "@/lib/ai/types";
import type { AgentProposalRecord, TransactionRecord } from "@/lib/db";
import type { TransactionListFilters } from "@/lib/db/queries";
import type { PersistReimbursementCandidateInput } from "@/lib/review/reimbursement-candidates";
import {
  createDisabledProactiveScanResult,
  createProactiveScanSuggestionService,
  proactiveScanWindow,
  resolveProactiveScanEnabled,
  resolveProactiveScanMaxTransactions,
  runProactiveReimbursementScan
} from "./proactive-scan";

const userId = "user-proactive";
const now = new Date("2026-05-13T12:00:00.000Z");
const client = {} as never;

function transaction(input: Partial<TransactionRecord> & Pick<TransactionRecord, "id">): TransactionRecord {
  const { id, ...overrides } = input;
  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Checking",
    amount: -80,
    category: "Food",
    categoryId: "category-food",
    confidence: 0.93,
    date: "2026-05-13",
    id,
    institutionName: "Seed Bank",
    intent: "personal",
    merchant: "Dinner Guild",
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidName: null,
    plaidTransactionId: null,
    rawTransactionId: `raw-${input.id}`,
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

function proposal(input: Partial<AgentProposalRecord> = {}): AgentProposalRecord {
  return {
    acceptedAt: null,
    answeredAt: null,
    clarificationAnswer: null,
    clarificationAnswerKind: null,
    clarificationQuestion: "Was this reimbursable?",
    confidence: 0.81,
    createdAt: "2026-05-13T12:00:00.000Z",
    dismissedAt: null,
    evidence: { transaction: { amount: -80, date: "2026-05-13", merchant: "Dinner Guild" } },
    expiresAt: null,
    id: "proposal-1",
    proposalType: "reimbursement_candidate",
    proposedPatch: { suggestedIntent: "reimbursable" },
    questionFingerprint: "reimbursement-candidate:tx-dinner:no-inflow",
    sourceAgent: "ledger-reimbursement-candidate-detector",
    sourceCandidateId: null,
    sourceContextId: null,
    status: "pending",
    targetId: "tx-dinner",
    targetKind: "enriched_transaction",
    updatedAt: "2026-05-13T12:00:00.000Z",
    userId,
    ...input
  };
}

function suggestionService() {
  return {
    suggestReimbursementCandidate: async (
      _request: ReimbursementCandidateAiRequest
    ): Promise<ReimbursementCandidateAiSuggestion> => ({
      confidence: 0,
      provider: { id: "test", kind: "mock", label: "Test provider", version: "test" },
      question: "Was this reimbursable?",
      reason: "not used",
      signals: [],
      suggestedInflowIds: [],
      suggestedIntent: "reimbursable",
      suggestionId: "not-used",
      targetTransactionId: "tx-unused"
    })
  };
}

test("proactive scan window covers late-arriving reimbursement inflows", () => {
  assert.deepEqual(proactiveScanWindow(now), {
    fromDate: "2026-03-29",
    inflowFromDate: "2026-03-27",
    toDate: "2026-05-13"
  });
});

test("proactive scan respects the configured transaction cap", async () => {
  const calls: TransactionListFilters[] = [];
  const transactions = [
    transaction({ id: "tx-1" }),
    transaction({ id: "tx-2" }),
    transaction({ id: "tx-3" })
  ];

  const result = await runProactiveReimbursementScan(client, userId, {
    maxTransactions: 2,
    now
  }, {
    createDetectedReimbursementCandidateProposals: async () => [],
    createSuggestionService: suggestionService,
    listAgentProposals: async () => [],
    listTransactions: async (_client, _userId, filters = {}) => {
      calls.push(filters);
      return calls.length === 1 ? transactions.slice(0, filters.limit) : [];
    },
    recordAuditEvent: async () => ({})
  });

  assert.equal(result.scannedTransactionCount, 2);
  assert.equal(result.maxTransactions, 2);
  assert.equal(calls[0]?.limit, 2);
  assert.equal(calls[0]?.intent, "personal");
  assert.equal(calls[0]?.fromDate, "2026-03-29");
});

test("proactive scan rerun passes existing proposals so detector stays idempotent", async () => {
  const stored: AgentProposalRecord[] = [];
  const audits: unknown[] = [];

  const run = () => runProactiveReimbursementScan(client, userId, {
    maxTransactions: 5,
    now
  }, {
    createDetectedReimbursementCandidateProposals: async (_client, _userId, input: PersistReimbursementCandidateInput) => {
      if (input.existingProposals?.some((existing) => existing.targetId === "tx-dinner")) return [];

      const created = proposal();
      stored.push(created);
      return [created];
    },
    createSuggestionService: suggestionService,
    listAgentProposals: async () => [...stored],
    listTransactions: async () => [transaction({ id: "tx-dinner" })],
    recordAuditEvent: async (_client, _userId, input) => {
      audits.push(input);
      return {};
    }
  });

  const first = await run();
  const second = await run();

  assert.equal(first.createdProposalCount, 1);
  assert.equal(second.createdProposalCount, 0);
  assert.equal(stored.length, 1);
  assert.equal(audits.length, 1);
});

test("proactive scan logs detector failures and returns a failed result without throwing", async () => {
  const logged: unknown[] = [];

  const result = await runProactiveReimbursementScan(client, userId, {
    maxTransactions: 5,
    now
  }, {
    createDetectedReimbursementCandidateProposals: async () => {
      throw new Error("detector unavailable");
    },
    createSuggestionService: suggestionService,
    listAgentProposals: async () => [],
    listTransactions: async () => [transaction({ id: "tx-dinner" })],
    logger: {
      error: (...args: unknown[]) => {
        logged.push(args);
      }
    },
    recordAuditEvent: async () => ({})
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "detector_failed");
  assert.equal(result.createdProposalCount, 0);
  assert.equal(logged.length, 1);
});

test("proactive scan max transaction env parser falls back and clamps", () => {
  assert.equal(resolveProactiveScanMaxTransactions(undefined), 100);
  assert.equal(resolveProactiveScanMaxTransactions("   "), 100);
  assert.equal(resolveProactiveScanMaxTransactions("12.8"), 12);
  assert.equal(resolveProactiveScanMaxTransactions("0"), 1);
  assert.equal(resolveProactiveScanMaxTransactions("not-a-number"), 100);
});

test("proactive scan requires an explicit enable flag", () => {
  assert.equal(resolveProactiveScanEnabled(undefined), false);
  assert.equal(resolveProactiveScanEnabled(""), false);
  assert.equal(resolveProactiveScanEnabled("false"), false);
  assert.equal(resolveProactiveScanEnabled("TRUE"), true);
});

test("disabled proactive scan result exposes only safe operational metadata", () => {
  const previousAutoReview = process.env.ENABLE_OPENAI_AUTO_REVIEW;

  try {
    delete process.env.ENABLE_OPENAI_AUTO_REVIEW;

    const result = createDisabledProactiveScanResult({
      maxTransactions: 25,
      now
    });

    assert.deepEqual(result, {
      createdProposalCount: 0,
      errorCode: null,
      fromDate: "2026-03-29",
      maxTransactions: 25,
      openAiAutoReviewEnabled: false,
      scannedTransactionCount: 0,
      status: "disabled",
      suggestionProviderKind: null,
      suggestionProviderVersion: null,
      toDate: "2026-05-13"
    });
  } finally {
    if (previousAutoReview === undefined) {
      delete process.env.ENABLE_OPENAI_AUTO_REVIEW;
    } else {
      process.env.ENABLE_OPENAI_AUTO_REVIEW = previousAutoReview;
    }
  }
});

test("proactive scan result includes safe suggestion provider metadata", async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousAutoReview = process.env.ENABLE_OPENAI_AUTO_REVIEW;

  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ENABLE_OPENAI_AUTO_REVIEW = "true";

    const result = await runProactiveReimbursementScan(client, userId, {
      maxTransactions: 5,
      now
    }, {
      createDetectedReimbursementCandidateProposals: async () => [],
      createSuggestionService: () => createProactiveScanSuggestionService(),
      listAgentProposals: async () => [],
      listTransactions: async () => [transaction({ id: "tx-dinner" })],
      recordAuditEvent: async () => ({})
    });

    assert.equal(result.status, "succeeded");
    assert.equal(result.openAiAutoReviewEnabled, true);
    assert.equal(result.suggestionProviderKind, "openai");
    assert.match(result.suggestionProviderVersion ?? "", /^openai-suggestions-v2:/);
  } finally {
    if (previousOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }

    if (previousAutoReview === undefined) {
      delete process.env.ENABLE_OPENAI_AUTO_REVIEW;
    } else {
      process.env.ENABLE_OPENAI_AUTO_REVIEW = previousAutoReview;
    }
  }
});

test("proactive scan uses the automatic AI opt-in before OpenAI", () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousAutoReview = process.env.ENABLE_OPENAI_AUTO_REVIEW;

  try {
    process.env.OPENAI_API_KEY = "test-key";

    delete process.env.ENABLE_OPENAI_AUTO_REVIEW;
    assert.equal(createProactiveScanSuggestionService().adapter.descriptor.kind, "mock");

    process.env.ENABLE_OPENAI_AUTO_REVIEW = "false";
    assert.equal(createProactiveScanSuggestionService().adapter.descriptor.kind, "mock");

    process.env.ENABLE_OPENAI_AUTO_REVIEW = "true";
    assert.equal(createProactiveScanSuggestionService().adapter.descriptor.kind, "openai");
  } finally {
    if (previousOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }

    if (previousAutoReview === undefined) {
      delete process.env.ENABLE_OPENAI_AUTO_REVIEW;
    } else {
      process.env.ENABLE_OPENAI_AUTO_REVIEW = previousAutoReview;
    }
  }
});
