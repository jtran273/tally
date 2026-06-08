import type { AccountRecord, CreditAprRecord, TransactionRecord } from "@/lib/db";

const PAYMENT_MERCHANT_HINTS = /\b(payment|pmt|autopay|thank you|epay|online pay)\b/i;
const DEFAULT_BILLING_CYCLE_DAYS = 30;
const DEFAULT_PAYMENT_GRACE_DAYS = 25;
const DUE_SOON_DAYS = 7;
const DEFAULT_PROCESSING_BUFFER_DAYS = 3;
const UTILIZATION_TARGETS = [30, 10] as const;

export type LiabilityTransactionInput = Pick<TransactionRecord, "accountId" | "amount" | "date" | "intent" | "merchant" | "plaidName">;

export type LiabilityStatus = "current" | "due-soon" | "overdue" | "no-balance";
export type LiabilityReportingDateSource =
  | "actual_plaid_liability"
  | "inferred_from_statement_cycle"
  | "estimated_from_due_date"
  | "unknown";
export type LiabilityReportingDateConfidence = "high" | "medium" | "low" | "unknown";
export type LiabilityUtilizationTarget = typeof UTILIZATION_TARGETS[number];

export interface LiabilityTargetPaymentAction {
  accountId: string;
  amountOwed: number;
  amountToTarget: number;
  cashShortfall: number;
  creditLimit: number;
  currentUtilizationPercent: number;
  dateConfidence: LiabilityReportingDateConfidence;
  dateSource: LiabilityReportingDateSource;
  highestAprPercentage?: number | null;
  payByDate: string;
  projectedUtilizationPercent: number;
  reason: "reported_balance_optimization";
  recommendedPayment: number;
  reportingDate: string;
  targetUtilizationPercent: LiabilityUtilizationTarget;
}

export interface LiabilityTargetPaymentPlan {
  actions: LiabilityTargetPaymentAction[];
  aggregateUtilizationPercent: number | null;
  allocatableCash: number;
  cashAvailable: number;
  cashBuffer: number;
  highestIndividualUtilizationPercent: number | null;
  remainingAllocatableCash: number;
  targetUtilizationPercent: LiabilityUtilizationTarget;
}

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
  lastPaymentSource?: "plaid_liability" | "transaction_inference" | "unknown";
  isOverdue?: boolean | null;
  creditAprs?: CreditAprRecord[];
  purchaseAprPercentage?: number | null;
  highestAprPercentage?: number | null;
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
  aggregateUtilizationPercent: number | null;
  coverageDelta: number;
  hasOverdue: boolean;
  hasDueSoon: boolean;
  highestIndividualUtilizationPercent: number | null;
  targetPaymentPlans: LiabilityTargetPaymentPlan[];
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

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function utilizationStats(rows: readonly LiabilityAccountSummary[]) {
  const rowsWithLimits = rows.filter((row) => row.creditLimit !== null && row.creditLimit > 0);
  if (rowsWithLimits.length === 0) {
    return {
      aggregateUtilizationPercent: null,
      highestIndividualUtilizationPercent: null
    };
  }

  const totalOwed = rowsWithLimits.reduce((sum, row) => sum + row.amountOwed, 0);
  const totalLimit = rowsWithLimits.reduce((sum, row) => sum + (row.creditLimit ?? 0), 0);

  return {
    aggregateUtilizationPercent: totalLimit > 0 ? roundPercent((totalOwed / totalLimit) * 100) : null,
    highestIndividualUtilizationPercent: Math.max(
      ...rowsWithLimits.map((row) => row.utilizationPercent ?? 0)
    )
  };
}

function utilizationTargetBalance(creditLimit: number, utilizationTarget: LiabilityUtilizationTarget) {
  return Math.max(0, roundMoney((creditLimit * utilizationTarget) / 100 - 0.01));
}

function projectedUtilizationPercent(amountOwed: number, payment: number, creditLimit: number) {
  if (creditLimit <= 0) return 0;
  return roundPercent((Math.max(0, amountOwed - payment) / creditLimit) * 100);
}

