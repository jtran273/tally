import type {
  AccountRecord,
  RecurringCadence,
  RecurringExpenseRecord,
  TransactionRecord
} from "@/lib/db";
import type { RecurringCandidate, RecurringPriceChangeSignal } from "@/lib/recurring";
import { summarizeSync, type SyncSummary } from "./balances";
import { buildSpendingInsightSummary, type SpendingWindowSummary } from "./spending";

export interface RecurringPriceChangeInsight {
  merchant: string;
  cadence: RecurringCadence;
  transactionId: string;
  previousAmount: number;
  currentAmount: number;
  deltaAmount: number;
  changedAt: string;
  source: RecurringPriceChangeSignal["source"];
}

export interface MonthlyCashflowRunwaySummary {
  asOfDate: string;
  currentMonth: SpendingWindowSummary;
  confirmedRecurringMonthlyLoad: number;
  confirmedRecurringCount: number;
  pendingRecurringMonthlyLoad: number;
  pendingRecurringCount: number;
  pendingRecurringExpenseCount: number;
  pendingRecurringCandidateCount: number;
  priceChanges: RecurringPriceChangeInsight[];
  monthElapsedDays: number;
  monthTotalDays: number;
  monthProgressRatio: number;
  isPartialMonth: boolean;
  syncSummary: SyncSummary;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function daysInMonth(value: string) {
  const date = parseIsoDate(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)).getUTCDate();
}

export function monthlyRecurringEquivalent(amount: number, cadence: RecurringCadence) {
  const absoluteAmount = Math.abs(amount);

  if (cadence === "weekly") return roundMoney(absoluteAmount * 52 / 12);
  if (cadence === "biweekly") return roundMoney(absoluteAmount * 26 / 12);
  if (cadence === "quarterly") return roundMoney(absoluteAmount / 3);
  if (cadence === "annual") return roundMoney(absoluteAmount / 12);
  return roundMoney(absoluteAmount);
}

function recurringPriceChange(candidate: RecurringCandidate): RecurringPriceChangeInsight | null {
  const priceChange = candidate.priceChange;
  if (!priceChange || priceChange.source !== "known-recurring") return null;

  return {
    cadence: candidate.cadence,
    changedAt: priceChange.changedAt,
    currentAmount: priceChange.currentAmount,
    deltaAmount: priceChange.deltaAmount,
    merchant: candidate.merchant,
    previousAmount: priceChange.previousAmount,
    source: priceChange.source,
    transactionId: priceChange.transactionId
  };
}

export function buildMonthlyCashflowRunwaySummary({
  accounts = [],
  asOfDate,
  now = new Date(),
  recurringCandidates = [],
  recurringExpenses,
  transactions
}: {
  accounts?: readonly AccountRecord[];
  asOfDate?: string;
  now?: Date;
  recurringCandidates?: readonly RecurringCandidate[];
  recurringExpenses: readonly RecurringExpenseRecord[];
  transactions: readonly TransactionRecord[];
}): MonthlyCashflowRunwaySummary {
  const resolvedAsOfDate = asOfDate ?? isoDate(now);
  const spending = buildSpendingInsightSummary(transactions, { asOfDate: resolvedAsOfDate });
  const monthTotalDays = daysInMonth(resolvedAsOfDate);
  const monthElapsedDays = Math.min(parseIsoDate(resolvedAsOfDate).getUTCDate(), monthTotalDays);

  const activeExpenses = recurringExpenses.filter((expense) => expense.status === "active");
  const pendingExpenses = recurringExpenses.filter((expense) => expense.status === "pending" || expense.isNew);
  const pendingCandidates = recurringCandidates.filter((candidate) => candidate.isNew);

  const confirmedRecurringMonthlyLoad = roundMoney(
    activeExpenses.reduce((sum, expense) => sum + monthlyRecurringEquivalent(expense.amount, expense.cadence), 0)
  );
  const pendingRecurringMonthlyLoad = roundMoney(
    pendingExpenses.reduce((sum, expense) => sum + monthlyRecurringEquivalent(expense.amount, expense.cadence), 0) +
    pendingCandidates.reduce((sum, candidate) => sum + monthlyRecurringEquivalent(candidate.amount, candidate.cadence), 0)
  );

  return {
    asOfDate: resolvedAsOfDate,
    confirmedRecurringCount: activeExpenses.length,
    confirmedRecurringMonthlyLoad,
    currentMonth: spending.currentMonth,
    isPartialMonth: monthElapsedDays < monthTotalDays,
    monthElapsedDays,
    monthProgressRatio: monthTotalDays === 0 ? 0 : monthElapsedDays / monthTotalDays,
    monthTotalDays,
    pendingRecurringCandidateCount: pendingCandidates.length,
    pendingRecurringCount: pendingExpenses.length + pendingCandidates.length,
    pendingRecurringExpenseCount: pendingExpenses.length,
    pendingRecurringMonthlyLoad,
    priceChanges: recurringCandidates
      .map(recurringPriceChange)
      .filter((change): change is RecurringPriceChangeInsight => Boolean(change)),
    syncSummary: summarizeSync(accounts, { now })
  };
}
