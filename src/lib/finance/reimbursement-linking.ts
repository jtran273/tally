import type { ReimbursementRecord, TransactionRecord } from "@/lib/db";

export type ReimbursementLinkStatus = "requested" | "received";

export interface ReimbursementLinkDecision {
  appliedAmount: number;
  outstandingAmount: number;
  receivedAt: string;
  status: ReimbursementLinkStatus;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildReimbursementLinkDecision(
  reimbursement: Pick<ReimbursementRecord, "expectedAmount" | "receivedAmount">,
  receivedTransaction: Pick<TransactionRecord, "amount" | "date">,
  options: { appliedAmount?: number } = {}
): ReimbursementLinkDecision {
  if (receivedTransaction.amount <= 0) {
    throw new Error("Reimbursement links require a positive inflow transaction.");
  }

  const requestedAmount = options.appliedAmount === undefined
    ? Math.min(receivedTransaction.amount, reimbursement.expectedAmount)
    : options.appliedAmount;
  const appliedAmount = roundMoney(requestedAmount);

  if (appliedAmount <= 0) {
    throw new Error("Applied reimbursement amount must be greater than zero.");
  }
  if (appliedAmount > roundMoney(receivedTransaction.amount)) {
    throw new Error("Applied reimbursement amount cannot exceed the received inflow.");
  }
  if (appliedAmount > roundMoney(reimbursement.expectedAmount)) {
    throw new Error("Applied reimbursement amount cannot exceed the expected reimbursement.");
  }

  const outstandingAmount = roundMoney(Math.max(0, reimbursement.expectedAmount - appliedAmount));

  return {
    appliedAmount,
    outstandingAmount,
    receivedAt: receivedTransaction.date,
    status: outstandingAmount === 0 ? "received" : "requested"
  };
}

export function isReportableIncomeIntent(intent: TransactionRecord["intent"]) {
  return intent !== "transfer" && intent !== "reimbursable";
}
