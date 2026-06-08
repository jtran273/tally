import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReimbursementReportingSummary,
  describeReimbursementProgress,
  isUnmatchedReimbursementIncome,
  summarizeTransactionReimbursement
} from "./reimbursements";
import type { ReimbursementRecord, TransactionIntent, TransactionRecord, TransactionSplitRecord } from "@/lib/db";

function split(id: string, amount: number, intent: TransactionIntent): TransactionSplitRecord {
  return {
    amount,
    categoryId: "category-food",
    categoryName: "Food",
    id,
    intent,
    label: id,
    notes: null,
    transactionId: "tx-split"
  };
}

function reimbursement(input: Partial<ReimbursementRecord> = {}): ReimbursementRecord {
  return {
    counterparty: "Chris",
    dueDate: null,
    expectedAmount: 75,
    id: "reimbursement-1",
    notes: null,
    receivedAmount: 0,
    receivedAt: null,
    receivedTransactionId: null,
    splitId: "split-friends",
    status: "expected",
    transactionId: "tx-split",
    ...input
  };
}

function tx(
  amount: number,
  intent: TransactionIntent,
  splits: TransactionSplitRecord[] = [],
  reimbursements: ReimbursementRecord[] = []
) {
  return {
    amount,
    intent,
    reimbursements,
    splits
  } satisfies Pick<TransactionRecord, "amount" | "intent" | "reimbursements" | "splits">;
}

test("summarizeTransactionReimbursement treats reimbursable split dollars as outstanding before any inflow", () => {
  const summary = summarizeTransactionReimbursement(tx(-121.35, "shared", [
    split("split-me", 46.35, "personal"),
    split("split-friends", 75, "reimbursable")
  ]));

  assert.equal(summary.state, "reimbursable");
  assert.equal(summary.reimbursableAmount, 75);
  assert.equal(summary.receivedAmount, 0);
  assert.equal(summary.outstandingAmount, 75);
});

test("summarizeTransactionReimbursement leaves zero owed when fully reimbursed", () => {
  const summary = summarizeTransactionReimbursement(tx(-100, "reimbursable", [], [
    reimbursement({
      expectedAmount: 100,
      receivedAmount: 100,
      receivedAt: "2026-05-20",
      receivedTransactionId: "tx-inflow",
      status: "received"
    })
  ]));

  assert.equal(summary.state, "reimbursed");
  assert.equal(summary.receivedAmount, 100);
  assert.equal(summary.outstandingAmount, 0);
});

test("summarizeTransactionReimbursement keeps a positive owed balance for partial reimbursements", () => {
  const summary = summarizeTransactionReimbursement(tx(-100, "reimbursable", [], [
    reimbursement({ expectedAmount: 100, receivedAmount: 60, status: "requested" })
  ]));

  assert.equal(summary.state, "partially-reimbursed");
  assert.equal(summary.receivedAmount, 60);
  assert.equal(summary.outstandingAmount, 40);
});

test("summarizeTransactionReimbursement never reports a negative owed balance when over-reimbursed", () => {
  const summary = summarizeTransactionReimbursement(tx(-100, "reimbursable", [], [
    reimbursement({ expectedAmount: 100, receivedAmount: 130, status: "received" })
  ]));

  assert.equal(summary.outstandingAmount, 0);
  assert.equal(summary.state, "reimbursed");
});

test("summarizeTransactionReimbursement sums multiple reimbursement inflows into the owed balance", () => {
  const summary = summarizeTransactionReimbursement(tx(-120, "shared", [], [
    reimbursement({ id: "r-1", expectedAmount: 70, receivedAmount: 30, status: "requested" }),
    reimbursement({ id: "r-2", expectedAmount: 50, receivedAmount: 20, status: "requested" })
  ]));

  assert.equal(summary.expectedAmount, 120);
  assert.equal(summary.receivedAmount, 50);
  assert.equal(summary.outstandingAmount, 70);
  assert.equal(summary.recordCount, 2);
  assert.equal(summary.state, "partially-reimbursed");
});

test("summarizeTransactionReimbursement flags positive reimbursable inflows without a link as unmatched income", () => {
  const transaction = tx(75, "reimbursable");
  const summary = summarizeTransactionReimbursement(transaction);

  assert.equal(isUnmatchedReimbursementIncome(transaction), true);
  assert.equal(summary.state, "unmatched-income");
  assert.equal(summary.receivedAmount, 75);
  assert.equal(summary.outstandingAmount, 0);
  assert.equal(summary.reimbursableAmount, 0);
});

test("buildReimbursementReportingSummary separates reimbursable, received, and outstanding totals", () => {
  const reporting = buildReimbursementReportingSummary([
    tx(-121.35, "shared", [split("split-friends", 75, "reimbursable")]),
    tx(-80, "reimbursable", [], [reimbursement({ expectedAmount: 80, receivedAmount: 80, status: "received" })]),
    tx(25, "reimbursable")
  ]);

  assert.equal(reporting.reimbursableAmount, 155);
  assert.equal(reporting.outstandingAmount, 75);
  assert.equal(reporting.receivedAmount, 105);
  assert.equal(reporting.reimbursableCount, 2);
  assert.equal(reporting.reimbursedCount, 1);
  assert.equal(reporting.unmatchedIncomeAmount, 25);
  assert.equal(reporting.unmatchedIncomeCount, 1);
});

test("describeReimbursementProgress phrases partial reimbursements as still owed", () => {
  const summary = summarizeTransactionReimbursement(tx(-100, "reimbursable", [], [
    reimbursement({ expectedAmount: 100, receivedAmount: 60, status: "requested" })
  ]));

  assert.equal(describeReimbursementProgress(summary), "$40.00 of $100.00 still owed");
});

test("describeReimbursementProgress phrases not-yet-received reimbursable amounts as owed", () => {
  const summary = summarizeTransactionReimbursement(tx(-100, "reimbursable", [], [
    reimbursement({ expectedAmount: 100, receivedAmount: 0, status: "requested" })
  ]));

  assert.equal(describeReimbursementProgress(summary), "$100.00 of $100.00 owed");
});

test("describeReimbursementProgress marks fully reimbursed expenses as settled", () => {
  const summary = summarizeTransactionReimbursement(tx(-100, "reimbursable", [], [
    reimbursement({
      expectedAmount: 100,
      receivedAmount: 100,
      receivedAt: "2026-05-20",
      receivedTransactionId: "tx-inflow",
      status: "received"
    })
  ]));

  assert.equal(describeReimbursementProgress(summary), "$100.00 fully reimbursed");
});

test("describeReimbursementProgress surfaces unmatched income and written-off copy", () => {
  const unmatched = summarizeTransactionReimbursement(tx(75, "reimbursable"));
  assert.equal(describeReimbursementProgress(unmatched), "$75.00 unmatched reimbursement income");

  const writtenOff = summarizeTransactionReimbursement(tx(-100, "reimbursable", [], [
    reimbursement({ expectedAmount: 100, receivedAmount: 0, status: "written-off" })
  ]));
  assert.equal(describeReimbursementProgress(writtenOff), "$100.00 reimbursable · written off");
});

test("describeReimbursementProgress returns null when there is nothing to track", () => {
  const summary = summarizeTransactionReimbursement(tx(-100, "personal"));
  assert.equal(summary.state, "none");
  assert.equal(describeReimbursementProgress(summary), null);
});
