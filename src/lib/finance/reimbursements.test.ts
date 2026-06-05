import {
  buildReimbursementReportingSummary,
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

export const reimbursementFixtureAssertions = assertReimbursementFixtures();

function assertReimbursementFixtures(): true {
  const splitSummary = summarizeTransactionReimbursement(tx(-121.35, "shared", [
    split("split-me", 46.35, "personal"),
    split("split-friends", 75, "reimbursable")
  ]));

  if (splitSummary.state !== "reimbursable" || splitSummary.reimbursableAmount !== 75 || splitSummary.outstandingAmount !== 75) {
    throw new Error("Expected reimbursable split dollars to be first-class even before reimbursement records exist.");
  }

  const partialSummary = summarizeTransactionReimbursement(tx(-121.35, "shared", [], [
    reimbursement({ expectedAmount: 75, receivedAmount: 25, status: "requested" })
  ]));

  if (partialSummary.state !== "partially-reimbursed" || partialSummary.receivedAmount !== 25 || partialSummary.outstandingAmount !== 50) {
    throw new Error("Expected partial reimbursement records to preserve received and outstanding amounts.");
  }

  const reimbursedSummary = summarizeTransactionReimbursement(tx(-75, "reimbursable", [], [
    reimbursement({
      expectedAmount: 75,
      receivedAmount: 75,
      receivedAt: "2026-05-20",
      receivedTransactionId: "tx-reimbursement-inflow",
      status: "received"
    })
  ]));

  if (reimbursedSummary.state !== "reimbursed" || reimbursedSummary.outstandingAmount !== 0) {
    throw new Error("Expected fully received reimbursements to be marked reimbursed.");
  }

  const unmatchedIncome = tx(75, "reimbursable");
  const unmatchedIncomeSummary = summarizeTransactionReimbursement(unmatchedIncome);

  if (
    !isUnmatchedReimbursementIncome(unmatchedIncome) ||
    unmatchedIncomeSummary.state !== "unmatched-income" ||
    unmatchedIncomeSummary.receivedAmount !== 75 ||
    unmatchedIncomeSummary.outstandingAmount !== 0 ||
    unmatchedIncomeSummary.reimbursableAmount !== 0
  ) {
    throw new Error("Expected positive reimbursable inflows without a reimbursement link to be unmatched income.");
  }

  const reporting = buildReimbursementReportingSummary([
    tx(-121.35, "shared", [split("split-friends", 75, "reimbursable")]),
    tx(-80, "reimbursable", [], [reimbursement({ expectedAmount: 80, receivedAmount: 80, status: "received" })]),
    tx(25, "reimbursable")
  ]);

  if (
    reporting.reimbursableAmount !== 155 ||
    reporting.outstandingAmount !== 75 ||
    reporting.receivedAmount !== 105 ||
    reporting.reimbursableCount !== 2 ||
    reporting.reimbursedCount !== 1 ||
    reporting.unmatchedIncomeAmount !== 25 ||
    reporting.unmatchedIncomeCount !== 1
  ) {
    throw new Error("Expected reimbursement reporting summary to separate reimbursable, received, and outstanding totals.");
  }

  return true;
}
