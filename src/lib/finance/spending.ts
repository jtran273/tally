import type { TransactionIntent, TransactionRecord, TransactionSplitRecord } from "@/lib/db";

const SPENDING_INTENTS = new Set<TransactionIntent>(["business", "personal", "shared"]);
const DAY_MS = 86_400_000;

export interface SpendingGroupSummary {
  id: string | null;
  label: string;
  amount: number;
  count: number;
  transactionIds: string[];
}

export interface SpendingWindowSummary {
  fromDate: string;
  toDate: string;
  spending: number;
  income: number;
  netCashflow: number;
  transactionCount: number;
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
  lowConfidenceCount: number;
  openReviewCount: number;
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

function groupSpending(
  transactions: readonly TransactionRecord[],
  group: "category" | "merchant"
): SpendingGroupSummary[] {
  const grouped = new Map<string, SpendingGroupSummary>();

  transactions.forEach((transaction) => {
    const amount = transactionSpendingAmount(transaction);
    if (amount <= 0) return;

    const id = group === "category" ? transaction.categoryId : transaction.merchant;
    const label = group === "category" ? transaction.category : transaction.merchant;
    const key = id ?? label;
    const current = grouped.get(key) ?? {
      amount: 0,
      count: 0,
      id,
      label,
      transactionIds: []
    };

    current.amount = roundMoney(current.amount + amount);
    current.count += 1;
    current.transactionIds.push(transaction.id);
    grouped.set(key, current);
  });

  return [...grouped.values()]
    .sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label))
    .slice(0, 5);
}

function summarizeWindow(
  transactions: readonly TransactionRecord[],
  fromDate: string,
  toDate: string
): SpendingWindowSummary {
  const windowTransactions = transactions.filter((transaction) => inDateRange(transaction, fromDate, toDate));
  const totals = windowTransactions.reduce(
    (summary, transaction) => {
      summary.spending += transactionSpendingAmount(transaction);
      if (transaction.amount > 0 && transaction.intent !== "transfer") summary.income += transaction.amount;
      return summary;
    },
    { income: 0, spending: 0 }
  );

  const spending = roundMoney(totals.spending);
  const income = roundMoney(totals.income);

  return {
    fromDate,
    income,
    netCashflow: roundMoney(income - spending),
    spending,
    toDate,
    topCategories: groupSpending(windowTransactions, "category"),
    topMerchants: groupSpending(windowTransactions, "merchant"),
    transactionCount: windowTransactions.length
  };
}

function summarizeConfidence(transactions: readonly TransactionRecord[]): SpendingConfidenceSummary {
  return transactions.reduce(
    (summary, transaction) => {
      if (transaction.confidence < 0.75) summary.lowConfidenceCount += 1;
      if (transaction.reviewStatus === "open" || transaction.reviewItems.some((item) => item.status === "open")) {
        summary.openReviewCount += 1;
      }
      if (!transaction.categoryId || transaction.category.toLowerCase() === "uncategorized") {
        summary.uncategorizedCount += 1;
      }
      return summary;
    },
    { lowConfidenceCount: 0, openReviewCount: 0, uncategorizedCount: 0 }
  );
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

  const currentWeek = summarizeWindow(transactions, currentWeekFrom, asOfDate);

  return {
    asOfDate,
    confidence: summarizeConfidence(transactions.filter((transaction) => transaction.date >= currentMonthFrom && transaction.date <= asOfDate)),
    currentMonth: summarizeWindow(transactions, currentMonthFrom, asOfDate),
    currentWeek,
    previousMonth: summarizeWindow(transactions, previousMonthFrom, previousMonthTo),
    previousWeek: summarizeWindow(transactions, previousWeekFrom, previousWeekTo),
    unusualSpend: findUnusualSpend(transactions, currentWeek)
  };
}
