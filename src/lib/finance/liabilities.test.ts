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
  lastStatementIssueDate?: string | null;
  lastStatementBalance?: number | null;
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
    lastStatementBalance: input.lastStatementBalance ?? null,
    lastStatementIssueDate: input.lastStatementIssueDate ?? null,
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

test("buildLiabilitiesDueSummary marks current Plaid statement dates as actual reporting dates", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-actual",
        type: "credit",
        balance: 450,
        creditLimit: 2000,
        lastStatementIssueDate: "2026-05-11",
        lastStatementBalance: 430,
        nextPaymentDueDate: "2026-06-05"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: []
  });

  const row = summary.rows[0];
  assert.equal(row?.reportingDate, "2026-05-11");
  assert.equal(row?.reportingDateSource, "actual_plaid_liability");
  assert.equal(row?.reportingDateConfidence, "high");
  assert.equal(row?.lastStatementBalance, 430);
  assert.equal(row?.dueDateIsActual, true);
});

test("buildLiabilitiesDueSummary infers the next reporting date from a prior statement cycle", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-cycle",
        type: "credit",
        balance: 900,
        creditLimit: 3000,
        lastStatementIssueDate: "2026-04-15",
        nextPaymentDueDate: "2026-05-10"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: []
  });

  const row = summary.rows[0];
  assert.equal(row?.reportingDate, "2026-05-15");
  assert.equal(row?.reportingDateSource, "inferred_from_statement_cycle");
  assert.equal(row?.reportingDateConfidence, "medium");
  assert.equal(row?.status, "overdue", "due-date safety should still use the actual due date");
});

test("buildLiabilitiesDueSummary falls back to a weaker reporting estimate from the due date", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-due-date",
        type: "credit",
        balance: 300,
        creditLimit: 1200,
        nextPaymentDueDate: "2026-05-26"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: []
  });

  const row = summary.rows[0];
  assert.equal(row?.estimatedDueDate, "2026-05-26");
  assert.equal(row?.reportingDate, "2026-05-31");
  assert.equal(row?.reportingDateSource, "estimated_from_due_date");
  assert.equal(row?.reportingDateConfidence, "low");
});

test("buildLiabilitiesDueSummary keeps due-date fallback when Plaid liabilities are unavailable", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-unknown",
        type: "credit",
        balance: 200,
        creditLimit: 1000
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: [transaction({ id: "payment", accountId: "card-unknown", amount: 25, date: "2026-05-01" })]
  });

  const row = summary.rows[0];
  assert.equal(row?.estimatedDueDate, "2026-05-31");
  assert.equal(row?.dueDateIsActual, false);
  assert.equal(row?.reportingDate, null);
  assert.equal(row?.reportingDateSource, "unknown");
  assert.equal(row?.reportingDateConfidence, "unknown");
  assert.equal(row?.status, "current");
});