function paymentTargetSort(
  a: Pick<LiabilityTargetPaymentAction, "amountToTarget" | "currentUtilizationPercent" | "highestAprPercentage" | "reportingDate">,
  b: Pick<LiabilityTargetPaymentAction, "amountToTarget" | "currentUtilizationPercent" | "highestAprPercentage" | "reportingDate">
) {
  const utilizationDiff = b.currentUtilizationPercent - a.currentUtilizationPercent;
  if (utilizationDiff !== 0) return utilizationDiff;
  const aprDiff = (b.highestAprPercentage ?? -1) - (a.highestAprPercentage ?? -1);
  if (aprDiff !== 0) return aprDiff;
  const dateDiff = a.reportingDate.localeCompare(b.reportingDate);
  if (dateDiff !== 0) return dateDiff;
  return b.amountToTarget - a.amountToTarget;
}

export function computeTargetPayments({
  asOfDate,
  cashAvailable,
  cashBuffer = 0,
  processingBufferDays = DEFAULT_PROCESSING_BUFFER_DAYS,
  rows,
  utilizationTarget
}: {
  asOfDate: string;
  cashAvailable: number;
  cashBuffer?: number;
  processingBufferDays?: number;
  rows: readonly LiabilityAccountSummary[];
  utilizationTarget: LiabilityUtilizationTarget;
}): LiabilityTargetPaymentPlan {
  const stats = utilizationStats(rows);
  const allocatableCash = roundMoney(Math.max(0, cashAvailable - Math.max(0, cashBuffer)));
  let remainingAllocatableCash = allocatableCash;

  const candidates = rows.flatMap((row): LiabilityTargetPaymentAction[] => {
    if (row.amountOwed <= 0) return [];
    if (!row.creditLimit || row.creditLimit <= 0 || row.utilizationPercent === null) return [];
    if (!row.reportingDate || row.reportingDateConfidence === "unknown") return [];

    const targetBalance = utilizationTargetBalance(row.creditLimit, utilizationTarget);
    const amountToTarget = roundMoney(Math.max(0, row.amountOwed - targetBalance));
    if (amountToTarget <= 0) return [];

    const rawPayByDate = addDays(row.reportingDate, -Math.max(0, processingBufferDays));
    const payByDate = dayDifference(asOfDate, rawPayByDate) < 0 ? asOfDate : rawPayByDate;

    return [{
      accountId: row.accountId,
      amountOwed: row.amountOwed,
      amountToTarget,
      cashShortfall: amountToTarget,
      creditLimit: row.creditLimit,
      currentUtilizationPercent: row.utilizationPercent,
      dateConfidence: row.reportingDateConfidence,
      dateSource: row.reportingDateSource,
      highestAprPercentage: row.highestAprPercentage ?? null,
      payByDate,
      projectedUtilizationPercent: projectedUtilizationPercent(row.amountOwed, amountToTarget, row.creditLimit),
      reason: "reported_balance_optimization",
      recommendedPayment: 0,
      reportingDate: row.reportingDate,
      targetUtilizationPercent: utilizationTarget
    }];
  }).sort(paymentTargetSort);

  const actions = candidates.map((candidate) => {
    const recommendedPayment = roundMoney(Math.min(candidate.amountToTarget, remainingAllocatableCash));
    remainingAllocatableCash = roundMoney(Math.max(0, remainingAllocatableCash - recommendedPayment));
    return {
      ...candidate,
      cashShortfall: roundMoney(Math.max(0, candidate.amountToTarget - recommendedPayment)),
      recommendedPayment
    };
  });

  return {
    actions,
    aggregateUtilizationPercent: stats.aggregateUtilizationPercent,
    allocatableCash,
    cashAvailable,
    cashBuffer: Math.max(0, cashBuffer),
    highestIndividualUtilizationPercent: stats.highestIndividualUtilizationPercent,
    remainingAllocatableCash,
    targetUtilizationPercent: utilizationTarget
  };
}

