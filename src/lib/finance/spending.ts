import type { TransactionIntent, TransactionRecord, TransactionSplitRecord } from "@/lib/db";

const SPENDING_INTENTS = new Set<TransactionIntent>(["business", "personal", "shared"]);

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function isSpendingIntent(intent: TransactionIntent) {
  return SPENDING_INTENTS.has(intent);
}

export function splitSpendingAmount(split: Pick<TransactionSplitRecord, "amount" | "intent">) {
  return isSpendingIntent(split.intent) ? Math.abs(split.amount) : 0;
}

export function transactionSpendingAmount(
  transaction: Pick<TransactionRecord, "amount" | "intent" | "splits">
) {
  if (transaction.amount >= 0) return 0;

  if (transaction.splits.length > 0) {
    return roundMoney(transaction.splits.reduce((sum, split) => sum + splitSpendingAmount(split), 0));
  }

  return isSpendingIntent(transaction.intent) ? Math.abs(transaction.amount) : 0;
}

export function transactionSplitTotal(transaction: Pick<TransactionRecord, "amount" | "splits">) {
  return roundMoney(transaction.splits.reduce((sum, split) => sum + Math.abs(split.amount), 0));
}

export function transactionSplitRemaining(transaction: Pick<TransactionRecord, "amount" | "splits">) {
  return roundMoney(Math.abs(transaction.amount) - transactionSplitTotal(transaction));
}
