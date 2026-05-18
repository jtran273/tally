import type { TransactionIntent, TransactionRecord, TransactionSplitRecord } from "@/lib/db";
import { isRecurringReview } from "@/lib/review/reasons";
import { displayCategoryName } from "./classification";
import { isReportableIncomeIntent } from "./reimbursement-linking";
import { summarizeTransactionReimbursement } from "./reimbursements";

const SPENDING_INTENTS = new Set<TransactionIntent>(["business", "personal", "shared"]);
const DAY_MS = 86_400_000;

export interface SpendingGroupSummary {
  id: string | null;
  label: string;
  amount: number;
  trustedAmount: number;
  unresolvedReviewAmount: number;
  previousAmount: number;
  deltaAmount: number;
  deltaPercent: number;
  count: number;
  openReviewCount: number;
  transactionIds: string[];
}

export type CategoryCleanupReason = "low-confidence" | "open-review" | "uncategorized";

export interface CategoryCleanupAction {
  id: string | null;
  label: string;
  amount: number;
  count: number;
  lowConfidenceCount: number;
  openReviewCount: number;
  reasons: CategoryCleanupReason[];
  transactionIds: string[];
  uncategorizedCount: number;
}

export interface SpendingWindowSummary {
  fromDate: string;
  toDate: string;
  spending: number;
  reimbursable: number;
  reimbursementOutstanding: number;
  trustedSpending: number;
  unresolvedReviewSpending: number;
  income: number;
  netCashflow: number;
  transactionCount: number;
  openReviewTransactionCount: number;
  topCategories: SpendingGroupSummary[];
  topMerchants: SpendingGroupSummary[];
}

export interface UnusualSpendSummary {
  transactionId: string;
  merchant: string;
  category: string;
  amount: number;
  date: string;
  baselineAmount: number | null;
}

export interface SpendingConfidenceSummary {
  categoryCoveragePercent: number;
  cleanupCandidateAmount: number;
  cleanupCandidateCount: number;
  lowConfidenceCount: number;
  openReviewCount: number;
  spendingTransactionCount: number;
  topCleanupActions: CategoryCleanupAction[];
  trustedSpendingTransactionCount: number;
  uncategorizedCount: number;
}

export interface SpendingInsightSummary {
  asOfDate: string;
  currentWeek: SpendingWindowSummary;
  previousWeek: SpendingWindowSummary;
  currentMonth: SpendingWindowSummary;
  previousMonth: SpendingWindowSummary;
  unusualSpend: UnusualSpendSummary | null;
  confidence: SpendingConfidenceSummary;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function previousMonthStart(value: string) {
  const date = parseIsoDate(monthStart(value));
  return isoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1, 12)));
}

function previousMonthEnd(value: string) {
  const date = parseIsoDate(monthStart(value));
  return isoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0, 12)));
}

function inDateRange(transaction: Pick<TransactionRecord, "date">, fromDate: string, toDate: string) {
  return transaction.date >= fromDate && transaction.date <= toDate;
}

function groupedCategoryLabel(transaction: Pick<TransactionRecord, "category">) {
  return displayCategoryName(transaction.category);
}

function groupedCategoryKey(transaction: Pick<TransactionRecord, "category">) {
  return groupedCategoryLabel(transaction);
}

function categoryIdsValue(categoryIds: Set<string>) {
  return categoryIds.size > 0 ? [...categoryIds].sort().join(",") : null;
}

