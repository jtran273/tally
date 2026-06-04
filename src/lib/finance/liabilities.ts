import type { AccountRecord, TransactionRecord } from "@/lib/db";

const PAYMENT_MERCHANT_HINTS = /\b(payment|pmt|autopay|thank you|epay|online pay)\b/i;
const DEFAULT_BILLING_CYCLE_DAYS = 30;
const DUE_SOON_DAYS = 7;

export type LiabilityTransactionInput = Pick<TransactionRecord, "accountId" | "amount" | "date" | "intent" | "merchant" | "plaidName">;

export type LiabilityStatus = "current" | "due-soon" | "overdue" | "no-balance";

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

function statusForDays(days: number | null, owed: number): LiabilityStatus {
  if (owed <= 0) return "no-balance";
  if (days === null) return "current";
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due-soon";
  return "current";
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
      const fallbackDueDate = amountOwed > 0
        ? lastPayment
          ? addDays(lastPayment.date, DEFAULT_BILLING_CYCLE_DAYS)
          : addDays(today, DEFAULT_BILLING_CYCLE_DAYS)
        : null;
      const estimatedDueDate = actualDueDate ?? fallbackDueDate;
      const daysUntilDue = estimatedDueDate ? dayDifference(today, estimatedDueDate) : null;
      const utilizationPercent = account.creditLimit && account.creditLimit > 0
        ? Math.round((amountOwed / account.creditLimit) * 1000) / 10
        : null;

      return {
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
        status: statusForDays(daysUntilDue, amountOwed),
        utilizationPercent
      };
    })
    .sort((a, b) => {
      // Overdue first, then due-soon, then by days remaining, then by amount owed.
      const statusOrder: Record<LiabilityStatus, number> = {
        overdue: 0,
        "due-soon": 1,
        current: 2,
        "no-balance": 3
      };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
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
