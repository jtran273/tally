import {
  buildSpendingInsightSummary,
  isSpendingIntent,
  transactionSpendingAmount,
  transactionSplitRemaining,
  transactionSplitTotal
} from "./spending";
import type { ReimbursementRecord, TransactionIntent, TransactionRecord, TransactionSplitRecord } from "@/lib/db";

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
    reimbursements: [],
    splits
  } satisfies Pick<TransactionRecord, "amount" | "intent" | "reimbursements" | "splits">;
}

function reimbursement(input: Partial<ReimbursementRecord> = {}): ReimbursementRecord {
  return {
    counterparty: "Chris",
    dueDate: "2026-05-19",
    expectedAmount: 75,
    id: "reimbursement-1",
    notes: null,
    receivedAmount: 0,
    receivedAt: null,
    receivedTransactionId: null,
    splitId: "covered-for-friends",
    status: "expected",
    transactionId: "tx-review",
    ...input
  };
}

function transaction(
  input: Pick<TransactionRecord, "amount" | "date" | "id" | "merchant"> & Partial<TransactionRecord>
): TransactionRecord {
  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Checking",
    category: "Food",
    categoryId: "category-food",
    confidence: 0.94,
    institutionName: "Seed Bank",
    intent: "personal",
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
    userId: "user-1",
    ...input
  };
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

  const partiallyReimbursedDinner = transaction({
    amount: -100,
    category: "Food",
    categoryId: "category-food",
    date: "2026-05-04",
    id: "tx-dinner-reimbursed",
    merchant: "Group dinner",
    reimbursements: [reimbursement({
      expectedAmount: 70,
      receivedAmount: 40,
      receivedAt: "2026-05-05",
      receivedTransactionId: "tx-reimbursement-inflow",
      status: "received",
      transactionId: "tx-dinner-reimbursed"
    })]
  });

  if (transactionSpendingAmount(partiallyReimbursedDinner) !== 60) {
    throw new Error("Expected confirmed reimbursements to net against spending reports.");
  }

  const summary = buildSpendingInsightSummary([
    transaction({
      amount: -400,
      category: "Travel",
      categoryId: "category-travel",
      date: "2026-05-06",
      id: "tx-flight",
      merchant: "Delta"
    }),
    partiallyReimbursedDinner,
    transaction({
      amount: -80,
      category: "Groceries",
      categoryId: "category-groceries",
      date: "2026-05-05",
      id: "tx-groceries",
      merchant: "Whole Foods"
    }),
    transaction({
      amount: 3000,
      category: "Income",
      categoryId: "category-income",
      date: "2026-05-03",
      id: "tx-payroll",
      merchant: "Payroll"
    }),
    transaction({
      amount: 25,
      category: "Reimbursements",
      categoryId: "category-reimbursements",
      date: "2026-05-03",
      id: "tx-reimbursement-inflow",
      intent: "reimbursable",
      merchant: "Chris reimbursement"
    }),
    transaction({
      amount: -60,
      category: "Groceries",
      categoryId: "category-groceries",
      date: "2026-04-29",
      id: "tx-last-week",
      merchant: "Whole Foods"
    }),
    transaction({
      amount: -220,
      category: "Travel",
      categoryId: "category-travel",
      date: "2026-04-12",
      id: "tx-last-month",
      merchant: "Delta"
    }),
    transaction({
      amount: -42,
      category: "Uncategorized",
      categoryId: null,
      confidence: 0.44,
      date: "2026-05-02",
      id: "tx-review",
      merchant: "Venmo",
      reviewStatus: "open"
    }),
    transaction({
      amount: -75,
      category: "Food",
      categoryId: "category-food",
      date: "2026-05-02",
      id: "tx-reimbursable",
      intent: "reimbursable",
      merchant: "Venmo",
      reimbursements: [reimbursement({ transactionId: "tx-reimbursable" })]
    }),
    transaction({
      amount: -999,
      category: "Transfer",
      categoryId: "category-transfer",
      date: "2026-05-01",
      id: "tx-transfer",
      intent: "transfer",
      merchant: "Card Payment"
    })
  ], { asOfDate: "2026-05-06" });

  const refundedShoppingSummary = buildSpendingInsightSummary([
    transaction({
      amount: -424.98,
      category: "Shopping",
      categoryId: "category-shopping",
      date: "2026-06-03",
      id: "tx-target-debit",
      merchant: "Target"
    }),
    transaction({
      amount: 424.98,
      category: "Shopping",
      categoryId: "category-shopping",
      date: "2026-06-04",
      id: "tx-target-credit",
      merchant: "Target refund"
    }),
    transaction({
      amount: -50,
      category: "Shopping",
      categoryId: "category-shopping",
      date: "2026-06-02",
      id: "tx-canva-debit",
      merchant: "Canva* 04900-22971910"
    }),
    transaction({
      amount: 50,
      category: "Shopping",
      categoryId: "category-shopping",
      date: "2026-06-03",
      id: "tx-canva-credit",
      merchant: "Canva",
      plaidName: "Canva refund"
    }),
    transaction({
      amount: -12,
      category: "Shopping",
      categoryId: "category-shopping",
      date: "2026-06-03",
      id: "tx-real-shopping",
      merchant: "Bookstore"
    })
  ], { asOfDate: "2026-06-04" });

  if (refundedShoppingSummary.currentWeek.spending !== 12) {
    throw new Error("Expected matched refund/reversal pairs to be excluded from spending totals.");
  }

  const shopping = refundedShoppingSummary.currentMonth.topCategories.find((category) => category.label === "Shopping");
  if (shopping?.amount !== 12 || shopping.transactionIds.join(",") !== "tx-real-shopping") {
    throw new Error("Expected refunded Target/Canva rows not to inflate Shopping category totals.");
  }

  if (summary.currentWeek.spending !== 582 || summary.currentWeek.income !== 3000 || summary.currentWeek.netCashflow !== 2418) {
    throw new Error("Expected current week cashflow to count net spend, income, transfer exclusions, and reimbursement inflow exclusions deterministically.");
  }

  if (summary.currentWeek.reimbursable !== 145 || summary.currentWeek.reimbursementOutstanding !== 105) {
    throw new Error("Expected spending summaries to surface reimbursable and outstanding reimbursement dollars.");
  }

  if (summary.currentWeek.trustedSpending !== 540 || summary.currentWeek.unresolvedReviewSpending !== 42 || summary.currentWeek.openReviewTransactionCount !== 1) {
    throw new Error("Expected spending windows to separate trusted net spending from open-review spending.");
  }

  if (summary.previousWeek.spending !== 60 || summary.currentMonth.topCategories[0]?.label !== "Travel") {
    throw new Error("Expected previous week and top category spending summaries.");
  }

  if (summary.previousMonth.spending !== 280 || summary.currentMonth.topMerchants[0]?.label !== "Delta") {
    throw new Error("Expected previous month and top merchant spending summaries.");
  }

  if (summary.currentMonth.topCategories[0]?.previousAmount !== 220 || summary.currentMonth.topCategories[0]?.deltaAmount !== 180) {
    throw new Error("Expected top category trend helpers to compare current period spend with previous period spend.");
  }

  const unresolvedCategory = summary.currentMonth.topCategories.find((category) => category.label === "Uncategorized");
  if (unresolvedCategory?.unresolvedReviewAmount !== 42 || unresolvedCategory.openReviewCount !== 1) {
    throw new Error("Expected category summaries to expose unresolved review amounts.");
  }

  if (summary.unusualSpend?.transactionId !== "tx-flight" || summary.unusualSpend.baselineAmount !== 220) {
    throw new Error("Expected large current-week spend to be compared against merchant history.");
  }

  if (summary.confidence.openReviewCount !== 1 || summary.confidence.lowConfidenceCount !== 1 || summary.confidence.uncategorizedCount !== 1) {
    throw new Error("Expected confidence caveats to stay separate from raw transaction facts.");
  }

  if (summary.confidence.spendingTransactionCount !== 4 || summary.confidence.trustedSpendingTransactionCount !== 3) {
    throw new Error("Expected confidence coverage to count only owned spending transactions.");
  }

  if (summary.confidence.categoryCoveragePercent !== 75 || summary.confidence.cleanupCandidateAmount !== 42 || summary.confidence.cleanupCandidateCount !== 1) {
    throw new Error("Expected confidence coverage to quantify category cleanup scope.");
  }

  if (summary.confidence.topCleanupActions[0]?.label !== "Uncategorized: Venmo" || summary.confidence.topCleanupActions[0]?.reasons.join(",") !== "low-confidence,open-review,uncategorized") {
    throw new Error("Expected cleanup actions to prioritize uncategorized merchants where AI review improves spending clarity.");
  }

  return true;
}
