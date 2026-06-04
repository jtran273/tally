import assert from "node:assert/strict";
import test from "node:test";
import type { CategoryRecord, ReviewQueueItem, TransactionRecord } from "@/lib/db";
import { planMissingCategoryAutofixes } from "./missing-category-autofix";

const userId = "11111111-1111-1111-1111-111111111111";
const entertainment = category("cat-entertainment", "Entertainment");
const groceries = category("cat-groceries", "Groceries");

function category(id: string, name: string): CategoryRecord {
  return {
    color: null,
    icon: null,
    id,
    isSystem: true,
    name,
    parentId: null,
    userId
  };
}

function transaction(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    accountId: "acct-1",
    accountMask: "1234",
    accountName: "Checking",
    amount: -42,
    category: "Uncategorized",
    categoryId: null,
    confidence: 0.8,
    date: "2026-05-07",
    id: "tx-1",
    institutionName: "Bank",
    intent: "personal",
    merchant: "Merchant",
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidName: null,
    plaidTransactionId: "plaid-1",
    rawTransactionId: "raw-1",
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: "missing-category",
    reviewStatus: "open",
    splits: [],
    status: "posted",
    userId,
    ...overrides
  };
}

function reviewItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    aiSuggestion: {},
    confidence: 0.8,
    createdAt: "2026-05-07T12:00:00.000Z",
    explanation: "Missing category.",
    id: "review-1",
    reason: "missing-category",
    resolutionKind: null,
    resolutionNote: null,
    resolvedAt: null,
    status: "open",
    transaction: transaction(overrides.transaction as Partial<TransactionRecord>),
    transactionId: "tx-1",
    ...overrides
  };
}

test("planMissingCategoryAutofixes resolves stale missing-category rows that already have a linked category", () => {
  const plans = planMissingCategoryAutofixes([
    reviewItem({
      transaction: transaction({
        category: "Entertainment",
        categoryId: "cat-entertainment"
      })
    })
  ], [entertainment]);

  assert.deepEqual(plans, [{
    categoryId: "cat-entertainment",
    categoryName: "Entertainment",
    needsCategoryLink: false,
    reviewItemId: "review-1",
    transactionId: "tx-1"
  }]);
});

test("planMissingCategoryAutofixes links exact category-name matches before resolving", () => {
  const plans = planMissingCategoryAutofixes([
    reviewItem({
      id: "review-groceries",
      transaction: transaction({
        category: "groceries",
        categoryId: null,
        id: "tx-groceries"
      })
    })
  ], [entertainment, groceries]);

  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.categoryId, "cat-groceries");
  assert.equal(plans[0]?.categoryName, "Groceries");
  assert.equal(plans[0]?.needsCategoryLink, true);
  assert.equal(plans[0]?.reviewItemId, "review-groceries");
  assert.equal(plans[0]?.transactionId, "tx-groceries");
});

test("planMissingCategoryAutofixes leaves uncategorized and non-missing-category reviews alone", () => {
  const plans = planMissingCategoryAutofixes([
    reviewItem({ transaction: transaction({ category: "Uncategorized", categoryId: null }) }),
    reviewItem({
      id: "review-low-confidence",
      reason: "low-confidence",
      transaction: transaction({
        category: "Entertainment",
        categoryId: "cat-entertainment",
        id: "tx-low-confidence"
      })
    })
  ], [entertainment]);

  assert.deepEqual(plans, []);
});
