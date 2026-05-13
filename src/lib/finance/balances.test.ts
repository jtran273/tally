import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord, BalanceSnapshotRecord, TransactionRecord } from "@/lib/db";
import { buildBalanceTrend, calculateAccountScopeTotal, calculateAccountTotals, summarizeSync } from "./balances";

const account = {
  availableBalance: null,
  balance: 1000,
  color: null,
  creditLimit: null,
  currency: "USD",
  id: "account-checking",
  institutionId: "institution-bank",
  institutionName: "Seed Bank",
  isActive: true,
  lastSyncedAt: null,
  mask: "1111",
  name: "Checking",
  officialName: null,
  plaidAccountId: "plaid-account",
  subtype: "checking",
  type: "depository",
  userId: "user-1"
} satisfies AccountRecord;

const creditAccount = {
  ...account,
  balance: 350,
  id: "account-credit",
  mask: "2222",
  name: "Credit Card",
  plaidAccountId: "plaid-credit",
  subtype: "credit card",
  type: "credit"
} satisfies AccountRecord;

function transaction(input: Pick<TransactionRecord, "amount" | "date" | "id" | "intent" | "status">) {
  return input satisfies Pick<TransactionRecord, "amount" | "date" | "id" | "intent" | "status">;
}

test("calculateAccountScopeTotal separates cash, liabilities, and cash minus liabilities", () => {
  assert.equal(calculateAccountScopeTotal([account, creditAccount], "netWorth"), 650);
  assert.equal(calculateAccountScopeTotal([account, creditAccount], "cash"), 1000);
  assert.equal(calculateAccountScopeTotal([account, creditAccount], "liabilities"), 350);
  assert.equal(calculateAccountScopeTotal([account, creditAccount], "cashMinusLiabilities"), 650);
});

test("calculateAccountTotals exposes credit contribution and liabilities separately", () => {
  const totals = calculateAccountTotals([account, creditAccount]);

  assert.equal(totals.credit, -350);
  assert.equal(totals.liabilities, 350);
  assert.equal(totals.netWorth, 650);
});

test("buildBalanceTrend scopes snapshots for cash minus liabilities and liabilities", () => {
  const snapshots = [
    {
      accountId: account.id,
      availableBalance: null,
      creditLimit: null,
      currency: "USD",
      currentBalance: 900,
      id: "snapshot-cash-1",
      snapshotDate: "2026-04-29",
      source: "plaid"
    },
    {
      accountId: creditAccount.id,
      availableBalance: null,
      creditLimit: null,
      currency: "USD",
      currentBalance: 250,
      id: "snapshot-credit-1",
      snapshotDate: "2026-04-29",
      source: "plaid"
    },
    {
      accountId: account.id,
      availableBalance: null,
      creditLimit: null,
      currency: "USD",
      currentBalance: 1000,
      id: "snapshot-cash-2",
      snapshotDate: "2026-04-30",
      source: "plaid"
    },
    {
      accountId: creditAccount.id,
      availableBalance: null,
      creditLimit: null,
      currency: "USD",
      currentBalance: 350,
      id: "snapshot-credit-2",
      snapshotDate: "2026-04-30",
      source: "plaid"
    }
  ] satisfies BalanceSnapshotRecord[];

  const cashMinusLiabilities = buildBalanceTrend([account, creditAccount], snapshots, {
    asOfDate: "2026-04-30",
    scope: "cashMinusLiabilities"
  });
  const liabilities = buildBalanceTrend([account, creditAccount], snapshots, {
    asOfDate: "2026-04-30",
    scope: "liabilities"
  });

  assert.deepEqual(cashMinusLiabilities.map((point) => point.netWorth), [650, 650]);
  assert.deepEqual(liabilities.map((point) => point.netWorth), [250, 350]);
});