function groupSpending(
  transactions: readonly TransactionRecord[],
  group: "category" | "merchant",
  previousTransactions: readonly TransactionRecord[] = []
): SpendingGroupSummary[] {
  type InternalGroup = SpendingGroupSummary & { categoryIds: Set<string> };
  const grouped = new Map<string, InternalGroup>();
  const previousGrouped = new Map<string, number>();

  previousTransactions.forEach((transaction) => {
    const amount = transactionSpendingAmount(transaction);
    if (amount <= 0) return;

    const key = group === "category" ? groupedCategoryKey(transaction) : transaction.merchant;
    previousGrouped.set(key, roundMoney((previousGrouped.get(key) ?? 0) + amount));
  });

  transactions.forEach((transaction) => {
    const amount = transactionSpendingAmount(transaction);
    if (amount <= 0) return;

    const id = group === "category" ? null : transaction.merchant;
    const label = group === "category" ? groupedCategoryLabel(transaction) : transaction.merchant;
    const key = group === "category" ? label : transaction.merchant;
    const current = grouped.get(key) ?? {
      amount: 0,
      categoryIds: new Set<string>(),
      deltaAmount: 0,
      deltaPercent: 0,
      count: 0,
      id,
      label,
      openReviewCount: 0,
      previousAmount: 0,
      trustedAmount: 0,
      transactionIds: [],
      unresolvedReviewAmount: 0
    };

    current.amount = roundMoney(current.amount + amount);
    if (hasOpenReview(transaction)) {
      current.openReviewCount += 1;
      current.unresolvedReviewAmount = roundMoney(current.unresolvedReviewAmount + amount);
    } else {
      current.trustedAmount = roundMoney(current.trustedAmount + amount);
    }
    current.count += 1;
    current.transactionIds.push(transaction.id);
    if (group === "category" && transaction.categoryId) current.categoryIds.add(transaction.categoryId);
    grouped.set(key, current);
  });

  return [...grouped.values()]
    .map((item) => {
      const previousAmount = previousGrouped.get(item.label) ?? 0;
      const deltaAmount = roundMoney(item.amount - previousAmount);
      const { categoryIds, ...publicItem } = item;
      return {
        ...publicItem,
        deltaAmount,
        deltaPercent: deltaPercent(item.amount, previousAmount),
        id: group === "category" ? categoryIdsValue(categoryIds) : item.id,
        previousAmount
      };
    })
    .sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label))
    .slice(0, 5);
}

function summarizeWindow(
  transactions: readonly TransactionRecord[],
  fromDate: string,
  toDate: string,
  previousTransactions: readonly TransactionRecord[] = []
): SpendingWindowSummary {
  const windowTransactions = transactions.filter((transaction) => inDateRange(transaction, fromDate, toDate));
  const totals = windowTransactions.reduce(
    (summary, transaction) => {
      const reimbursement = summarizeTransactionReimbursement(transaction);
      const spendingAmount = transactionSpendingAmount(transaction);
      summary.spending += spendingAmount;
      summary.reimbursable += reimbursement.reimbursableAmount;
      summary.reimbursementOutstanding += reimbursement.outstandingAmount;
      if (spendingAmount > 0 && hasOpenReview(transaction)) {
        summary.openReviewTransactionCount += 1;
        summary.unresolvedReviewSpending += spendingAmount;
      } else {
        summary.trustedSpending += spendingAmount;
      }
      if (transaction.amount > 0 && isReportableIncomeIntent(transaction.intent)) summary.income += transaction.amount;
      return summary;
    },
    {
      income: 0,
      openReviewTransactionCount: 0,
      reimbursable: 0,
      reimbursementOutstanding: 0,
      spending: 0,
      trustedSpending: 0,
      unresolvedReviewSpending: 0
    }
  );

  const spending = roundMoney(totals.spending);
  const income = roundMoney(totals.income);

  return {
    fromDate,
    income,
    netCashflow: roundMoney(income - spending),
    openReviewTransactionCount: totals.openReviewTransactionCount,
    reimbursable: roundMoney(totals.reimbursable),
    reimbursementOutstanding: roundMoney(totals.reimbursementOutstanding),
    spending,
    trustedSpending: roundMoney(totals.trustedSpending),
    toDate,
    topCategories: groupSpending(windowTransactions, "category", previousTransactions),
    topMerchants: groupSpending(windowTransactions, "merchant", previousTransactions),
    transactionCount: windowTransactions.length,
    unresolvedReviewSpending: roundMoney(totals.unresolvedReviewSpending)
  };
}

