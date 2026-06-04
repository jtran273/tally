import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord, TransactionRecord } from "@/lib/db";
import { buildLiabilitiesDueSummary } from "./liabilities";

const userId = "user-1";

function account(input: {
  id: string;
  type: AccountRecord["type"];
  balance: number;
  creditLimit?: number | null;
  minimumPaymentAmount?: number | null;
  nextPaymentDueDate?: string | null;
}): AccountRecord {
  return {
    availableBalance: null,
    balance: input.balance,
    color: null,
    creditLimit: input.creditLimit ?? null,
    currency: "USD",
    id: input.id,
    institutionId: "institution-bank",
    institutionName: "Seed Bank",
    isActive: true,
    lastSyncedAt: null,
    minimumPaymentAmount: input.minimumPaymentAmount ?? null,
    mask: "1234",
    name: `${input.type === "credit" ? "Card" : "Checking"} ${input.id}`,
    nextPaymentDueDate: input.nextPaymentDueDate ?? null,
    officialName: null,
    plaidAccountId: `plaid-${input.id}`,
    subtype: input.type === "credit" ? "credit card" : "checking",
    type: input.type,
    userId
  };
}

function transaction(input: { id: string; accountId: string; amount: number; date: string }): TransactionRecord {
  return {
    accountId: input.accountId,
    accountMask: "1234",
    accountName: "Card",
    amount: input.amount,
    category: "Transfer",
    categoryId: null,
    confidence: 1,
    date: input.date,
    id: input.id,
    institutionName: "Seed Bank",
    intent: "transfer",
    merchant: "AUTOPAY PAYMENT",
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
    userId
  };
}

test("buildLiabilitiesDueSummary flags overdue cards and computes coverage", () => {
  const accounts: AccountRecord[] = [
    account({ id: "checking", type: "depository", balance: 1500 }),
    account({ id: "card-a", type: "credit", balance: 600, creditLimit: 5000 }),
    account({ id: "card-b", type: "credit", balance: 1200, creditLimit: 3000 })
  ];

  const transactions: TransactionRecord[] = [
    transaction({ id: "t1", accountId: "card-a", amount: 50, date: "2026-03-01" }),
    transaction({ id: "t2", accountId: "card-b", amount: 100, date: "2026-04-15" })
  ];

  const summary = buildLiabilitiesDueSummary({
    accounts,
    asOfDate: "2026-05-11",
    cashAvailable: 1500,
    transactions
  });

  assert.equal(summary.rows.length, 2);
  assert.equal(summary.totalOwed, 1800);
  assert.equal(summary.cashAvailable, 1500);
  assert.equal(summary.coverageDelta, -300);

  const cardA = summary.rows.find((row) => row.accountId === "card-a");
  assert.ok(cardA);
  assert.equal(cardA?.status, "overdue", "March payment + 30d cycle should be overdue by May 11");
  assert.equal(cardA?.lastPaymentDate, "2026-03-01");
  assert.equal(cardA?.utilizationPercent, 12);
});

test("buildLiabilitiesDueSummary ranks best card action by due status cash coverage and utilization", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({ id: "checking", type: "depository", balance: 100 }),
      account({
        id: "covered-due",
        type: "credit",
        balance: 3000,
        creditLimit: 10000,
        minimumPaymentAmount: 50,
        nextPaymentDueDate: "2026-05-15"
      }),
      account({
        id: "uncovered-due",
        type: "credit",
        balance: 5000,
        creditLimit: 10000,
        minimumPaymentAmount: 500,
        nextPaymentDueDate: "2026-05-15"
      }),
      account({
        id: "high-util-current",
        type: "credit",
        balance: 900,
        creditLimit: 1000,
        minimumPaymentAmount: 25,
        nextPaymentDueDate: "2026-06-20"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 100,
    transactions: []
  });

  assert.deepEqual(
    summary.rows.map((row) => row.accountId),
    ["covered-due", "uncovered-due", "high-util-current"]
  );
  assert.equal(summary.rows[0]?.status, "due-soon");
  assert.ok((summary.rows[0]?.actionRank ?? 0) > (summary.rows[1]?.actionRank ?? 0));
  assert.ok((summary.rows[1]?.actionRank ?? 0) > (summary.rows[2]?.actionRank ?? 0));
});

test("buildLiabilitiesDueSummary returns empty when no credit accounts", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [account({ id: "checking", type: "depository", balance: 100 })],
    asOfDate: "2026-05-11",
    cashAvailable: 100,
    transactions: []
  });

  assert.equal(summary.rows.length, 0);
  assert.equal(summary.totalOwed, 0);
  assert.equal(summary.coverageDelta, 100);
});
