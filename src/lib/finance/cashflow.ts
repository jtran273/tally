import type {
  AccountRecord,
  RecurringCadence,
  RecurringExpenseRecord,
  TransactionRecord
} from "@/lib/db";
import type { RecurringCandidate, RecurringPriceChangeSignal } from "@/lib/recurring";
import { summarizeSync, type SyncSummary } from "./balances";
import { isReportableIncomeIntent } from "./reimbursement-linking";
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
  upcomingCashflow: UpcomingCashflowTimelineSummary;
}

export type UpcomingCashflowEventDirection = "bill" | "income";
export type UpcomingCashflowEventSource = "recurring-expense" | "transaction-history";

export interface UpcomingCashflowEvent {
  id: string;
  amount: number;
  cadence: RecurringCadence;
  date: string;
  direction: UpcomingCashflowEventDirection;
  merchant: string;
  source: UpcomingCashflowEventSource;
  status: "confirmed" | "pending" | "projected";
}

export interface UpcomingCashflowTimelineSummary {
  asOfDate: string;
  billTotal: number;
  days: number;
  dueSoonCount: number;
  endDate: string;
  events: UpcomingCashflowEvent[];
  incomeTotal: number;
  netTotal: number;
  projectedCashBalance: number | null;
  startingCashBalance: number | null;
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

function addDays(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function clampDay(year: number, month: number, day: number) {
  return Math.min(day, new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate());
}

function addMonths(value: string, months: number) {
  const date = parseIsoDate(value);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const target = new Date(Date.UTC(year, month, 1, 12));
  target.setUTCDate(clampDay(target.getUTCFullYear(), target.getUTCMonth(), date.getUTCDate()));
  return isoDate(target);
}

function addCadence(value: string, cadence: RecurringCadence) {
  if (cadence === "weekly") return addDays(value, 7);
  if (cadence === "biweekly") return addDays(value, 14);
  if (cadence === "quarterly") return addMonths(value, 3);
  if (cadence === "annual") return addMonths(value, 12);
  return addMonths(value, 1);
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

function daysBetween(left: string, right: string) {
  return Math.round((parseIsoDate(right).getTime() - parseIsoDate(left).getTime()) / 86_400_000);
}

function inferRecurringIncomeCadence(transactions: readonly TransactionRecord[]): RecurringCadence | null {
  if (transactions.length < 2) return null;

  const sorted = [...transactions].sort((left, right) => left.date.localeCompare(right.date));
  const intervals = sorted
    .slice(1)
    .map((transaction, index) => daysBetween(sorted[index].date, transaction.date))
    .filter((interval) => interval > 0);
  if (intervals.length === 0) return null;

  const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  if (averageInterval >= 5 && averageInterval <= 9) return "weekly";
  if (averageInterval >= 10 && averageInterval <= 20) return "biweekly";
  if (averageInterval >= 25 && averageInterval <= 45) return "monthly";
  if (averageInterval >= 80 && averageInterval <= 105) return "quarterly";
  if (averageInterval >= 330 && averageInterval <= 400) return "annual";
  return null;
}

function recurringIncomeGroups(transactions: readonly TransactionRecord[]) {
  const groups = new Map<string, TransactionRecord[]>();

  transactions.forEach((transaction) => {
    if (
      transaction.amount <= 0 ||
      !transaction.recurring ||
      !isReportableIncomeIntent(transaction.intent) ||
      transaction.status !== "posted"
    ) {
      return;
    }

    const key = `${transaction.accountId}:${transaction.merchant.toLowerCase()}`;
    groups.set(key, [...groups.get(key) ?? [], transaction]);
  });

  return [...groups.values()];
}

function cashBalance(accounts: readonly AccountRecord[]) {
  const cashAccounts = accounts.filter((account) => account.type === "depository" && account.isActive);
  if (cashAccounts.length === 0) return null;
  return roundMoney(cashAccounts.reduce((sum, account) => sum + account.balance, 0));
}

export function buildUpcomingCashflowTimeline({
  accounts = [],
  asOfDate,
  days = 30,
  recurringExpenses,
  transactions
}: {
  accounts?: readonly AccountRecord[];
  asOfDate: string;
  days?: number;
  recurringExpenses: readonly RecurringExpenseRecord[];
  transactions: readonly TransactionRecord[];
}): UpcomingCashflowTimelineSummary {
  const endDate = addDays(asOfDate, days);
  const events: UpcomingCashflowEvent[] = [];

  recurringExpenses
    .filter((expense) => expense.status === "active" || expense.status === "pending" || expense.isNew)
    .forEach((expense) => {
      let dueDate = expense.nextDueDate;
      while (dueDate < asOfDate) {
        dueDate = addCadence(dueDate, expense.cadence);
      }

      let occurrence = 1;
      while (dueDate <= endDate) {
        events.push({
          amount: roundMoney(Math.abs(expense.amount)),
          cadence: expense.cadence,
          date: dueDate,
          direction: "bill",
          id: `recurring-expense:${expense.id}:${dueDate}:${occurrence}`,
          merchant: expense.merchant,
          source: "recurring-expense",
          status: expense.status === "active" ? "confirmed" : "pending"
        });
        dueDate = addCadence(dueDate, expense.cadence);
        occurrence += 1;
      }
    });

  recurringIncomeGroups(transactions).forEach((group) => {
    const cadence = inferRecurringIncomeCadence(group);
    if (!cadence) return;

    const sorted = [...group].sort((left, right) => left.date.localeCompare(right.date));
    const latest = sorted[sorted.length - 1];
    let dueDate = addCadence(latest.date, cadence);
    while (dueDate <= asOfDate) {
      dueDate = addCadence(dueDate, cadence);
    }

    let occurrence = 1;
    while (dueDate <= endDate) {
      events.push({
        amount: roundMoney(Math.abs(latest.amount)),
        cadence,
        date: dueDate,
        direction: "income",
        id: `transaction-history:${latest.accountId}:${latest.merchant.toLowerCase()}:${dueDate}:${occurrence}`,
        merchant: latest.merchant,
        source: "transaction-history",
        status: "projected"
      });
      dueDate = addCadence(dueDate, cadence);
      occurrence += 1;
    }
  });

  events.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.direction !== right.direction) return left.direction === "income" ? -1 : 1;
    return left.merchant.localeCompare(right.merchant);
  });

  const incomeTotal = roundMoney(events.reduce((sum, event) => sum + (event.direction === "income" ? event.amount : 0), 0));
  const billTotal = roundMoney(events.reduce((sum, event) => sum + (event.direction === "bill" ? event.amount : 0), 0));
  const netTotal = roundMoney(incomeTotal - billTotal);
  const startingCashBalance = cashBalance(accounts);

  return {
    asOfDate,
    billTotal,
    days,
    dueSoonCount: events.filter((event) => event.direction === "bill" && daysBetween(asOfDate, event.date) <= 7).length,
    endDate,
    events,
    incomeTotal,
    netTotal,
    projectedCashBalance: startingCashBalance === null ? null : roundMoney(startingCashBalance + netTotal),
    startingCashBalance
  };
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
    syncSummary: summarizeSync(accounts, { now }),
    upcomingCashflow: buildUpcomingCashflowTimeline({
      accounts,
      asOfDate: resolvedAsOfDate,
      recurringExpenses,
      transactions
    })
  };
}