test("buildBalanceTrend uses transaction history when snapshots are too sparse", () => {
  const sparseSnapshots = [
    {
      accountId: account.id,
      availableBalance: null,
      creditLimit: null,
      currency: "USD",
      currentBalance: 980,
      id: "snapshot-1",
      snapshotDate: "2026-04-29",
      source: "plaid"
    },
    {
      accountId: account.id,
      availableBalance: null,
      creditLimit: null,
      currency: "USD",
      currentBalance: 1000,
      id: "snapshot-2",
      snapshotDate: "2026-04-30",
      source: "plaid"
    }
  ] satisfies BalanceSnapshotRecord[];

  const trend = buildBalanceTrend([account], sparseSnapshots, {
    asOfDate: "2026-04-30",
    transactions: [
      transaction({ amount: 500, date: "2026-01-15", id: "income", intent: "personal", status: "posted" }),
      transaction({ amount: -80, date: "2026-02-20", id: "groceries", intent: "personal", status: "posted" }),
      transaction({ amount: -40, date: "2026-03-25", id: "software", intent: "business", status: "posted" }),
      transaction({ amount: -400, date: "2026-04-02", id: "transfer", intent: "transfer", status: "posted" }),
      transaction({ amount: -20, date: "2026-04-28", id: "pending", intent: "personal", status: "pending" })
    ]
  });

  assert.equal(trend.length > sparseSnapshots.length, true);
  assert.equal(trend.some((point) => point.date === "2026-01-15"), true);
  assert.equal(trend.some((point) => point.source === "transaction"), true);
  assert.equal(trend.at(-1)?.date, "2026-04-30");
  assert.equal(trend.at(-1)?.netWorth, 1000);
});

test("buildBalanceTrend derives transaction trends for liabilities and cashMinusLiabilities", () => {
  const txns = [
    { amount: -120, date: "2026-04-10", id: "card-charge", intent: "personal" as const, status: "posted" as const, accountId: creditAccount.id },
    { amount: -45, date: "2026-04-15", id: "cash-spend", intent: "personal" as const, status: "posted" as const, accountId: account.id },
    { amount: -500, date: "2026-04-20", id: "transfer-payment", intent: "transfer" as const, status: "posted" as const, accountId: creditAccount.id }
  ];

  const liabilitiesTrend = buildBalanceTrend([account, creditAccount], [], {
    asOfDate: "2026-04-30",
    scope: "liabilities",
    transactions: txns
  });
  assert.equal(liabilitiesTrend.length > 1, true, "liabilities scope should derive multiple trend points from credit transactions");
  assert.equal(liabilitiesTrend.at(-1)?.netWorth, 350, "trend should end at current liabilities total");

  const combinedTrend = buildBalanceTrend([account, creditAccount], [], {
    asOfDate: "2026-04-30",
    scope: "cashMinusLiabilities",
    transactions: txns
  });
  assert.equal(combinedTrend.length > 1, true, "cashMinusLiabilities should derive multiple trend points");
  assert.equal(combinedTrend.at(-1)?.netWorth, 650, "trend should end at current cash minus liabilities");
});

test("summarizeSync ignores invalid timestamps when deriving latest sync", () => {
  const summary = summarizeSync(
    [
      { lastSyncedAt: "not-a-date" },
      { lastSyncedAt: null },
      { lastSyncedAt: "2026-05-07T12:00:00.000Z" },
      { lastSyncedAt: "2026-05-06T12:00:00.000Z" }
    ],
    { now: new Date("2026-05-07T20:00:00.000Z") }
  );

  assert.equal(summary.latestSyncedAt, "2026-05-07T12:00:00.000Z");
  assert.equal(summary.freshCount, 1);
  assert.equal(summary.neverSyncedCount, 2);
  assert.equal(summary.staleCount, 1);
  assert.equal(summary.status, "stale");
});

test("summarizeSync reports never synced when every timestamp is missing or invalid", () => {
  const summary = summarizeSync([
    { lastSyncedAt: "not-a-date" },
    { lastSyncedAt: null }
  ]);

  assert.equal(summary.latestSyncedAt, null);
  assert.equal(summary.neverSyncedCount, 2);
  assert.equal(summary.status, "never");
});
