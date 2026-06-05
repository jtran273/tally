import type { AccountRecord, TransactionRecord } from "@/lib/db";

const PAYMENT_MERCHANT_HINTS = /\b(payment|pmt|autopay|thank you|epay|online pay)\b/i;
const DEFAULT_BILLING_CYCLE_DAYS = 30;
const DEFAULT_PAYMENT_GRACE_DAYS = 25;
const DUE_SOON_DAYS = 7;

export type LiabilityTransactionInput = Pick<TransactionRecord, "accountId" | "amount" | "date" | "intent" | "merchant" | "plaidName">;

export type LiabilityStatus = "current" | "due-soon" | "overdue" | "no-balance";
export type LiabilityReportingDateSource =
  | "actual_plaid_liability"
  | "inferred_from_statement_cycle"
  | "estimated_from_due_date"
  | "unknown";
export type LiabilityReportingDateConfidence = "high" | "medium" | "low" | "unknown";

export interface LiabilityAccountSummary {
  accountId: string;
  name: string;
  mask: string | null;
  institutionName: string;
  amountOwed: number;
  creditLimit: number | null;
  utilizationPercent: number | null;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  estimatedDueDate: string | null;
  daysUntilDue: number | null;
  status: LiabilityStatus;
  // From Plaid liabilities product when available; falls back to null.
  lastStatementIssueDate: string | null;
  lastStatementBalance: number | null;
  minimumPaymentAmount: number | null;
  // True when the due date came from Plaid liabilities, not an estimate.
  dueDateIsActual: boolean;
  reportingDate: string | null;
  reportingDateSource: LiabilityReportingDateSource;
  reportingDateConfidence: LiabilityReportingDateConfidence;
  actionRank: number;
}

export interface LiabilitiesDueSummary {
  asOfDate: string;
  rows: LiabilityAccountSummary[];
  totalOwed: number;
  cashAvailable: number;
  coverageDelta: number;
  hasOverdue: boolean;
  hasDueSoon: boolean;
}

