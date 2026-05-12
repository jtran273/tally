import type {
  AccountRecord,
  RecurringExpenseRecord,
  ReviewQueueItem,
  TransactionRecord
} from "@/lib/db";
import { buildUpcomingCashflowTimeline, type UpcomingCashflowTimelineSummary } from "@/lib/finance/cashflow";
import {
  buildReimbursementReportingSummary,
  type ReimbursementReportingSummary
} from "@/lib/finance/reimbursements";
import { buildSpendingInsightSummary, type SpendingWindowSummary } from "@/lib/finance/spending";
import {
  assertFinanceManifestSafe,
  buildReviewQueueSummary,
  buildSpendingSummary,
  buildStaleSyncSummary,
  type ReviewQueueSummary,
  type SpendingSummary,
  type StaleSyncSummary
} from "./finance-action-manifest";

const DAY_MS = 86_400_000;

export interface WeeklyPlanningContextWindow {
  fromDate: string;
  previousFromDate: string;
  previousToDate: string;
  toDate: string;
}

export interface WeeklyPlanningTransferSignal {
  count: number;
  netAmount: number;
  outflowAmount: number;
}

export interface WeeklyPlanningIncomeSummary {
  currentWeekIncome: number;
  previousWeekIncome: number;
  upcomingProjectedIncome: number;
}

export interface WeeklyPlanningContext {
  action: "read.weekly_planning_context";
  asOfDate: string;
  cashflow: {
    upcoming: UpcomingCashflowTimelineSummary;
  };
  generatedAt: string;
  income: WeeklyPlanningIncomeSummary;
  reimbursements: ReimbursementReportingSummary;
  review: ReviewQueueSummary;
  spending: {
    currentWeek: SpendingWindowSummary;
    grouped: SpendingSummary;
    previousWeek: SpendingWindowSummary;
  };
  sync: StaleSyncSummary;
  transfers: WeeklyPlanningTransferSignal;
  window: WeeklyPlanningContextWindow;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  return isoDate(new Date(parseIsoDate(value).getTime() + days * DAY_MS));
}

function inDateRange(transaction: Pick<TransactionRecord, "date">, fromDate: string, toDate: string) {
  return transaction.date >= fromDate && transaction.date <= toDate;
}

function weeklyWindow(asOfDate: string): WeeklyPlanningContextWindow {
  const fromDate = addDays(asOfDate, -6);
  const previousToDate = addDays(asOfDate, -7);

  return {
    fromDate,
    previousFromDate: addDays(asOfDate, -13),
    previousToDate,
    toDate: asOfDate
  };
}

function summarizeTransfers(transactions: readonly TransactionRecord[], window: WeeklyPlanningContextWindow) {
  return transactions
    .filter((transaction) => transaction.intent === "transfer")
    .filter((transaction) => inDateRange(transaction, window.fromDate, window.toDate))
    .reduce<WeeklyPlanningTransferSignal>(
      (summary, transaction) => ({
        count: summary.count + 1,
        netAmount: roundMoney(summary.netAmount + transaction.amount),
        outflowAmount: roundMoney(summary.outflowAmount + (transaction.amount < 0 ? Math.abs(transaction.amount) : 0))
      }),
      { count: 0, netAmount: 0, outflowAmount: 0 }
    );
}

export function buildWeeklyPlanningContext({
  accounts = [],
  asOfDate,
  generatedAt,
  now = new Date(),
  recurringExpenses = [],
  reviewItems = [],
  transactions
}: {
  accounts?: readonly AccountRecord[];
  asOfDate?: string;
  generatedAt?: string;
  now?: Date;
  recurringExpenses?: readonly RecurringExpenseRecord[];
  reviewItems?: readonly ReviewQueueItem[];
  transactions: readonly TransactionRecord[];
}): WeeklyPlanningContext {
  const resolvedAsOfDate = asOfDate ?? transactions.reduce(
    (latest, transaction) => transaction.date > latest ? transaction.date : latest,
    isoDate(now)
  );
  const resolvedGeneratedAt = generatedAt ?? now.toISOString();
  const window = weeklyWindow(resolvedAsOfDate);
  const weekTransactions = transactions.filter((transaction) => inDateRange(transaction, window.fromDate, window.toDate));
  const spendingInsight = buildSpendingInsightSummary(transactions, { asOfDate: resolvedAsOfDate });
  const upcoming = buildUpcomingCashflowTimeline({
    accounts,
    asOfDate: resolvedAsOfDate,
    recurringExpenses,
    transactions
  });

  const context: WeeklyPlanningContext = {
    action: "read.weekly_planning_context",
    asOfDate: resolvedAsOfDate,
    cashflow: { upcoming },
    generatedAt: resolvedGeneratedAt,
    income: {
      currentWeekIncome: spendingInsight.currentWeek.income,
      previousWeekIncome: spendingInsight.previousWeek.income,
      upcomingProjectedIncome: upcoming.incomeTotal
    },
    reimbursements: buildReimbursementReportingSummary(weekTransactions),
    review: buildReviewQueueSummary(
      reviewItems.filter((item) => item.status === "open"),
      { generatedAt: resolvedGeneratedAt }
    ),
    spending: {
      currentWeek: spendingInsight.currentWeek,
      grouped: buildSpendingSummary(weekTransactions, {
        fromDate: window.fromDate,
        generatedAt: resolvedGeneratedAt,
        toDate: window.toDate
      }),
      previousWeek: spendingInsight.previousWeek
    },
    sync: buildStaleSyncSummary(accounts, { generatedAt: resolvedGeneratedAt, now }),
    transfers: summarizeTransfers(transactions, window),
    window
  };

  assertFinanceManifestSafe(context);
  return context;
}