function summarizeConfidence(transactions: readonly TransactionRecord[]): SpendingConfidenceSummary {
  const cleanupGroups = new Map<string, CategoryCleanupAction>();
  let cleanupCandidateAmount = 0;
  let cleanupCandidateCount = 0;
  let lowConfidenceCount = 0;
  let openReviewCount = 0;
  let spendingTransactionCount = 0;
  let trustedSpendingTransactionCount = 0;
  let uncategorizedCount = 0;

  transactions.forEach((transaction) => {
    const spendingAmount = transactionSpendingAmount(transaction);
    if (spendingAmount <= 0) return;

    spendingTransactionCount += 1;

    const lowConfidence = transaction.confidence < 0.75;
    const openReview = hasOpenReview(transaction);
    const uncategorized = !transaction.categoryId || transaction.category.toLowerCase() === "uncategorized";
    const reasons: CategoryCleanupReason[] = [];

    if (lowConfidence) {
      lowConfidenceCount += 1;
      reasons.push("low-confidence");
    }
    if (openReview) {
      openReviewCount += 1;
      reasons.push("open-review");
    }
    if (uncategorized) {
      uncategorizedCount += 1;
      reasons.push("uncategorized");
    }

    if (reasons.length === 0) {
      trustedSpendingTransactionCount += 1;
      return;
    }

    cleanupCandidateAmount = roundMoney(cleanupCandidateAmount + spendingAmount);
    cleanupCandidateCount += 1;

    const groupKey = uncategorized
      ? `uncategorized:${transaction.merchant.toLowerCase()}`
      : groupedCategoryKey(transaction);
    const groupLabel = uncategorized ? `Uncategorized: ${transaction.merchant}` : groupedCategoryLabel(transaction);
    const group = cleanupGroups.get(groupKey) ?? {
      amount: 0,
      count: 0,
      id: transaction.categoryId,
      label: groupLabel,
      lowConfidenceCount: 0,
      openReviewCount: 0,
      reasons: [],
      transactionIds: [],
      uncategorizedCount: 0
    };

    group.amount = roundMoney(group.amount + spendingAmount);
    group.count += 1;
    group.lowConfidenceCount += lowConfidence ? 1 : 0;
    group.openReviewCount += openReview ? 1 : 0;
    group.uncategorizedCount += uncategorized ? 1 : 0;
    group.transactionIds.push(transaction.id);
    group.reasons = [...new Set([...group.reasons, ...reasons])];
    cleanupGroups.set(groupKey, group);
  });

  const categoryCoveragePercent = spendingTransactionCount === 0
    ? 100
    : Math.round((trustedSpendingTransactionCount / spendingTransactionCount) * 1000) / 10;

  return {
    categoryCoveragePercent,
    cleanupCandidateAmount,
    cleanupCandidateCount,
    lowConfidenceCount,
    openReviewCount,
    spendingTransactionCount,
    topCleanupActions: [...cleanupGroups.values()]
      .sort((left, right) => right.amount - left.amount || right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, 4),
    trustedSpendingTransactionCount,
    uncategorizedCount
  };
}

function findUnusualSpend(
  transactions: readonly TransactionRecord[],
  currentWeek: SpendingWindowSummary
): UnusualSpendSummary | null {
  const weekTransactions = transactions
    .filter((transaction) => inDateRange(transaction, currentWeek.fromDate, currentWeek.toDate))
    .map((transaction) => ({ amount: transactionSpendingAmount(transaction), transaction }))
    .filter((item) => item.amount > 0)
    .sort((left, right) => right.amount - left.amount);

  for (const { amount, transaction } of weekTransactions) {
    const history = transactions
      .filter((candidate) => (
        candidate.date < currentWeek.fromDate &&
        candidate.merchant === transaction.merchant &&
        transactionSpendingAmount(candidate) > 0
      ))
      .map(transactionSpendingAmount);

    const baseline = history.length > 0
      ? roundMoney(history.reduce((sum, value) => sum + value, 0) / history.length)
      : null;
    const threshold = baseline === null ? 250 : Math.max(100, baseline * 1.75);

    if (amount >= threshold) {
      return {
        amount,
        baselineAmount: baseline,
        category: transaction.category,
        date: transaction.date,
        merchant: transaction.merchant,
        transactionId: transaction.id
      };
    }
  }

  return null;
}

export function isSpendingIntent(intent: TransactionIntent) {
  return SPENDING_INTENTS.has(intent);
}

export function splitSpendingAmount(split: Pick<TransactionSplitRecord, "amount" | "intent">) {
  return isSpendingIntent(split.intent) ? Math.abs(split.amount) : 0;
}