function isCreditAccount(account: AccountRecord) {
  return account.type === "credit" && account.isActive;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function addDays(value: string, days: number) {
  const date = parseIsoDate(value);
  return isoDate(new Date(date.getTime() + days * 86_400_000));
}

function dayDifference(fromIso: string, toIso: string) {
  const from = parseIsoDate(fromIso).getTime();
  const to = parseIsoDate(toIso).getTime();
  return Math.round((to - from) / 86_400_000);
}

function nextCycleDate(anchorIso: string, asOfIso: string) {
  let date = anchorIso;
  while (dayDifference(asOfIso, date) < 0) {
    date = addDays(date, DEFAULT_BILLING_CYCLE_DAYS);
  }
  return date;
}

function statusForDays(days: number | null, owed: number): LiabilityStatus {
  if (owed <= 0) return "no-balance";
  if (days === null) return "current";
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due-soon";
  return "current";
}

function utilizationRank(utilizationPercent: number | null) {
  if (utilizationPercent === null) return 0;
  if (utilizationPercent >= 50) return 3;
  if (utilizationPercent >= 30) return 2;
  if (utilizationPercent >= 10) return 1;
  return 0;
}

function minimumPaymentDue(row: Pick<LiabilityAccountSummary, "amountOwed" | "minimumPaymentAmount">) {
  if (row.amountOwed <= 0) return 0;
  if (row.minimumPaymentAmount && row.minimumPaymentAmount > 0) {
    return Math.min(row.amountOwed, row.minimumPaymentAmount);
  }
  return row.amountOwed;
}

function actionRank(row: Omit<LiabilityAccountSummary, "actionRank">, cashAvailable: number) {
  if (row.amountOwed <= 0) return 0;

  const statusWeight: Record<LiabilityStatus, number> = {
    overdue: 1_000_000,
    "due-soon": 800_000,
    current: 400_000,
    "no-balance": 0
  };
  const dueUrgency = row.daysUntilDue === null
    ? 0
    : Math.max(0, 60 - Math.max(0, row.daysUntilDue)) * 1_000;
  const coveredMinimum = minimumPaymentDue(row) <= Math.max(0, cashAvailable) ? 20_000 : 0;
  const utilization = utilizationRank(row.utilizationPercent) * 10_000 + (row.utilizationPercent ?? 0) * 100;
  const balanceWeight = Math.min(row.amountOwed, 10_000);

  return Math.round(statusWeight[row.status] + dueUrgency + coveredMinimum + utilization + balanceWeight);
}

function findLastPayment(
  accountId: string,
  transactions: readonly LiabilityTransactionInput[]
): { date: string; amount: number } | null {
  for (const transaction of transactions) {
    if (transaction.accountId !== accountId) continue;
    if (transaction.amount <= 0) continue;
    const looksLikePayment =
      transaction.intent === "transfer" ||
      PAYMENT_MERCHANT_HINTS.test(`${transaction.merchant} ${transaction.plaidName ?? ""}`);
    if (!looksLikePayment) continue;
    return { date: transaction.date, amount: transaction.amount };
  }
  return null;
}

function reportingDateMetadata({
  asOfDate,
  lastStatementIssueDate,
  nextPaymentDueDate
}: {
  asOfDate: string;
  lastStatementIssueDate: string | null | undefined;
  nextPaymentDueDate: string | null;
}): {
  reportingDate: string | null;
  reportingDateSource: LiabilityReportingDateSource;
  reportingDateConfidence: LiabilityReportingDateConfidence;
} {
  if (lastStatementIssueDate) {
    if (dayDifference(asOfDate, lastStatementIssueDate) >= 0) {
      return {
        reportingDate: lastStatementIssueDate,
        reportingDateConfidence: "high",
        reportingDateSource: "actual_plaid_liability"
      };
    }

    return {
      reportingDate: nextCycleDate(lastStatementIssueDate, asOfDate),
      reportingDateConfidence: "medium",
      reportingDateSource: "inferred_from_statement_cycle"
    };
  }

  if (nextPaymentDueDate) {
    const estimatedReportingDate = addDays(nextPaymentDueDate, DEFAULT_BILLING_CYCLE_DAYS - DEFAULT_PAYMENT_GRACE_DAYS);
    return {
      reportingDate: nextCycleDate(estimatedReportingDate, asOfDate),
      reportingDateConfidence: "low",
      reportingDateSource: "estimated_from_due_date"
    };
  }

  return {
    reportingDate: null,
    reportingDateConfidence: "unknown",
    reportingDateSource: "unknown"
  };
}

export function buildLiabilitiesDueSummary({
  accounts,
  asOfDate,
  cashAvailable,
  transactions
}: {
  accounts: readonly AccountRecord[];
  asOfDate?: string;
  cashAvailable: number;
  transactions: readonly LiabilityTransactionInput[];
}): LiabilitiesDueSummary {
  const today = asOfDate ?? isoDate(new Date());
  const sortedTransactions = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  const creditAccounts = accounts.filter(isCreditAccount);

  const rows: LiabilityAccountSummary[] = creditAccounts
    .map((account) => {
      const amountOwed = Math.max(0, Math.abs(account.balance));
      const lastPayment = findLastPayment(account.id, sortedTransactions);
      const actualDueDate = account.nextPaymentDueDate ?? null;
      const estimatedDueDate = actualDueDate;
      const daysUntilDue = estimatedDueDate ? dayDifference(today, estimatedDueDate) : null;
      const utilizationPercent = account.creditLimit && account.creditLimit > 0
        ? Math.round((amountOwed / account.creditLimit) * 1000) / 10
        : null;
      const reportingDate = reportingDateMetadata({
        asOfDate: today,
        lastStatementIssueDate: account.lastStatementIssueDate,
        nextPaymentDueDate: actualDueDate
      });

      const row = {
        accountId: account.id,
        amountOwed,
        creditLimit: account.creditLimit,
        daysUntilDue,
        estimatedDueDate,
        institutionName: account.institutionName,
        lastPaymentAmount: lastPayment?.amount ?? null,
        lastPaymentDate: lastPayment?.date ?? null,
        lastStatementIssueDate: account.lastStatementIssueDate ?? null,
        lastStatementBalance: account.lastStatementBalance ?? null,
        minimumPaymentAmount: account.minimumPaymentAmount ?? null,
        dueDateIsActual: Boolean(actualDueDate),
        mask: account.mask,
        name: account.name,
        reportingDate: reportingDate.reportingDate,
        reportingDateConfidence: reportingDate.reportingDateConfidence,
        reportingDateSource: reportingDate.reportingDateSource,
        status: statusForDays(daysUntilDue, amountOwed),
        utilizationPercent
      };

      return {
        ...row,
        actionRank: actionRank(row, cashAvailable)
      };
    })
    .sort((a, b) => {
      const rankDiff = b.actionRank - a.actionRank;
      if (rankDiff !== 0) return rankDiff;
      const aDays = a.daysUntilDue ?? Number.POSITIVE_INFINITY;
      const bDays = b.daysUntilDue ?? Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return aDays - bDays;
      return b.amountOwed - a.amountOwed;
    });

  const totalOwed = Math.round(rows.reduce((sum, row) => sum + row.amountOwed, 0) * 100) / 100;
  const coverageDelta = Math.round((cashAvailable - totalOwed) * 100) / 100;

  return {
    asOfDate: today,
    cashAvailable,
    coverageDelta,
    hasDueSoon: rows.some((row) => row.status === "due-soon"),
    hasOverdue: rows.some((row) => row.status === "overdue"),
    rows,
    totalOwed
  };
}
