import type { TransactionRecord } from "@/lib/db";
import { excludeMatchedRefundReversalTransactions } from "./refund-reversals";
import { hasOpenReview, transactionSpendingAmount } from "./spending";

const DAY_MS = 86_400_000;

export type BudgetGuardrailStatus = "over" | "near" | "on-track";

export interface BudgetGuardrailItem {
  id: string | null;
  label: string;
  budgetAmount: number;
  currentAmount: number;
  trustedAmount: number;
  unresolvedReviewAmount: number;
  projectedAmount: number;
  remainingAmount: number;
  percentUsed: number;
  projectedPercent: number;
  status: BudgetGuardrailStatus;
  transactionCount: number;
  openReviewCount: number;
}

export interface BudgetGuardrailSummary {
  asOfDate: string;
  fromDate: string;
  toDate: string;
  monthElapsedDays: number;
  monthTotalDays: number;
  baselineMonthCount: number;
  overCount: number;
  nearCount: number;
  items: BudgetGuardrailItem[];
}

interface MutableGuardrailGroup {
  id: string | null;
  label: string;
  currentAmount: number;
  trustedAmount: number;
  unresolvedReviewAmount: number;
  transactionCount: number;
  openReviewCount: number;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12));
}

function daysInMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)).getUTCDate();
}

function monthKeysBefore(asOfDate: string, count: number) {
  const currentStart = parseIsoDate(monthStart(asOfDate));
  return Array.from({ length: count }, (_, index) => {
    const month = addMonths(currentStart, -(count - index));
    return isoDate(month).slice(0, 7);
  });
}

function guardrailKey(transaction: Pick<TransactionRecord, "category" | "categoryId">) {
  return transaction.categoryId ?? transaction.category;
}

function guardrailStatus(currentAmount: number, projectedAmount: number, budgetAmount: number): BudgetGuardrailStatus {
  if (currentAmount >= budgetAmount || projectedAmount >= budgetAmount * 1.1) return "over";
  if (currentAmount >= budgetAmount * 0.85 || projectedAmount >= budgetAmount * 0.9) return "near";
  return "on-track";
}

export function buildBudgetGuardrailSummary(
  transactions: readonly TransactionRecord[],
  options: {
    asOfDate?: string;
    baselineMonths?: number;
    minimumBudgetAmount?: number;
  } = {}
): BudgetGuardrailSummary {
  const reportableTransactions = excludeMatchedRefundReversalTransactions(transactions);
  const asOfDate = options.asOfDate ?? reportableTransactions.reduce(
    (latest, transaction) => transaction.date > latest ? transaction.date : latest,
    isoDate(new Date())
  );
  const baselineMonths = Math.max(1, options.baselineMonths ?? 3);
  const minimumBudgetAmount = options.minimumBudgetAmount ?? 50;
  const currentMonthFrom = monthStart(asOfDate);
  const asOf = parseIsoDate(asOfDate);
  const monthElapsedDays = Math.max(1, asOf.getUTCDate());
  const monthTotalDays = daysInMonth(asOf);
  const baselineMonthKeys = monthKeysBefore(asOfDate, baselineMonths);
  const baselineKeySet = new Set(baselineMonthKeys);
  const baselineTotals = new Map<string, { id: string | null; label: string; totals: Map<string, number> }>();
  const currentGroups = new Map<string, MutableGuardrailGroup>();

  reportableTransactions.forEach((transaction) => {
    const amount = transactionSpendingAmount(transaction);
    if (amount <= 0) return;

    const key = guardrailKey(transaction);
    const monthKey = transaction.date.slice(0, 7);

    if (baselineKeySet.has(monthKey)) {
      const baseline = baselineTotals.get(key) ?? {
        id: transaction.categoryId,
        label: transaction.category,
        totals: new Map<string, number>()
      };
      baseline.totals.set(monthKey, roundMoney((baseline.totals.get(monthKey) ?? 0) + amount));
      baselineTotals.set(key, baseline);
    }

    if (transaction.date < currentMonthFrom || transaction.date > asOfDate) return;

    const current = currentGroups.get(key) ?? {
      currentAmount: 0,
      id: transaction.categoryId,
      label: transaction.category,
      openReviewCount: 0,
      transactionCount: 0,
      trustedAmount: 0,
      unresolvedReviewAmount: 0
    };
    current.currentAmount = roundMoney(current.currentAmount + amount);
    current.transactionCount += 1;

    if (hasOpenReview(transaction)) {
      current.openReviewCount += 1;
      current.unresolvedReviewAmount = roundMoney(current.unresolvedReviewAmount + amount);
    } else {
      current.trustedAmount = roundMoney(current.trustedAmount + amount);
    }

    currentGroups.set(key, current);
  });

  const items = [...currentGroups.entries()].flatMap(([key, current]) => {
    const baseline = baselineTotals.get(key);
    if (!baseline) return [];

    const activeMonthlyTotals = [...baseline.totals.values()].filter((amount) => amount > 0);
    if (activeMonthlyTotals.length === 0) return [];

    const budgetAmount = roundMoney(activeMonthlyTotals.reduce((sum, amount) => sum + amount, 0) / activeMonthlyTotals.length);
    if (budgetAmount < minimumBudgetAmount && current.currentAmount < minimumBudgetAmount) return [];

    const projectedAmount = roundMoney((current.currentAmount / monthElapsedDays) * monthTotalDays);
    const percentUsed = budgetAmount === 0 ? 0 : roundPercent((current.currentAmount / budgetAmount) * 100);
    const projectedPercent = budgetAmount === 0 ? 0 : roundPercent((projectedAmount / budgetAmount) * 100);
    const status = guardrailStatus(current.currentAmount, projectedAmount, budgetAmount);

    return [{
      budgetAmount,
      currentAmount: current.currentAmount,
      id: current.id ?? baseline.id,
      label: current.label,
      openReviewCount: current.openReviewCount,
      percentUsed,
      projectedAmount,
      projectedPercent,
      remainingAmount: roundMoney(budgetAmount - current.currentAmount),
      status,
      transactionCount: current.transactionCount,
      trustedAmount: current.trustedAmount,
      unresolvedReviewAmount: current.unresolvedReviewAmount
    }];
  }).sort((left, right) => {
    const statusRank: Record<BudgetGuardrailStatus, number> = { over: 0, near: 1, "on-track": 2 };
    return statusRank[left.status] - statusRank[right.status] ||
      right.projectedPercent - left.projectedPercent ||
      right.currentAmount - left.currentAmount ||
      left.label.localeCompare(right.label);
  });

  return {
    asOfDate,
    baselineMonthCount: baselineMonths,
    fromDate: currentMonthFrom,
    items,
    monthElapsedDays,
    monthTotalDays,
    nearCount: items.filter((item) => item.status === "near").length,
    overCount: items.filter((item) => item.status === "over").length,
    toDate: asOfDate
  };
}