export function transactionSpendingAmount(
  transaction: Pick<TransactionRecord, "amount" | "intent" | "reimbursements" | "splits">
) {
  if (transaction.amount >= 0) return 0;

  const grossSpending = transaction.splits.length > 0
    ? transaction.splits.reduce((sum, split) => sum + splitSpendingAmount(split), 0)
    : isSpendingIntent(transaction.intent)
      ? Math.abs(transaction.amount)
      : 0;
  if (grossSpending <= 0) return 0;

  const confirmedReimbursements = transaction.reimbursements.reduce((sum, reimbursement) => {
    if (reimbursement.receivedTransactionId && reimbursement.status === "received") {
      return sum + reimbursement.receivedAmount;
    }
    return sum;
  }, 0);

  return roundMoney(Math.max(0, grossSpending - confirmedReimbursements));
}

export function hasOpenReview(
  transaction: Pick<TransactionRecord, "reviewStatus"> & {
    reviewItems: readonly Pick<TransactionRecord["reviewItems"][number], "reason" | "status">[];
  }
) {
  if (transaction.reviewItems.length > 0) {
    return transaction.reviewItems.some((item) => item.status === "open" && !isRecurringReview(item.reason));
  }

  return transaction.reviewStatus === "open";
}

export function deltaPercent(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function transactionSplitTotal(transaction: Pick<TransactionRecord, "amount" | "splits">) {
  return roundMoney(transaction.splits.reduce((sum, split) => sum + Math.abs(split.amount), 0));
}

export function transactionSplitRemaining(transaction: Pick<TransactionRecord, "amount" | "splits">) {
  return roundMoney(Math.abs(transaction.amount) - transactionSplitTotal(transaction));
}

export interface CategoryBreakdownRow {
  id: string | null;
  label: string;
  amount: number;
  count: number;
  percent: number;
  previousAmount: number;
  deltaAmount: number;
  deltaPercent: number;
  openReviewCount: number;
}

export interface CategoryBreakdownSummary {
  fromDate: string;
  toDate: string;
  totalAmount: number;
  rows: CategoryBreakdownRow[];
}

function buildCategoryBreakdownForRange(
  transactions: readonly TransactionRecord[],
  fromDate: string,
  toDate: string,
  previousFrom: string,
  previousTo: string
): CategoryBreakdownSummary {
  const currentRows = new Map<string, {
    amount: number;
    categoryIds: Set<string>;
    count: number;
    label: string;
    openReviewCount: number;
  }>();
  const previousAmounts = new Map<string, number>();
  let totalAmount = 0;

  transactions.forEach((transaction) => {
    if (transaction.date < previousFrom || transaction.date > toDate) return;
    const amount = transactionSpendingAmount(transaction);
    if (amount <= 0) return;

    const label = groupedCategoryLabel(transaction);
    const key = groupedCategoryKey(transaction);

    if (transaction.date >= fromDate) {
      const current = currentRows.get(key) ?? {
        amount: 0,
        categoryIds: new Set<string>(),
        count: 0,
        label,
        openReviewCount: 0
      };
      current.amount = roundMoney(current.amount + amount);
      current.count += 1;
      if (hasOpenReview(transaction)) current.openReviewCount += 1;
      if (transaction.categoryId) current.categoryIds.add(transaction.categoryId);
      currentRows.set(key, current);
      totalAmount = roundMoney(totalAmount + amount);
    } else if (transaction.date >= previousFrom && transaction.date <= previousTo) {
      previousAmounts.set(key, roundMoney((previousAmounts.get(key) ?? 0) + amount));
    }
  });

  const rows: CategoryBreakdownRow[] = [...currentRows.values()].map((row) => {
    const previousAmount = previousAmounts.get(row.label) ?? 0;
    const deltaAmount = roundMoney(row.amount - previousAmount);
    return {
      amount: row.amount,
      count: row.count,
      deltaAmount,
      deltaPercent: deltaPercent(row.amount, previousAmount),
      id: categoryIdsValue(row.categoryIds),
      label: row.label,
      openReviewCount: row.openReviewCount,
      percent: totalAmount > 0 ? Math.round((row.amount / totalAmount) * 1000) / 10 : 0,
      previousAmount
    };
  }).sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

  return { fromDate, toDate, totalAmount, rows };
}

function monthBoundsFor(asOfDate: string, monthOffset: number) {
  const date = parseIsoDate(monthStart(asOfDate));
  const targetStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthOffset, 1, 12));
  const targetEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthOffset + 1, 0, 12));
  const previousStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthOffset - 1, 1, 12));
  const previousEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthOffset, 0, 12));
  return {
    fromDate: isoDate(targetStart),
    toDate: isoDate(targetEnd),
    previousFrom: isoDate(previousStart),
    previousTo: isoDate(previousEnd)
  };
}

