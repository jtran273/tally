import {
  isSpendingIntent,
  transactionSpendingAmount,
  transactionSplitRemaining,
  transactionSplitTotal
} from "./spending";
import type { TransactionIntent, TransactionRecord, TransactionSplitRecord } from "@/lib/db";

function split(
  id: string,
  amount: number,
  intent: TransactionIntent
): TransactionSplitRecord {
  return {
    id,
    amount,
    categoryId: "category-food",
    categoryName: "Food / Restaurants",
    intent,
    label: id,
    notes: null,
    transactionId: "txn-split"
  };
}

function tx(amount: number, intent: TransactionIntent, splits: TransactionSplitRecord[] = []) {
  return {
    amount,
    intent,
    splits
  } satisfies Pick<TransactionRecord, "amount" | "intent" | "splits">;
}

export const spendingFixtureAssertions = assertSpendingFixtures();

function assertSpendingFixtures(): true {
  if (!isSpendingIntent("personal") || !isSpendingIntent("shared") || isSpendingIntent("transfer")) {
    throw new Error("Expected only owned spending intents to count as spending.");
  }

  const splitTransaction = tx(-121.35, "shared", [
    split("my-share", 46.35, "personal"),
    split("covered-for-friends", 75, "reimbursable")
  ]);

  if (transactionSpendingAmount(splitTransaction) !== 46.35) {
    throw new Error("Expected reimbursable split amounts to be excluded from spending.");
  }

  if (transactionSplitTotal(splitTransaction) !== 121.35 || transactionSplitRemaining(splitTransaction) !== 0) {
    throw new Error("Expected split allocation to be fully counted in absolute dollars.");
  }

  if (transactionSpendingAmount(tx(-92.4, "shared")) !== 92.4) {
    throw new Error("Expected unsplit shared outflows to fall back to transaction amount.");
  }

  if (transactionSpendingAmount(tx(75, "personal", [split("incoming", 75, "personal")])) !== 0) {
    throw new Error("Expected positive transactions to preserve sign semantics and not count as spending.");
  }

  return true;
}
