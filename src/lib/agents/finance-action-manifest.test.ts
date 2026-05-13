import assert from "node:assert/strict";
import test from "node:test";
import type {
  AccountRecord,
  ReviewQueueItem,
  ReviewReason,
  TransactionIntent,
  TransactionRecord
} from "@/lib/db";
import {
  assertFinanceManifestSafe,
  buildFinanceAgentManifestEnvelope,
  buildReviewQueueSummary,
  buildSpendingSummary,
  buildStaleSyncSummary,
  findForbiddenFinanceManifestFields,
  listFinanceAgentCapabilities
} from "./finance-action-manifest";

function transaction(input: Partial<TransactionRecord> = {}): TransactionRecord {
  const id = input.id ?? "tx-test";

  return {
    accountId: "acct-checking",
    accountMask: "1234",
    accountName: "Checking",
    amount: -42.25,
    category: "Food",
    categoryId: "cat-food",
    confidence: 0.82,
    date: "2026-05-05",
    id,
    institutionName: "Bank",
    intent: "personal",
    merchant: "Cafe",
    note: "",
    plaidCategory: "Restaurants",
    plaidMerchant: "CAFE",
    plaidName: "CAFE PURCHASE",
    plaidTransactionId: null,
    rawTransactionId: `raw-${id}`,
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId: "user-test",
    ...input
  };
}

function reviewItem(
  id: string,
  reason: ReviewReason,
  tx: TransactionRecord,
  confidence: number | null = 0.7
): ReviewQueueItem {
  return {
    aiSuggestion: {},
    confidence,
    createdAt: "2026-05-06T12:00:00.000Z",
    explanation: "Needs review.",
    id,
    reason,
    resolutionNote: null,
    resolvedAt: null,
    status: "open",
    transaction: tx,
    transactionId: tx.id
  };
}

function account(input: Partial<AccountRecord> = {}): AccountRecord {
  return {
    availableBalance: 100,
    balance: 100,
    color: null,
    creditLimit: null,
    currency: "USD",
    id: "acct-checking",
    institutionId: "inst-bank",
    institutionName: "Bank",
    isActive: true,
    lastSyncedAt: "2026-05-06T10:00:00.000Z",
    mask: "1234",
    name: "Checking",
    officialName: null,
    plaidAccountId: "redacted",
    subtype: "checking",
    type: "depository",
    userId: "user-test",
    ...input
  };
}

test("finance action capabilities are proposal-only for writes", () => {
  const capabilities = listFinanceAgentCapabilities();
  assert.equal(
    capabilities.some((capability) => capability.action === "read.upcoming_calendar_context"),
    true
  );
  assert.deepEqual(
    capabilities.filter((capability) => capability.kind === "proposal").map((capability) => capability.action),
    ["propose.review_suggestions", "propose.merchant_rule"]
  );
  assert.equal(capabilities.every((capability) => capability.kind === "read" || capability.approvalRequired), true);
});

test("review queue summary returns minimized examples and grouped reasons", () => {
  const grocery = transaction({ amount: -64.12, category: "Groceries", id: "tx-grocery", merchant: "Market" });
  const rent = transaction({ amount: -2400, category: "Housing", id: "tx-rent", merchant: "Rent Portal" });

  const summary = buildReviewQueueSummary([
    reviewItem("review-grocery", "missing-category", grocery),
    reviewItem("review-rent", "large", rent, null)
  ], {
    generatedAt: "2026-05-06T13:00:00.000Z",
    limit: 1
  });

  assert.equal(summary.openCount, 2);
  assert.equal(summary.totalAbsoluteAmount, 2464.12);
  assert.equal(summary.reasonCounts.large, 1);
  assert.equal(summary.examples.length, 1);
  assert.equal(summary.examples[0]?.transactionId, "tx-rent");
  assert.equal("note" in summary.examples[0]!, false);
});

test("spending summary excludes transfers, reimbursements, and positive inflows", () => {
  const transactions = [
    transaction({ amount: -20, category: "Food", intent: "personal" }),
    transaction({ amount: -75, category: "Travel", intent: "transfer" }),
    transaction({ amount: 120, category: "Income", intent: "personal" }),
    transaction({
      amount: -50,
      category: "Shared",
      intent: "shared",
      reviewStatus: "open",
      splits: [
        {
          amount: 20,
          categoryId: null,
          categoryName: null,
          id: "split-owned",
          intent: "personal" as TransactionIntent,
          label: "Mine",
          notes: null,
          transactionId: "tx-test"
        },
        {
          amount: 30,
          categoryId: null,
          categoryName: null,
          id: "split-reimbursable",
          intent: "reimbursable" as TransactionIntent,
          label: "Friend",
          notes: null,
          transactionId: "tx-test"
        }
      ]
    })
  ];

  const summary = buildSpendingSummary(transactions, {
    fromDate: "2026-05-01",
    generatedAt: "2026-05-06T13:00:00.000Z",
    toDate: "2026-05-31"
  });

  assert.equal(summary.totalSpending, 40);
  assert.equal(summary.openReviewCount, 1);
  assert.deepEqual(summary.byCategory.map((bucket) => [bucket.category, bucket.total]), [
    ["Food", 20],
    ["Shared", 20]
  ]);
});

test("stale sync summary provides account state without provider ids", () => {
  const summary = buildStaleSyncSummary([
    account({ id: "fresh", lastSyncedAt: "2026-05-06T12:00:00.000Z", name: "Fresh Checking" }),
    account({ id: "stale", lastSyncedAt: "2026-05-04T12:00:00.000Z", name: "Stale Checking" }),
    account({ id: "never", lastSyncedAt: null, name: "New Card", type: "credit" })
  ], {
    generatedAt: "2026-05-06T13:00:00.000Z",
    now: new Date("2026-05-06T13:00:00.000Z"),
    staleAfterHours: 24
  });

  assert.equal(summary.summary.status, "stale");
  assert.equal(summary.summary.freshCount, 1);
  assert.equal(summary.summary.staleCount, 1);
  assert.equal(summary.summary.neverSyncedCount, 1);
  assert.equal(summary.accounts[0]?.state, "never");
  assert.equal("plaidAccountId" in summary.accounts[0]!, false);
});

test("manifest envelope rejects forbidden fields recursively", () => {
  const violations = findForbiddenFinanceManifestFields({
    summary: {
      nested: {
        raw_payload: { amount: -10 }
      }
    }
  });

  assert.deepEqual(violations, [{ field: "raw_payload", path: "summary.nested.raw_payload" }]);
  assert.throws(() => assertFinanceManifestSafe({ authHeader: "secret" }), /forbidden fields/i);
});

test("manifest envelope includes version, mode, and only declared actions", () => {
  const envelope = buildFinanceAgentManifestEnvelope({
    actions: ["read.review_queue_summary", "propose.review_suggestions"],
    handoffId: "handoff-test",
    proposals: [{
      action: "propose.review_suggestions",
      categoryName: "Food",
      confidence: 0.8,
      proposalId: "proposal-test",
      rationale: "Merchant pattern matches restaurant spend.",
      reviewItemId: "review-test",
      transactionId: "tx-test"
    }]
  });

  assert.equal(envelope.manifestVersion, "2026-05-13");
  assert.equal(envelope.mode, "proposal-only");
  assert.equal(envelope.userScoped, true);
  assert.equal(envelope.forbiddenFieldCheck, "passed");
});