export function buildCategoryBreakdown(
  transactions: readonly TransactionRecord[],
  options: { asOfDate?: string } = {}
): CategoryBreakdownSummary {
  const asOfDate = options.asOfDate ?? transactions.reduce(
    (latest, transaction) => transaction.date > latest ? transaction.date : latest,
    isoDate(new Date())
  );
  const fromDate = monthStart(asOfDate);
  const previousFrom = previousMonthStart(asOfDate);
  const previousTo = previousMonthEnd(asOfDate);

  return buildCategoryBreakdownForRange(transactions, fromDate, asOfDate, previousFrom, previousTo);
}

/**
 * Build breakdowns for the last `monthCount` calendar months, newest first.
 * The current month uses asOfDate as toDate; older months use the month end.
 */
export function buildCategoryBreakdownsByMonth(
  transactions: readonly TransactionRecord[],
  options: { asOfDate?: string; monthCount?: number } = {}
): CategoryBreakdownSummary[] {
  const asOfDate = options.asOfDate ?? transactions.reduce(
    (latest, transaction) => transaction.date > latest ? transaction.date : latest,
    isoDate(new Date())
  );
  const monthCount = Math.max(1, Math.min(12, options.monthCount ?? 6));

  const results: CategoryBreakdownSummary[] = [];
  for (let offset = 0; offset < monthCount; offset += 1) {
    const bounds = monthBoundsFor(asOfDate, offset);
    const toDate = offset === 0 ? asOfDate : bounds.toDate;
    results.push(buildCategoryBreakdownForRange(
      transactions,
      bounds.fromDate,
      toDate,
      bounds.previousFrom,
      bounds.previousTo
    ));
  }
  return results;
}

export function buildSpendingInsightSummary(
  transactions: readonly TransactionRecord[],
  options: { asOfDate?: string } = {}
): SpendingInsightSummary {
  const asOfDate = options.asOfDate ?? transactions.reduce(
    (latest, transaction) => transaction.date > latest ? transaction.date : latest,
    isoDate(new Date())
  );
  const asOf = parseIsoDate(asOfDate);
  const currentWeekFrom = isoDate(addDays(asOf, -6));
  const previousWeekTo = isoDate(addDays(asOf, -7));
  const previousWeekFrom = isoDate(addDays(asOf, -13));
  const currentMonthFrom = monthStart(asOfDate);
  const previousMonthFrom = previousMonthStart(asOfDate);
  const previousMonthTo = previousMonthEnd(asOfDate);

  const previousWeekTransactions = transactions.filter((transaction) => inDateRange(transaction, previousWeekFrom, previousWeekTo));
  const previousMonthTransactions = transactions.filter((transaction) => inDateRange(transaction, previousMonthFrom, previousMonthTo));
  const currentWeek = summarizeWindow(transactions, currentWeekFrom, asOfDate, previousWeekTransactions);

  return {
    asOfDate,
    confidence: summarizeConfidence(transactions.filter((transaction) => transaction.date >= currentMonthFrom && transaction.date <= asOfDate)),
    currentMonth: summarizeWindow(transactions, currentMonthFrom, asOfDate, previousMonthTransactions),
    currentWeek,
    previousMonth: summarizeWindow(transactions, previousMonthFrom, previousMonthTo),
    previousWeek: summarizeWindow(transactions, previousWeekFrom, previousWeekTo),
    unusualSpend: findUnusualSpend(transactions, currentWeek)
  };
}
