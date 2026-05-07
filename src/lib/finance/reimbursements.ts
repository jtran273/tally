import type { ReimbursementRecord, TransactionRecord, TransactionSplitRecord } from "@/lib/db";

export type TransactionReimbursementState =
  | "none"
  | "reimbursable"
  | "partially-reimbursed"
  | "reimbursed"
  | "written-off";

export interface TransactionReimbursementSummary {
  expectedAmount: number;
  outstandingAmount: number;
  receivedAmount: number;
  reimbursableAmount: number;
  recordCount: number;
  splitCount: number;
  state: TransactionReimbursementState;
}

export interface ReimbursementReportingSummary {
  expectedAmount: number;
  outstandingAmount: number;
  receivedAmount: number;
  reimbursableAmount: number;
  reimbursableCount: number;
  reimbursedCount: number;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function reimbursableSplitAmount(split: Pick<TransactionSplitRecord, "amount" | "intent">) {
  return split.intent === "reimbursable" ? Math.abs(split.amount) : 0;
}

function fallbackReimbursableAmount(transaction: Pick<TransactionRecord, "amount" | "intent" | "splits">) {
  if (transaction.amount >= 0) return 0;

  const splitAmount = transaction.splits.reduce((sum, split) => sum + reimbursableSplitAmount(split), 0);
  if (splitAmount > 0) return splitAmount;

  return transaction.intent === "reimbursable" ? Math.abs(transaction.amount) : 0;
}

function reimbursementState(
  reimbursements: readonly ReimbursementRecord[],
  reimbursableAmount: number,
  receivedAmount: number
): TransactionReimbursementState {
  if (reimbursements.some((record) => record.status === "written-off")) return "written-off";
  if (reimbursableAmount <= 0) return "none";
  if (receivedAmount >= reimbursableAmount) return "reimbursed";
  if (receivedAmount > 0) return "partially-reimbursed";
  return "reimbursable";
}

export function summarizeTransactionReimbursement(
  transaction: Pick<TransactionRecord, "amount" | "intent" | "reimbursements" | "splits">
): TransactionReimbursementSummary {
  const recordExpected = transaction.reimbursements.reduce((sum, record) => sum + record.expectedAmount, 0);
  const receivedAmount = transaction.reimbursements.reduce((sum, record) => sum + record.receivedAmount, 0);
  const fallbackAmount = fallbackReimbursableAmount(transaction);
  const reimbursableAmount = roundMoney(Math.max(recordExpected, fallbackAmount));
  const expectedAmount = roundMoney(recordExpected || fallbackAmount);
  const outstandingAmount = roundMoney(Math.max(0, expectedAmount - receivedAmount));

  return {
    expectedAmount,
    outstandingAmount,
    receivedAmount: roundMoney(receivedAmount),
    reimbursableAmount,
    recordCount: transaction.reimbursements.length,
    splitCount: transaction.splits.filter((split) => split.intent === "reimbursable").length,
    state: reimbursementState(transaction.reimbursements, reimbursableAmount, receivedAmount)
  };
}

export function buildReimbursementReportingSummary(
  transactions: readonly Pick<TransactionRecord, "amount" | "intent" | "reimbursements" | "splits">[]
): ReimbursementReportingSummary {
  return transactions.reduce(
    (summary, transaction) => {
      const reimbursement = summarizeTransactionReimbursement(transaction);
      summary.expectedAmount = roundMoney(summary.expectedAmount + reimbursement.expectedAmount);
      summary.outstandingAmount = roundMoney(summary.outstandingAmount + reimbursement.outstandingAmount);
      summary.receivedAmount = roundMoney(summary.receivedAmount + reimbursement.receivedAmount);
      summary.reimbursableAmount = roundMoney(summary.reimbursableAmount + reimbursement.reimbursableAmount);
      if (reimbursement.state !== "none") summary.reimbursableCount += 1;
      if (reimbursement.state === "reimbursed" || reimbursement.state === "partially-reimbursed") {
        summary.reimbursedCount += 1;
      }
      return summary;
    },
    {
      expectedAmount: 0,
      outstandingAmount: 0,
      receivedAmount: 0,
      reimbursableAmount: 0,
      reimbursableCount: 0,
      reimbursedCount: 0
    }
  );
}
