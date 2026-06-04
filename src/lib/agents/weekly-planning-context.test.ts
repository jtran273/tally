import assert from "node:assert/strict";
import test from "node:test";
import type {
  AccountRecord,
  RecurringExpenseRecord,
  ReimbursementRecord,
  ReviewQueueItem,
  TransactionIntent,
  TransactionRecord,
  TransactionSplitRecord
} from "@/lib/db";
import { buildWeeklyPlanningContext } from "./weekly-planning-context";

const userId = "user-planning";

function account(input: Partial<AccountRecord> = {}): AccountRecord {
  return {
    availableBalance: 1550,
    balance: 1600,
    color: null,
    creditLimit: null,
    currency: "USD",
    id: "account-checking",
    institutionId: "institution-bank",
    institutionName: "Seed Bank",
    isActive: true,
    lastSyncedAt: "2026-05-12T08:00:00.000Z",
    mask: "1111",
    name: "Checking",
    officialName: null,
    plaidAccountId: "plaid-account-secret",
    subtype: "checking",
    type: "depository",
    userId,
    ...input
  };
}

function split(id: string, amount: number, intent: TransactionIntent): TransactionSplitRecord {
  return {
    amount,
    categoryId: null,
    categoryName: null,
    id,
    intent,
    label: id,
    notes: null,
    transactionId: "tx-shared"
  };
}

function reimbursement(input: Partial<ReimbursementRecord> = {}): ReimbursementRecord {
  return {
    counterparty: "Roommate",
    dueDate: "2026-05-20",
    expectedAmount: 50,
    id: "reimbursement-shared",
    notes: "Do not expose raw provider notes.",
    receivedAmount: 10,
    receivedAt: "2026-05-11",
    receivedTransactionId: null,
    splitId: "split-roommate",
    status: "requested",
    transactionId: "tx-shared",
    ...input
  };
}