export function reportedBalanceActionReason(action: Pick<LiabilityTargetPaymentAction, "dateConfidence" | "targetUtilizationPercent">) {
  const timing = action.dateConfidence === "high"
    ? "current Plaid statement timing"
    : action.dateConfidence === "medium"
      ? "estimated statement timing"
      : "lower-confidence estimated timing";
  return `May help lower the likely reported balance below ${action.targetUtilizationPercent}% using ${timing}; no score outcome is promised.`;
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

function highestAprPercentage(aprs: readonly CreditAprRecord[]) {
  const percentages = aprs
    .map((apr) => apr.aprPercentage)
    .filter((value): value is number => typeof value === "number");
  if (percentages.length === 0) return null;
  return Math.max(...percentages);
}

function purchaseAprPercentage(aprs: readonly CreditAprRecord[]) {
  return aprs.find((apr) => apr.aprType.toLowerCase().includes("purchase"))?.aprPercentage ?? null;
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
  cashBuffer,
  cashAvailable,
  transactions
}: {
  accounts: readonly AccountRecord[];
  asOfDate?: string;
  cashBuffer?: number;
  cashAvailable: number;
  transactions: readonly LiabilityTransactionInput[];
}): LiabilitiesDueSummary {
  const today = asOfDate ?? isoDate(new Date());
  const sortedTransactions = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  const creditAccounts = accounts.filter(isCreditAccount);

  const rows: LiabilityAccountSummary[] = creditAccounts
    .map((account) => {
      const amountOwed = Math.max(0, Math.abs(account.balance));
      const inferredLastPayment = findLastPayment(account.id, sortedTransactions);
      const plaidLastPayment =
        account.liabilityLastPaymentDate || account.liabilityLastPaymentAmount != null
          ? {
              amount: account.liabilityLastPaymentAmount ?? 0,
              date: account.liabilityLastPaymentDate ?? ""
            }
          : null;
      const lastPayment = plaidLastPayment ?? inferredLastPayment;
      const actualDueDate = account.nextPaymentDueDate ?? null;
      const estimatedDueDate = actualDueDate;
      const daysUntilDue = estimatedDueDate ? dayDifference(today, estimatedDueDate) : null;
      const utilizationPercent = account.creditLimit && account.creditLimit > 0
        ? roundPercent((amountOwed / account.creditLimit) * 100)
        : null;
      const reportingDate = reportingDateMetadata({
        asOfDate: today,
        lastStatementIssueDate: account.lastStatementIssueDate,
        nextPaymentDueDate: actualDueDate
      });
      const isOverdue = account.liabilityIsOverdue ?? null;
      const status = isOverdue && amountOwed > 0 ? "overdue" : statusForDays(daysUntilDue, amountOwed);
      const creditAprs = account.liabilityAprs ?? [];
      const lastPaymentSource: LiabilityAccountSummary["lastPaymentSource"] = plaidLastPayment
        ? "plaid_liability"
        : inferredLastPayment
          ? "transaction_inference"
          : "unknown";

      const row = {
        accountId: account.id,
        amountOwed,
        creditLimit: account.creditLimit,
        daysUntilDue,
        estimatedDueDate,
        institutionName: account.institutionName,
        lastPaymentAmount: lastPayment?.amount ?? null,
        lastPaymentDate: lastPayment?.date || null,
        lastPaymentSource,
        lastStatementIssueDate: account.lastStatementIssueDate ?? null,
        lastStatementBalance: account.lastStatementBalance ?? null,
        minimumPaymentAmount: account.minimumPaymentAmount ?? null,
        isOverdue,
        creditAprs,
        purchaseAprPercentage: purchaseAprPercentage(creditAprs),
        highestAprPercentage: highestAprPercentage(creditAprs),
        dueDateIsActual: Boolean(actualDueDate),
        mask: account.mask,
        name: account.name,
        reportingDate: reportingDate.reportingDate,
        reportingDateConfidence: reportingDate.reportingDateConfidence,
        reportingDateSource: reportingDate.reportingDateSource,
        status,
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

  const totalOwed = roundMoney(rows.reduce((sum, row) => sum + row.amountOwed, 0));
  const coverageDelta = roundMoney(cashAvailable - totalOwed);
  const stats = utilizationStats(rows);
  const targetPaymentPlans = UTILIZATION_TARGETS.map((target) =>
    computeTargetPayments({
      asOfDate: today,
      cashAvailable,
      cashBuffer,
      rows,
      utilizationTarget: target
    })
  );

  return {
    aggregateUtilizationPercent: stats.aggregateUtilizationPercent,
    asOfDate: today,
    cashAvailable,
    coverageDelta,
    hasDueSoon: rows.some((row) => row.status === "due-soon"),
    hasOverdue: rows.some((row) => row.status === "overdue"),
    highestIndividualUtilizationPercent: stats.highestIndividualUtilizationPercent,
    rows,
    targetPaymentPlans,
    totalOwed
  };
}