function transaction(
  input: Pick<TransactionRecord, "amount" | "date" | "id" | "merchant"> & Partial<TransactionRecord>
): TransactionRecord {
  const { amount, date, id, merchant, ...overrides } = input;

  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Checking",
    amount,
    category: "Food",
    categoryId: "category-food",
    confidence: 0.96,
    date,
    id,
    institutionName: "Seed Bank",
    intent: "personal",
    merchant,
    note: "User note should not be copied into the planning context.",
    plaidCategory: "Provider category",
    plaidMerchant: "Provider merchant",
    plaidName: "Provider name",
    plaidTransactionId: "plaid-transaction-secret",
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

function reviewItem(transactionRecord: TransactionRecord): ReviewQueueItem {
  return {
    aiSuggestion: {},
    confidence: 0.52,
    createdAt: "2026-05-12T09:00:00.000Z",
    explanation: "Needs category confirmation.",
    id: "review-shared",
    resolutionKind: null,
    reason: "missing-category",
    resolutionNote: null,
    resolvedAt: null,
    status: "open",
    transaction: transactionRecord,
    transactionId: transactionRecord.id
  };
}

function recurring(input: Partial<RecurringExpenseRecord> = {}): RecurringExpenseRecord {
  return {
    accountId: "account-checking",
    accountName: "Checking",
    amount: 1000,
    cadence: "monthly",
    category: "Housing",
    categoryId: "category-housing",
    confidence: 0.98,
    id: "recurring-rent",
    isNew: false,
    lastAmount: 1000,
    lastChargeDate: "2026-04-15",
    merchant: "Rent",
    nextDueDate: "2026-05-15",
    status: "active",
    ...input
  };
}

test("weekly planning context deterministically summarizes planning numbers and separates transfers", () => {
  const shared = transaction({
    amount: -120,
    category: "Shared",
    categoryId: "category-shared",
    date: "2026-05-11",
    id: "tx-shared",
    merchant: "Dinner Split",
    reimbursements: [reimbursement()],
    reviewStatus: "open",
    splits: [
      split("split-owned", 70, "personal"),
      split("split-roommate", 50, "reimbursable")
    ]
  });

  const context = buildWeeklyPlanningContext({
    accounts: [account()],
    asOfDate: "2026-05-12",
    generatedAt: "2026-05-12T16:00:00.000Z",
    now: new Date("2026-05-12T16:00:00.000Z"),
    recurringExpenses: [
      recurring(),
      recurring({
        amount: 20,
        cadence: "weekly",
        category: "Fitness",
        id: "recurring-gym",
        merchant: "Gym",
        nextDueDate: "2026-05-13"
      })
    ],
    reviewItems: [reviewItem(shared)],
    transactions: [
      transaction({ amount: -50, date: "2026-05-12", id: "tx-grocery", merchant: "Market" }),
      transaction({ amount: -25.25, date: "2026-05-10", id: "tx-cafe", merchant: "Cafe" }),
      shared,
      transaction({
        amount: 2000,
        category: "Income",
        categoryId: "category-income",
        date: "2026-05-09",
        id: "tx-payroll-current",
        merchant: "Payroll",
        recurring: true
      }),
      transaction({
        amount: -500,
        category: "Transfer",
        categoryId: "category-transfer",
        date: "2026-05-10",
        id: "tx-transfer",
        intent: "transfer",
        merchant: "Card Payment"
      }),
      transaction({ amount: -30, date: "2026-05-02", id: "tx-last-week", merchant: "Cafe" }),
      transaction({
        amount: 1000,
        category: "Income",
        categoryId: "category-income",
        date: "2026-05-01",
        id: "tx-side-income",
        merchant: "Consulting"
      }),
      transaction({
        amount: 2000,
        category: "Income",
        categoryId: "category-income",
        date: "2026-04-25",
        id: "tx-payroll-previous",
        merchant: "Payroll",
        recurring: true
      }),
      transaction({
        amount: 2000,
        category: "Income",
        categoryId: "category-income",
        date: "2026-04-11",
        id: "tx-payroll-history",
        merchant: "Payroll",
        recurring: true
      })
    ]
  });

  assert.equal(context.action, "read.weekly_planning_context");
  assert.deepEqual(context.window, {
    fromDate: "2026-05-06",
    previousFromDate: "2026-04-29",
    previousToDate: "2026-05-05",
    toDate: "2026-05-12"
  });
  assert.equal(context.spending.currentWeek.spending, 145.25);
  assert.equal(context.spending.currentWeek.income, 2000);
  assert.equal(context.spending.currentWeek.netCashflow, 1854.75);
  assert.equal(context.spending.previousWeek.spending, 30);
  assert.equal(context.income.previousWeekIncome, 1000);
  assert.equal(context.income.upcomingProjectedIncome, 4000);
  assert.deepEqual(context.spending.grouped.byCategory.map((bucket) => [bucket.category, bucket.total]), [
    ["Food", 75.25],
    ["Shared", 70]
  ]);
  assert.equal(context.reimbursements.reimbursableAmount, 50);
  assert.equal(context.reimbursements.outstandingAmount, 40);
  assert.equal(context.review.openCount, 1);
  assert.equal(context.sync.summary.status, "fresh");
  assert.deepEqual(context.transfers, { count: 1, netAmount: -500, outflowAmount: 500 });
  assert.equal(context.cashflow.upcoming.billTotal, 1100);
});

test("weekly planning context excludes provider-sensitive and secret-shaped fields", () => {
  const context = buildWeeklyPlanningContext({
    accounts: [account()],
    asOfDate: "2026-05-12",
    generatedAt: "2026-05-12T16:00:00.000Z",
    transactions: [
      transaction({
        amount: -10,
        date: "2026-05-12",
        id: "tx-secret",
        merchant: "Market",
        plaidCategory: "Do not leak provider category in planning context",
        plaidMerchant: "Do not leak provider merchant in planning context",
        plaidName: "Do not leak provider name in planning context"
      })
    ]
  });

  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes("plaidAccountId"), false);
  assert.equal(serialized.includes("plaid-account-secret"), false);
  assert.equal(serialized.includes("plaidTransactionId"), false);
  assert.equal(serialized.includes("plaid-transaction-secret"), false);
  assert.equal(serialized.includes("rawTransactionId"), false);
  assert.equal(serialized.includes("Provider category"), false);
  assert.equal(serialized.includes("User note should not be copied"), false);
});
