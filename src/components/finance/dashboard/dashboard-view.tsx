"use client";

import type {
  AccountRecord,
  ReviewReason,
  ReviewStatus,
  TransactionIntent,
  TransactionStatus
} from "@/lib/db";
import type {
  AccountBalanceTotals,
  BalanceTrendPoint,
  SyncSummary
} from "@/lib/finance/balances";
import { accountGroupLabel, friendlyAccountLabel } from "@/lib/finance/account-display";
import { displayCategoryName } from "@/lib/finance/classification";
import {
  reportedBalanceActionReason,
  type LiabilitiesDueSummary,
  type LiabilityAccountSummary,
  type LiabilityTargetPaymentAction,
  type LiabilityUtilizationTarget
} from "@/lib/finance/liabilities";
import {
  excludeMatchedRefundReversalTransactions,
  filterReportableInflowTransactions
} from "@/lib/finance/refund-reversals";
import { hasOpenReview, isSpendingIntent, type CategoryBreakdownSummary } from "@/lib/finance/spending";
import { LinkButton, Notice } from "@/components/ui/primitives";
import {
  Clock3,
  Database,
  Landmark,
  ShieldCheck,
  RefreshCw,
  Tags,
  TrendingDown,
  TrendingUp,
  WalletCards,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./dashboard.module.css";

export interface DashboardBalanceTransaction {
  accountId: string;
  accountName: string;
  amount: number;
  category: string;
  categoryId: string | null;
  date: string;
  id: string;
  intent: TransactionIntent;
  merchant: string;
  plaidName: string | null;
  reviewItems: { reason: ReviewReason; status: ReviewStatus }[];
  reviewStatus: ReviewStatus | null;
  splits: { amount: number; intent: TransactionIntent }[];
  status: TransactionStatus;
}

interface DashboardViewProps {
  accounts: AccountRecord[];
  asOfDate: string;
  balanceTransactions: DashboardBalanceTransaction[];
  balanceTrends: Record<DashboardBalanceScope, BalanceTrendPoint[]>;
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
  liabilitiesDueSummary: LiabilitiesDueSummary;
  snapshotCount: number;
  syncSummary: SyncSummary;
  totals: AccountBalanceTotals;
}

type DashboardBalanceScope = "cash" | "cashMinusLiabilities" | "netWorth";
type TrendRangeKey = "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";
type ActivityMode = "after" | "before" | "point";
type CategoryViewMode = "trend" | "month";

interface BalanceViewOption {
  description: string;
  icon: LucideIcon;
  key: DashboardBalanceScope;
  label: string;
  positiveIsGood: boolean;
  tone?: "negative" | "positive";
  value: number;
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const compactMoneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  notation: "compact",
  style: "currency"
});

const axisMoneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency"
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short"
});

const longDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric"
});

const trendRangeOptions: { days: number | null; key: TrendRangeKey; label: string }[] = [
  { days: 7, key: "1W", label: "1W" },
  { days: 31, key: "1M", label: "1M" },
  { days: 93, key: "3M", label: "3M" },
  { days: 186, key: "6M", label: "6M" },
  { days: 366, key: "1Y", label: "1Y" },
  { days: null, key: "ALL", label: "All" }
];

const DAY_MS = 86_400_000;

function formatMoney(value: number, compact = false) {
  return (compact ? compactMoneyFormatter : moneyFormatter).format(value);
}

function formatAxisMoney(value: number, scaleRange: number) {
  if (Math.abs(value) < 10_000 || scaleRange < 1_000) {
    return axisMoneyFormatter.format(value);
  }

  return compactMoneyFormatter.format(value);
}

function formatSignedMoney(value: number) {
  if (value === 0) return formatMoney(0);
  return `${value > 0 ? "+" : "-"}${formatMoney(Math.abs(value))}`;
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatLongDate(value: string) {
  return longDateFormatter.format(new Date(`${value}T12:00:00`));
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDaysIso(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function monthStartIso(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function monthEndIso(value: string) {
  const month = value.slice(0, 7);
  const [yearText, monthText] = month.split("-");
  const end = new Date(Date.UTC(Number(yearText), Number(monthText), 0));
  return end.toISOString().slice(0, 10);
}

function transactionDateParams(fromDate: string, toDate: string, preferToDateMonth = false) {
  const month = fromDate.slice(0, 7) === toDate.slice(0, 7) || preferToDateMonth
    ? toDate.slice(0, 7)
    : "";

  if (!month) return { from: fromDate, to: toDate };

  const monthStart = `${month}-01`;
  const monthEnd = monthEndIso(toDate);

  return {
    from: fromDate > monthStart ? fromDate : undefined,
    month,
    to: toDate < monthEnd ? toDate : undefined
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function trendScaleDomain(values: readonly number[]) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const rawRange = max - min;
  const magnitude = Math.max(Math.abs(max), Math.abs(min), 1);
  const minimumVisibleRange = Math.min(10_000, Math.max(100, magnitude * 0.04));
  const scaleRange = Math.max(rawRange * 1.16, minimumVisibleRange);
  const midpoint = (max + min) / 2;

  return {
    max: midpoint + scaleRange / 2,
    min: midpoint - scaleRange / 2,
    range: scaleRange
  };
}

function rangeOptionForKey(rangeKey: TrendRangeKey) {
  return trendRangeOptions.find((option) => option.key === rangeKey) ?? trendRangeOptions[0];
}

function transactionsHref(params: Record<string, boolean | number | string | undefined>) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "" || value === false) return;
    search.set(key, value === true ? "1" : String(value));
  });

  const query = search.toString();
  return query ? `/transactions?${query}` : "/transactions";
}

function latestTrendDelta(trend: readonly BalanceTrendPoint[]) {
  if (trend.length < 2) return null;

  const first = trend[0];
  const latest = trend[trend.length - 1];
  const amount = latest.netWorth - first.netWorth;
  const percent = first.netWorth === 0
    ? null
    : (amount / Math.abs(first.netWorth)) * 100;

  return { amount, percent };
}

function pointDelta(trend: readonly BalanceTrendPoint[], index: number) {
  if (index <= 0 || trend.length < 2) return null;

  const previous = trend[index - 1];
  const current = trend[index];
  const amount = current.netWorth - previous.netWorth;
  const percent = previous.netWorth === 0
    ? null
    : (amount / Math.abs(previous.netWorth)) * 100;

  return { amount, percent };
}

function formatDeltaPercentSuffix(percent: number | null) {
  if (percent === null || !Number.isFinite(percent)) return "";
  return ` (${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%)`;
}

function deltaToneClass(amount: number, positiveIsGood: boolean) {
  if (amount === 0) return undefined;

  const isPositiveMove = amount > 0;
  const isGoodMove = positiveIsGood ? isPositiveMove : !isPositiveMove;
  return isGoodMove ? styles.positive : styles.negative;
}

function filterTrendByRange(
  trend: readonly BalanceTrendPoint[],
  rangeKey: TrendRangeKey,
  anchorDate?: string
) {
  const range = rangeOptionForKey(rangeKey);
  if (!range?.days || trend.length < 2) return [...trend];

  const anchorTime = anchorDate
    ? parseIsoDate(anchorDate).getTime()
    : parseIsoDate(trend[trend.length - 1].date).getTime();
  const cutoffTime = anchorTime - range.days * 24 * 60 * 60 * 1000;
  const firstInRangeIndex = trend.findIndex((point) => parseIsoDate(point.date).getTime() >= cutoffTime);

  if (firstInRangeIndex <= 0) return [...trend];
  return trend.slice(firstInRangeIndex - 1);
}

function transactionAmountClass(amount: number) {
  if (amount > 0) return styles.positiveAmount;
  if (amount < 0) return styles.negativeAmount;
  return "";
}

function formatRelativeTime(value: string | null) {
  if (!value) return "Never synced";

  const syncedAt = new Date(value);
  if (Number.isNaN(syncedAt.getTime())) return "Never synced";

  const diffMs = Math.max(0, Date.now() - syncedAt.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return syncedAt.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function accountIncludedInScope(type: AccountRecord["type"] | undefined, scope: DashboardBalanceScope) {
  if (scope === "netWorth") return true;
  if (!type) return false;
  if (scope === "cash") return type === "depository";
  return type === "depository" || type === "credit";
}

function transactionIncludedInScope(
  transaction: DashboardBalanceTransaction,
  accountTypeById: ReadonlyMap<string, AccountRecord["type"]>,
  scope: DashboardBalanceScope
) {
  if (transaction.intent === "transfer") return false;
  return accountIncludedInScope(accountTypeById.get(transaction.accountId), scope);
}

function cardDueLabel(row: LiabilityAccountSummary) {
  if (row.amountOwed <= 0) return "No payment due";
  if (!row.estimatedDueDate) return "Due date unknown";

  const prefix = row.dueDateIsActual ? "Due" : "Est. due";
  if (row.daysUntilDue !== null && row.daysUntilDue < 0) {
    return `${prefix} ${formatDate(row.estimatedDueDate)} - overdue`;
  }

  if (row.daysUntilDue === 0) return `${prefix} today`;
  if (row.daysUntilDue === 1) return `${prefix} tomorrow`;
  if (row.daysUntilDue !== null) return `${prefix} in ${row.daysUntilDue}d`;

  return `${prefix} ${formatDate(row.estimatedDueDate)}`;
}

function cardPaymentAction(row: LiabilityAccountSummary) {
  if (row.amountOwed <= 0) return "No payoff action needed right now.";

  const minimumPayment = row.minimumPaymentAmount && row.minimumPaymentAmount > 0
    ? `minimum ${formatMoney(row.minimumPaymentAmount)}`
    : "minimum";

  if (row.status === "overdue") return `Pay today: at least the ${minimumPayment}, full balance if cash allows.`;
  if (row.status === "due-soon") return `Pay by ${row.estimatedDueDate ? formatDate(row.estimatedDueDate) : "the due date"}: at least the ${minimumPayment}.`;
  return `Schedule at least the ${minimumPayment}; pay more if utilization is high.`;
}

function cardMinimumPaymentAmount(row: LiabilityAccountSummary) {
  if (row.amountOwed <= 0) return 0;
  if (row.minimumPaymentAmount && row.minimumPaymentAmount > 0) {
    return Math.min(row.amountOwed, row.minimumPaymentAmount);
  }
  return row.amountOwed;
}

function cardRecommendedPayment(row: LiabilityAccountSummary, summary: LiabilitiesDueSummary) {
  if (row.amountOwed <= 0) return 0;

  const minimumPayment = cardMinimumPaymentAmount(row);

  if (summary.coverageDelta >= 0) return row.amountOwed;
  if (row.status === "overdue" || row.status === "due-soon") return minimumPayment;

  if (!row.creditLimit || row.creditLimit <= 0 || row.utilizationPercent === null) {
    return minimumPayment;
  }

  if (row.utilizationPercent >= 30) {
    return Math.min(row.amountOwed, Math.max(minimumPayment, row.amountOwed - row.creditLimit * 0.3));
  }

  if (row.utilizationPercent >= 10) {
    return Math.min(row.amountOwed, Math.max(minimumPayment, row.amountOwed - row.creditLimit * 0.1));
  }

  return minimumPayment;
}

function cardTargetPaymentAction(
  row: LiabilityAccountSummary,
  summary: LiabilitiesDueSummary,
  target: LiabilityUtilizationTarget = 30
) {
  return summary.targetPaymentPlans
    .find((plan) => plan.targetUtilizationPercent === target)
    ?.actions.find((action) => action.accountId === row.accountId) ?? null;
}

function cardTargetCashCopy(action: LiabilityTargetPaymentAction) {
  if (action.cashShortfall <= 0) {
    return "Available cash covers this target.";
  }
  if (action.recommendedPayment > 0) {
    return `${formatMoney(action.recommendedPayment)} fits above the cash buffer; ${formatMoney(action.cashShortfall)} more would reach the target.`;
  }
  return "Cash buffer leaves no room for this target right now.";
}

function cardPrimaryAction(row: LiabilityAccountSummary, summary: LiabilitiesDueSummary) {
  if (row.amountOwed <= 0) return "No payment action needed right now.";

  const payment = cardRecommendedPayment(row, summary);
  const paymentCopy = payment > 0 ? formatMoney(payment) : "a payment";
  const coverageCopy = payment > 0 && payment <= summary.cashAvailable
    ? "Cash covers this action."
    : payment > summary.cashAvailable
      ? `Cash is short by ${formatMoney(payment - Math.max(0, summary.cashAvailable))} for this action.`
      : "";

  if (row.status === "overdue") {
    return `Pay ${paymentCopy} today. ${coverageCopy}`.trim();
  }

  if (row.status === "due-soon") {
    const dueCopy = row.estimatedDueDate ? ` by ${formatDate(row.estimatedDueDate)}` : " by the due date";
    return `Pay ${paymentCopy}${dueCopy}. ${coverageCopy}`.trim();
  }

  const targetAction = cardTargetPaymentAction(row, summary, 30);
  if (targetAction) {
    return `Pay about ${formatMoney(targetAction.amountToTarget)} by ${formatDate(targetAction.payByDate)} to move the likely reported balance under ${targetAction.targetUtilizationPercent}%. ${cardTargetCashCopy(targetAction)}`;
  }

  if (row.utilizationPercent !== null && row.creditLimit && row.creditLimit > 0) {
    if (summary.coverageDelta >= 0) {
      return `Cash can clear this card; pay ${paymentCopy} if you want the balance gone.`;
    }
  }

  return cardPaymentAction(row);
}

function cardDueDetail(row: LiabilityAccountSummary) {
  if (row.amountOwed <= 0) return "No balance is currently owed.";
  if (!row.estimatedDueDate) return "Due date is not available from connected data.";
  const source = row.dueDateIsActual ? "Issuer due date" : "Estimated due date";
  return `${source}: ${formatDate(row.estimatedDueDate)}.`;
}

function cardReportingDateDetail(row: LiabilityAccountSummary) {
  if (row.amountOwed <= 0) return "Reporting timing is not needed while this card is paid.";

  if (!row.reportingDate) {
    return "Reporting date unknown; payment due-date safety still applies.";
  }

  if (row.reportingDateSource === "actual_plaid_liability") {
    return `Statement date from Plaid: ${formatDate(row.reportingDate)}.`;
  }

  if (row.reportingDateSource === "inferred_from_statement_cycle") {
    return `Est. next statement date: ${formatDate(row.reportingDate)} from last Plaid statement date.`;
  }

  return `Estimated statement timing from due date: ${formatDate(row.reportingDate)}.`;
}

function cardUtilizationDetail(row: LiabilityAccountSummary, summary: LiabilitiesDueSummary) {
  if (!row.creditLimit || row.creditLimit <= 0 || row.utilizationPercent === null) {
    return "Credit limit is not reported, so utilization is not ranked for this card.";
  }

  const utilization = `${row.utilizationPercent.toFixed(1)}% of ${formatMoney(row.creditLimit)}`;
  if (row.utilizationPercent >= 30) {
    const action = cardTargetPaymentAction(row, summary, 30);
    return action
      ? `${utilization} limit. ${reportedBalanceActionReason(action)} Target payment: ${formatMoney(action.amountToTarget)} by ${formatDate(action.payByDate)}.`
      : `${utilization} limit. Reporting timing is not reliable enough for a precise target payment.`;
  }
  if (row.utilizationPercent >= 10) {
    const action = cardTargetPaymentAction(row, summary, 10);
    return action
      ? `${utilization} limit. ${reportedBalanceActionReason(action)} Target payment: ${formatMoney(action.amountToTarget)} by ${formatDate(action.payByDate)}.`
      : `${utilization} limit. Reporting timing is not reliable enough for a precise target payment.`;
  }
  return `${utilization} limit.`;
}

function cardStatusClass(row: LiabilityAccountSummary) {
  if (row.status === "overdue") return styles.liabilityOverdue;
  if (row.status === "due-soon") return styles.liabilityDueSoon;
  if (row.amountOwed <= 0) return styles.liabilityPaid;
  return styles.liabilityCurrent;
}

function sortTransactionsForPoint(
  transactions: DashboardBalanceTransaction[],
  deltaAmount: number | null
) {
  return [...transactions].sort((left, right) => {
    if (deltaAmount !== null && deltaAmount < 0 && left.amount !== right.amount) {
      return left.amount - right.amount;
    }

    if (deltaAmount !== null && deltaAmount > 0 && left.amount !== right.amount) {
      return right.amount - left.amount;
    }

    const absoluteDelta = Math.abs(right.amount) - Math.abs(left.amount);
    if (absoluteDelta !== 0) return absoluteDelta;
    return right.date.localeCompare(left.date);
  });
}

function sortTransactionsByDate(transactions: DashboardBalanceTransaction[]) {
  return [...transactions].sort((left, right) => {
    const dateCompare = right.date.localeCompare(left.date);
    if (dateCompare !== 0) return dateCompare;
    return Math.abs(right.amount) - Math.abs(left.amount);
  });
}

function dashboardTransactionSpendingAmount(transaction: DashboardBalanceTransaction) {
  if (transaction.amount >= 0) return 0;

  if (transaction.splits.length > 0) {
    return roundMoney(transaction.splits.reduce((sum, split) => (
      isSpendingIntent(split.intent) ? sum + Math.abs(split.amount) : sum
    ), 0));
  }

  return isSpendingIntent(transaction.intent) ? Math.abs(transaction.amount) : 0;
}

function TransactionRows({
  transactions
}: {
  transactions: DashboardBalanceTransaction[];
}) {
  if (transactions.length === 0) {
    return <div className={styles.emptyMini}>No non-transfer transactions in this view.</div>;
  }

  return (
    <div className={styles.activityRows}>
      {transactions.map((transaction) => (
        <Link
          className={styles.transactionRow}
          href={`/transactions/${transaction.id}`}
          key={transaction.id}
        >
          <div className={styles.transactionRowCopy}>
            <strong className={styles.transactionMerchant}>{transaction.merchant || "Transaction"}</strong>
            <span className={styles.transactionMeta}>
              {transaction.status === "pending" ? "Pending - " : ""}
              {formatDate(transaction.date)} - {transaction.accountName} - {transaction.category}
            </span>
          </div>
          <span className={`${styles.amount} ${transactionAmountClass(transaction.amount)}`}>
            {formatSignedMoney(transaction.amount)}
          </span>
        </Link>
      ))}
    </div>
  );
}

function TrendChart({
  accounts,
  anchorDate,
  positiveIsGood,
  rangeKey,
  scope,
  setRangeKey,
  snapshotCount,
  transactions,
  trend,
  valueLabel
}: {
  accounts: AccountRecord[];
  anchorDate: string;
  positiveIsGood: boolean;
  rangeKey: TrendRangeKey;
  scope: DashboardBalanceScope;
  setRangeKey: (key: TrendRangeKey) => void;
  snapshotCount: number;
  transactions: DashboardBalanceTransaction[];
  trend: BalanceTrendPoint[];
  valueLabel: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activityMode, setActivityMode] = useState<ActivityMode>("point");
  const showActivityPanel = scope === "cash" || scope === "cashMinusLiabilities";
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(720);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const accountTypeById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.type])),
    [accounts]
  );
  const selectedTrend = useMemo(
    () => filterTrendByRange(trend, rangeKey, anchorDate),
    [anchorDate, rangeKey, trend]
  );
  const scopedTransactions = useMemo(
    () => transactions.filter((transaction) => transactionIncludedInScope(transaction, accountTypeById, scope)),
    [accountTypeById, scope, transactions]
  );
  const activityTransactions = useMemo(
    () => scope === "cash" ? filterReportableInflowTransactions(transactions) : scopedTransactions,
    [scope, scopedTransactions, transactions]
  );
  const delta = latestTrendDelta(selectedTrend);
  const DeltaIcon = !delta || delta.amount >= 0 ? TrendingUp : TrendingDown;
  const deltaClassName = delta ? deltaToneClass(delta.amount, positiveIsGood) : undefined;
  const hasSnapshotTrend = trend.some((point) => point.source === "snapshot");
  const hasTransactionTrend = trend.some((point) => point.source === "transaction");

  if (trend.length === 0) {
    return (
      <div className={styles.emptyTrend}>
        <Database size={18} aria-hidden />
        No balances yet
      </div>
    );
  }

  const values = selectedTrend.map((point) => point.netWorth);
  const scale = trendScaleDomain(values);
  const compactChart = containerWidth < 520;
  const width = Math.max(compactChart ? 320 : 520, containerWidth);
  const height = compactChart ? 176 : 220;
  const padding = compactChart
    ? { bottom: 26, left: 14, right: 14, top: 16 }
    : { bottom: 34, left: 64, right: 22, top: 18 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const points = selectedTrend.map((point, index) => {
    const x = selectedTrend.length === 1 ? width / 2 : padding.left + (index / (selectedTrend.length - 1)) * plotWidth;
    const y = padding.top + plotHeight - ((point.netWorth - scale.min) / scale.range) * plotHeight;
    return [x, y] as const;
  });
  const line =
    selectedTrend.length === 1
      ? `M${padding.left},${points[0][1].toFixed(1)} L${width - padding.right},${points[0][1].toFixed(1)}`
      : points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area =
    selectedTrend.length === 1
      ? ""
      : `${line} L${points[points.length - 1][0].toFixed(1)},${height - padding.bottom} L${points[0][0].toFixed(1)},${height - padding.bottom} Z`;
  const start = selectedTrend[0];
  const end = selectedTrend[selectedTrend.length - 1];
  const hasSelectedPoint = activeIndex !== null;
  const selectedIndex = hasSelectedPoint
    ? Math.min(activeIndex, selectedTrend.length - 1)
    : selectedTrend.length - 1;
  const previousPoint = selectedIndex > 0 ? selectedTrend[selectedIndex - 1] : null;
  const activePoint = selectedTrend[selectedIndex];
  const activeCoords = points[selectedIndex];
  const activeDelta = pointDelta(selectedTrend, selectedIndex);
  const activeDeltaClass = activeDelta ? deltaToneClass(activeDelta.amount, positiveIsGood) : undefined;
  const periodTransactions = sortTransactionsByDate(
    activityTransactions.filter((transaction) => transaction.date >= start.date && transaction.date <= end.date)
  ).slice(0, 10);
  const pointTransactions = hasSelectedPoint ? sortTransactionsForPoint(
    activityTransactions.filter((transaction) => (
      previousPoint
        ? transaction.date > previousPoint.date && transaction.date <= activePoint.date
        : transaction.date >= start.date && transaction.date <= activePoint.date
    )),
    activeDelta?.amount ?? null
  ).slice(0, 10) : periodTransactions;
  const activityPeriodStartDate = hasSelectedPoint && rangeKey === "1M" && monthStartIso(activePoint.date) > start.date
    ? monthStartIso(activePoint.date)
    : start.date;
  const beforePointEndDate = hasSelectedPoint ? addDaysIso(activePoint.date, -1) : end.date;
  const afterPointStartDate = hasSelectedPoint ? addDaysIso(activePoint.date, 1) : start.date;
  const beforeTransactions = hasSelectedPoint ? sortTransactionsByDate(
    activityTransactions.filter((transaction) => (
      beforePointEndDate >= activityPeriodStartDate &&
      transaction.date >= activityPeriodStartDate &&
      transaction.date <= beforePointEndDate
    ))
  ).slice(0, 10) : periodTransactions;
  const afterTransactions = hasSelectedPoint ? sortTransactionsByDate(
    activityTransactions.filter((transaction) => (
      afterPointStartDate <= end.date &&
      transaction.date >= afterPointStartDate &&
      transaction.date <= end.date
    ))
  ).slice(0, 10) : periodTransactions;
  const rawVisibleTransactions = !hasSelectedPoint
    ? periodTransactions
    : activityMode === "point"
      ? pointTransactions
      : activityMode === "before"
        ? beforeTransactions
        : afterTransactions;
  const visibleTransactions = rawVisibleTransactions;
  const candidateActivityFromDate = !hasSelectedPoint
    ? start.date
    : activityMode === "point"
      ? previousPoint ? addDaysIso(previousPoint.date, 1) : start.date
      : activityMode === "before"
        ? activityPeriodStartDate
        : afterPointStartDate;
  const candidateActivityToDate = !hasSelectedPoint
    ? end.date
    : activityMode === "before"
      ? beforePointEndDate
      : activityMode === "after"
        ? end.date
        : activePoint.date;
  const hasValidActivityRange = candidateActivityFromDate <= candidateActivityToDate;
  const activityFromDate = hasValidActivityRange ? candidateActivityFromDate : start.date;
  const activityToDate = hasValidActivityRange ? candidateActivityToDate : end.date;
  const activityHref = transactionsHref({
    ...(scope === "cash" ? { direction: "income" } : { exclude_transfers: true }),
    ...transactionDateParams(activityFromDate, activityToDate, rangeKey === "1M")
  });
  const gridLines = [
    { label: scale.max, y: padding.top },
    { label: scale.min + scale.range / 2, y: padding.top + plotHeight / 2 },
    { label: scale.min, y: padding.top + plotHeight }
  ];
  const sourceLabel = hasSnapshotTrend
    ? `${snapshotCount.toLocaleString("en-US")} balance snapshots available`
    : hasTransactionTrend
      ? "Based on posted non-transfer transaction history"
      : "Snapshot trend unavailable; using current persisted balances";
  const activeSourceLabel = activePoint.source === "snapshot"
    ? "Daily Plaid balance snapshot"
    : activePoint.source === "transaction"
      ? "Based on posted transactions"
      : "Current persisted balance";
  const selectedPeriodDeltaLabel = delta
    ? `${formatSignedMoney(delta.amount)}${formatDeltaPercentSuffix(delta.percent)}`
    : "No change yet";
  const selectedPointDeltaLabel = activeDelta
    ? `${formatSignedMoney(activeDelta.amount)}${formatDeltaPercentSuffix(activeDelta.percent)}`
    : "Range start";
  const selectedPointX = activeCoords
    ? Math.min(Math.max(activeCoords[0], padding.left + 48), width - padding.right - 48)
    : 0;
  const selectedPointValueX = activeCoords
    ? compactChart
      ? Math.min(Math.max(activeCoords[0] + 8, padding.left + 54), width - padding.right - 54)
      : padding.left - 8
    : 0;
  const selectedPointValueAnchor = compactChart
    ? activeCoords && activeCoords[0] > width * 0.76 ? "end" : "start"
    : "end";
  const selectedPointValueY = activeCoords
    ? Math.max(padding.top + 12, activeCoords[1] - 10)
    : 0;
  const activityNoun = scope === "cash" ? "Income" : "Transactions";
  const activityTitle = !hasSelectedPoint
    ? `${activityNoun} in selected period`
    : activityMode === "point"
      ? `${activityNoun} for selected point`
      : activityMode === "before"
        ? `${activityNoun} before selected point`
        : `${activityNoun} after selected point`;

  return (
    <div className={styles.trendPanel}>
      <div className={styles.trendPanelHead}>
        <div className={styles.trendControls} aria-label="Balance trend range">
          {trendRangeOptions.map((option) => (
            <button
              aria-pressed={rangeKey === option.key}
              className={rangeKey === option.key ? styles.trendRangeActive : undefined}
              key={option.key}
              onClick={() => {
                setRangeKey(option.key);
                setActiveIndex(null);
              }}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className={styles.trendSummary}>
          <span className={deltaClassName}>
            <DeltaIcon size={14} aria-hidden />
            {delta ? (
              <>
                {formatSignedMoney(delta.amount)}{formatDeltaPercentSuffix(delta.percent)}
              </>
            ) : (
              "No period delta yet"
            )}
          </span>
          <span>{selectedTrend.length.toLocaleString("en-US")} {selectedTrend.length === 1 ? "point" : "points"}</span>
        </div>
      </div>

      <div className={styles.chartInsight} aria-live="polite">
        <div>
          <span>{hasSelectedPoint ? "Selected point" : "Selected period"}</span>
          <strong>{hasSelectedPoint ? formatLongDate(activePoint.date) : `${formatLongDate(start.date)} - ${formatLongDate(end.date)}`}</strong>
        </div>
        <div>
          <span>{hasSelectedPoint ? activeSourceLabel : "Period change"}</span>
          <strong className={hasSelectedPoint ? activeDeltaClass : deltaClassName}>
            {hasSelectedPoint ? selectedPointDeltaLabel : selectedPeriodDeltaLabel}
          </strong>
        </div>
        <div>
          <span>Balance</span>
          <strong>{formatMoney(hasSelectedPoint ? activePoint.netWorth : end.netWorth)}</strong>
        </div>
      </div>

      <div className={styles.mobileTrendSummary} aria-label="Mobile balance trend summary">
        <div>
          <span>{valueLabel}</span>
          <strong>{formatMoney(hasSelectedPoint ? activePoint.netWorth : end.netWorth)}</strong>
        </div>
        <div className={styles.mobileTrendSummaryGrid}>
          <div>
            <span>{hasSelectedPoint ? "Selected" : "Range"}</span>
            <strong>{hasSelectedPoint ? formatLongDate(activePoint.date) : `${formatDate(start.date)} - ${formatDate(end.date)}`}</strong>
          </div>
          <div>
            <span>Change</span>
            <strong className={hasSelectedPoint ? activeDeltaClass : deltaClassName}>
              {hasSelectedPoint ? selectedPointDeltaLabel : selectedPeriodDeltaLabel}
            </strong>
          </div>
        </div>
        <Link className={styles.textLink} href={activityHref}>Open transactions</Link>
      </div>

      <div className={styles.trend} ref={containerRef}>
        <svg aria-label={`${valueLabel} balance trend`} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <linearGradient id="dashboardTrendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridLines.map(({ label, y }) => (
            <g key={`${label}-${y}`}>
              <line
                stroke="var(--line-2)"
                strokeDasharray="4 6"
                strokeWidth="1"
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
              <text className={styles.trendScaleLabel} x="4" y={y + 4}>
                {formatAxisMoney(label, scale.range)}
              </text>
            </g>
          ))}
          {area ? <path d={area} fill="url(#dashboardTrendFill)" /> : null}
          <path d={line} fill="none" stroke="var(--accent)" strokeLinecap="round" strokeWidth="2" />
          {hasSelectedPoint && activeCoords ? (
            <>
              <line
                className={styles.trendCrosshair}
                x1={padding.left}
                x2={width - padding.right}
                y1={activeCoords[1]}
                y2={activeCoords[1]}
              />
              <line
                className={styles.trendCrosshair}
                x1={activeCoords[0]}
                x2={activeCoords[0]}
                y1={padding.top}
                y2={height - padding.bottom}
              />
            </>
          ) : null}
          {points.map(([x, y], index) => {
            const point = selectedTrend[index];
            const isActive = hasSelectedPoint && index === selectedIndex;
            return (
              <g
                aria-label={`${formatLongDate(point.date)} ${valueLabel.toLowerCase()} ${formatMoney(point.netWorth)}`}
                className={styles.trendPoint}
                key={`${point.date}-${index}`}
                onClick={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setActiveIndex(index);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                role="button"
                tabIndex={0}
              >
                <circle cx={x} cy={y} fill="transparent" r="11" />
                <circle
                  className={isActive ? styles.activeTrendDot : styles.trendDot}
                  cx={x}
                  cy={y}
                  fill="var(--surface)"
                  r={isActive ? "6" : index === 0 || index === points.length - 1 ? "4.5" : "3"}
                  stroke="var(--accent)"
                  strokeWidth={isActive ? "2" : "1.5"}
                >
                  <title>{`${formatLongDate(point.date)}: ${formatMoney(point.netWorth)}`}</title>
                </circle>
              </g>
            );
          })}
          {hasSelectedPoint && activeCoords ? (
            <>
              <text
                className={styles.selectedPointValueLabel}
                textAnchor={selectedPointValueAnchor}
                x={selectedPointValueX}
                y={selectedPointValueY}
              >
                {formatMoney(activePoint.netWorth, true)}
              </text>
              <text
                className={styles.selectedPointDateLabel}
                textAnchor="middle"
                x={selectedPointX}
                y={height - 8}
              >
                {formatDate(activePoint.date)}
              </text>
            </>
          ) : null}
          <text className={styles.trendDateLabel} x={padding.left} y={height - 8}>{formatDate(start.date)}</text>
          <text className={styles.trendDateLabel} textAnchor="end" x={width - padding.right} y={height - 8}>{formatDate(end.date)}</text>
        </svg>
      </div>
      <div className={styles.trendAxis}>
        <span>
          <strong>Range start</strong>
          {formatLongDate(start.date)} - {formatMoney(start.netWorth, true)}
        </span>
        <span>
          <strong>Range end</strong>
          {formatLongDate(end.date)} - {formatMoney(end.netWorth, true)}
        </span>
      </div>
      <div className={styles.trendSource}>{sourceLabel}</div>

      {showActivityPanel ? (
        <section className={styles.activityPanel} aria-label="Selected balance transactions">
          <div className={styles.activityHead}>
            <div>
              <span className={styles.eyebrow}>{activityNoun}</span>
              <h3>{activityTitle}</h3>
            </div>
            <div className={styles.activityActions}>
              {hasSelectedPoint ? (
                <div className={styles.activityModeControls} aria-label="Transaction scope">
                  <button
                    aria-pressed={activityMode === "point"}
                    className={activityMode === "point" ? styles.activityModeActive : undefined}
                    onClick={() => setActivityMode("point")}
                    type="button"
                  >
                    Point
                  </button>
                  <button
                    aria-pressed={activityMode === "before"}
                    className={activityMode === "before" ? styles.activityModeActive : undefined}
                    onClick={() => setActivityMode("before")}
                    type="button"
                  >
                    Before
                  </button>
                  <button
                    aria-pressed={activityMode === "after"}
                    className={activityMode === "after" ? styles.activityModeActive : undefined}
                    onClick={() => setActivityMode("after")}
                    type="button"
                  >
                    After
                  </button>
                </div>
              ) : null}
              {hasSelectedPoint ? (
                <button
                  className={styles.textButton}
                  onClick={() => setActiveIndex(null)}
                  type="button"
                >
                  Clear point
                </button>
              ) : null}
              <Link className={styles.textLink} href={activityHref}>Open transactions</Link>
            </div>
          </div>
          <TransactionRows transactions={visibleTransactions} />
        </section>
      ) : null}
    </div>
  );
}

const categoryTrendPalette = ["#4F6A4D", "#5A7298", "#8A6620", "#A85543", "#6C8A6A"];

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

interface CategoryTrendPoint {
  amount: number;
  date: string;
}

interface CategoryTrendSeries {
  color: string;
  count: number;
  id: string | null;
  label: string;
  openReviewCount: number;
  pendingAmount: number;
  points: CategoryTrendPoint[];
  trustedAmount: number;
  total: number;
  unresolvedReviewAmount: number;
}

interface IncomeBreakdownRow {
  amount: number;
  count: number;
  deltaAmount: number;
  deltaPercent: number;
  id: string | null;
  label: string;
  percent: number;
  previousAmount: number;
  sourceLabel: string;
}

interface IncomeBreakdownSummary {
  fromDate: string;
  rows: IncomeBreakdownRow[];
  toDate: string;
  totalAmount: number;
}

function formatPercentDelta(value: number) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatMonthLabel(fromDate: string) {
  return monthLabelFormatter.format(new Date(`${fromDate}T12:00:00`));
}

function dateRange(fromDate: string, toDate: string) {
  const dates: string[] = [];
  const start = parseIsoDate(fromDate);
  const end = parseIsoDate(toDate);

  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    dates.push(isoDate(new Date(time)));
  }

  return dates.length > 0 ? dates : [toDate];
}

function monthBoundsForOffset(asOfDate: string, monthOffset: number) {
  const date = parseIsoDate(`${asOfDate.slice(0, 7)}-01`);
  const targetStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthOffset, 1, 12));
  const targetEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthOffset + 1, 0, 12));
  const previousStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthOffset - 1, 1, 12));
  const previousEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthOffset, 0, 12));

  return {
    fromDate: isoDate(targetStart),
    previousFrom: isoDate(previousStart),
    previousTo: isoDate(previousEnd),
    toDate: isoDate(targetEnd)
  };
}

function dashboardTransactionIncomeAmount(transaction: DashboardBalanceTransaction) {
  if (transaction.amount <= 0 || transaction.intent === "transfer") return 0;
  return roundMoney(transaction.amount);
}

function percentDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function sourceSummary(sources: Map<string, { amount: number; count: number }>) {
  const sorted = [...sources.entries()].sort(([, left], [, right]) => (
    right.amount - left.amount || right.count - left.count
  ));
  const [topSource] = sorted[0] ?? ["Unknown source", { amount: 0, count: 0 }];

  if (sorted.length <= 1) return topSource;
  return `${topSource} + ${sorted.length - 1} more`;
}

function categoryIdsValue(categoryIds: Set<string>) {
  return categoryIds.size > 0 ? [...categoryIds].sort().join(",") : null;
}

function buildIncomeBreakdownForRange(
  transactions: readonly DashboardBalanceTransaction[],
  fromDate: string,
  toDate: string,
  previousFrom: string,
  previousTo: string
): IncomeBreakdownSummary {
  const reportableInflows = filterReportableInflowTransactions(transactions);
  const currentRows = new Map<string, {
    amount: number;
    count: number;
    id: string | null;
    label: string;
    sources: Map<string, { amount: number; count: number }>;
  }>();
  const previousAmounts = new Map<string, number>();
  let totalAmount = 0;

  reportableInflows.forEach((transaction) => {
    if (transaction.date < previousFrom || transaction.date > toDate) return;

    const amount = dashboardTransactionIncomeAmount(transaction);

    const id = transaction.categoryId;
    const label = transaction.category || "Other income";
    const key = id ?? label;

    if (transaction.date >= fromDate) {
      const current = currentRows.get(key) ?? {
        amount: 0,
        count: 0,
        id,
        label,
        sources: new Map<string, { amount: number; count: number }>()
      };
      const source = current.sources.get(transaction.merchant) ?? { amount: 0, count: 0 };

      source.amount = roundMoney(source.amount + amount);
      source.count += 1;
      current.sources.set(transaction.merchant, source);
      current.amount = roundMoney(current.amount + amount);
      current.count += 1;
      currentRows.set(key, current);
      totalAmount = roundMoney(totalAmount + amount);
    } else if (transaction.date >= previousFrom && transaction.date <= previousTo) {
      previousAmounts.set(key, roundMoney((previousAmounts.get(key) ?? 0) + amount));
    }
  });

  const rows = [...currentRows.values()].map((row) => {
    const previousAmount = previousAmounts.get(row.id ?? row.label) ?? 0;
    const deltaAmount = roundMoney(row.amount - previousAmount);

    return {
      amount: row.amount,
      count: row.count,
      deltaAmount,
      deltaPercent: percentDelta(row.amount, previousAmount),
      id: row.id,
      label: row.label,
      percent: totalAmount > 0 ? Math.round((row.amount / totalAmount) * 1000) / 10 : 0,
      previousAmount,
      sourceLabel: sourceSummary(row.sources)
    };
  }).sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label));

  return { fromDate, rows, toDate, totalAmount };
}

function buildIncomeBreakdownsByMonth(
  transactions: readonly DashboardBalanceTransaction[],
  asOfDate: string,
  monthCount = 6
) {
  const results: IncomeBreakdownSummary[] = [];

  for (let offset = 0; offset < monthCount; offset += 1) {
    const bounds = monthBoundsForOffset(asOfDate, offset);
    results.push(buildIncomeBreakdownForRange(
      transactions,
      bounds.fromDate,
      offset === 0 ? asOfDate : bounds.toDate,
      bounds.previousFrom,
      bounds.previousTo
    ));
  }

  return results;
}

function buildDashboardCategoryBreakdownForRange(
  transactions: readonly DashboardBalanceTransaction[],
  fromDate: string,
  toDate: string,
  previousFrom: string,
  previousTo: string
): CategoryBreakdownSummary {
  const reportableTransactions = excludeMatchedRefundReversalTransactions(transactions);
  const currentRows = new Map<string, {
    amount: number;
    categoryIds: Set<string>;
    count: number;
    label: string;
    openReviewCount: number;
  }>();
  const previousAmounts = new Map<string, number>();
  let totalAmount = 0;

  reportableTransactions.forEach((transaction) => {
    if (transaction.date < previousFrom || transaction.date > toDate) return;

    const amount = dashboardTransactionSpendingAmount(transaction);
    if (amount <= 0) return;

    const label = displayCategoryName(transaction.category);
    const key = label;

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

  const rows = [...currentRows.values()].map((row) => {
    const previousAmount = previousAmounts.get(row.label) ?? 0;
    const deltaAmount = roundMoney(row.amount - previousAmount);

    return {
      amount: row.amount,
      count: row.count,
      deltaAmount,
      deltaPercent: percentDelta(row.amount, previousAmount),
      id: categoryIdsValue(row.categoryIds),
      label: row.label,
      openReviewCount: row.openReviewCount,
      percent: totalAmount > 0 ? Math.round((row.amount / totalAmount) * 1000) / 10 : 0,
      previousAmount
    };
  }).sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label));

  return { fromDate, rows, toDate, totalAmount };
}

function buildDashboardCategoryBreakdownsByMonth(
  transactions: readonly DashboardBalanceTransaction[],
  asOfDate: string,
  monthCount = 6
) {
  const results: CategoryBreakdownSummary[] = [];

  for (let offset = 0; offset < monthCount; offset += 1) {
    const bounds = monthBoundsForOffset(asOfDate, offset);
    results.push(buildDashboardCategoryBreakdownForRange(
      transactions,
      bounds.fromDate,
      offset === 0 ? asOfDate : bounds.toDate,
      bounds.previousFrom,
      bounds.previousTo
    ));
  }

  return results;
}

function categoryRangeBounds(
  transactions: readonly DashboardBalanceTransaction[],
  rangeKey: TrendRangeKey,
  anchorDate: string
) {
  const reportableTransactions = excludeMatchedRefundReversalTransactions(transactions);
  const range = rangeOptionForKey(rangeKey);
  if (range.days) {
    return {
      fromDate: addDaysIso(anchorDate, -(range.days - 1)),
      toDate: anchorDate
    };
  }

  const firstTransactionDate = reportableTransactions.reduce<string | null>(
    (earliest, transaction) => {
      if (dashboardTransactionSpendingAmount(transaction) <= 0) return earliest;
      return earliest === null || transaction.date < earliest ? transaction.date : earliest;
    },
    null
  );

  return {
    fromDate: firstTransactionDate ?? anchorDate,
    toDate: anchorDate
  };
}

function buildCategoryTrend(
  transactions: readonly DashboardBalanceTransaction[],
  fromDate: string,
  toDate: string
) {
  const reportableTransactions = excludeMatchedRefundReversalTransactions(transactions);
  const grouped = new Map<string, {
    byDate: Map<string, number>;
    categoryIds: Set<string>;
    count: number;
    id: string | null;
    label: string;
    openReviewCount: number;
    pendingAmount: number;
    trustedAmount: number;
    total: number;
    unresolvedReviewAmount: number;
  }>();
  let totalAmount = 0;
  let totalCount = 0;
  let pendingAmount = 0;

  reportableTransactions.forEach((transaction) => {
    if (transaction.date < fromDate || transaction.date > toDate) return;

    const amount = dashboardTransactionSpendingAmount(transaction);
    if (amount <= 0) return;

    const label = displayCategoryName(transaction.category);
    const key = label;
    const group = grouped.get(key) ?? {
      byDate: new Map<string, number>(),
      categoryIds: new Set<string>(),
      count: 0,
      id: null,
      label,
      openReviewCount: 0,
      pendingAmount: 0,
      trustedAmount: 0,
      total: 0,
      unresolvedReviewAmount: 0
    };

    group.byDate.set(transaction.date, roundMoney((group.byDate.get(transaction.date) ?? 0) + amount));
    group.count += 1;
    group.total = roundMoney(group.total + amount);
    if (hasOpenReview(transaction)) {
      group.openReviewCount += 1;
      group.unresolvedReviewAmount = roundMoney(group.unresolvedReviewAmount + amount);
    } else {
      group.trustedAmount = roundMoney(group.trustedAmount + amount);
    }
    if (transaction.categoryId) group.categoryIds.add(transaction.categoryId);
    if (transaction.status === "pending") group.pendingAmount = roundMoney(group.pendingAmount + amount);
    grouped.set(key, group);

    totalAmount = roundMoney(totalAmount + amount);
    totalCount += 1;
    if (transaction.status === "pending") pendingAmount = roundMoney(pendingAmount + amount);
  });

  const dates = dateRange(fromDate, toDate);
  const series: CategoryTrendSeries[] = [...grouped.values()]
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label))
    .slice(0, 5)
    .map((group, index) => {
      let cumulative = 0;
      return {
        color: categoryTrendPalette[index % categoryTrendPalette.length],
        count: group.count,
        id: categoryIdsValue(group.categoryIds),
        label: group.label,
        openReviewCount: group.openReviewCount,
        pendingAmount: group.pendingAmount,
        points: dates.map((date) => {
          cumulative = roundMoney(cumulative + (group.byDate.get(date) ?? 0));
          return { amount: cumulative, date };
        }),
        total: group.total,
        trustedAmount: group.trustedAmount,
        unresolvedReviewAmount: group.unresolvedReviewAmount
      };
    });

  const maxAmount = Math.max(1, ...series.flatMap((row) => row.points.map((point) => point.amount)));

  return {
    dates,
    maxAmount,
    pendingAmount,
    series,
    totalAmount,
    totalCount
  };
}

function CashInflowsPanel({
  asOfDate,
  rangeKey,
  setRangeKey,
  transactions
}: {
  asOfDate: string;
  rangeKey: TrendRangeKey;
  setRangeKey: (key: TrendRangeKey) => void;
  transactions: DashboardBalanceTransaction[];
}) {
  const { fromDate, toDate } = useMemo(() => {
    const range = rangeOptionForKey(rangeKey);
    if (range.days) {
      return { fromDate: addDaysIso(asOfDate, -(range.days - 1)), toDate: asOfDate };
    }
    const firstIncomeDate = filterReportableInflowTransactions(transactions).reduce<string | null>((earliest, transaction) => {
      return earliest === null || transaction.date < earliest ? transaction.date : earliest;
    }, null);
    return { fromDate: firstIncomeDate ?? asOfDate, toDate: asOfDate };
  }, [asOfDate, rangeKey, transactions]);
  const { previousFrom, previousTo } = useMemo(() => {
    const fromMs = new Date(fromDate).getTime();
    const toMs = new Date(toDate).getTime();
    const spanDays = Math.max(1, Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1);
    return {
      previousFrom: addDaysIso(fromDate, -spanDays),
      previousTo: addDaysIso(fromDate, -1)
    };
  }, [fromDate, toDate]);
  const breakdown = useMemo(
    () => buildIncomeBreakdownForRange(transactions, fromDate, toDate, previousFrom, previousTo),
    [fromDate, previousFrom, previousTo, toDate, transactions]
  );
  const maxAmount = breakdown.rows[0]?.amount ?? 0;
  const rangeLabel = rangeKey === "ALL" ? "All time" : rangeKey;
  const subtitle = `${rangeLabel} - ${formatDate(fromDate)} to ${formatDate(toDate)} - ${breakdown.rows.length} ${breakdown.rows.length === 1 ? "category" : "categories"} - transfers excluded`;

  return (
    <section aria-label="Cash inflows by category" className={styles.categoryPanel}>
      <div className={styles.categoryPanelHead}>
        <div className={styles.categoryHeadIdentity}>
          <span className={styles.eyebrow}><Tags size={13} aria-hidden /> Cash inflows by category</span>
          <h3 className={styles.categoryHeadline}>{formatMoney(breakdown.totalAmount)}</h3>
          <p className={styles.categorySubtitle}>{subtitle}</p>
        </div>
        <Link
          className={styles.textLink}
          href={transactionsHref({ direction: "income", from: fromDate, to: toDate })}
        >
          Open transactions
        </Link>
      </div>

      <div className={styles.categoryRangeControls} aria-label="Cash inflow range">
        {trendRangeOptions.map((option) => (
          <button
            aria-pressed={rangeKey === option.key}
            className={rangeKey === option.key ? styles.categoryRangeActive : undefined}
            key={option.key}
            onClick={() => setRangeKey(option.key)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      {breakdown.rows.length === 0 ? (
        <div className={styles.categoryEmpty}>No positive non-transfer inflows recorded in this period.</div>
      ) : (
        <div className={styles.categoryRows}>
          {breakdown.rows.map((row) => {
            const widthPercent = maxAmount > 0 ? Math.max(2, (row.amount / maxAmount) * 100) : 0;
            const deltaTone = row.deltaAmount > 0 ? styles.positive : row.deltaAmount < 0 ? styles.negative : undefined;
            const deltaLabel = row.previousAmount > 0
              ? `${formatSignedMoney(row.deltaAmount)} (${formatPercentDelta(row.deltaPercent)})`
              : "New this period";

            return (
              <Link
                className={styles.categoryRow}
                href={transactionsHref({
                  category: row.id ?? undefined,
                  direction: "income",
                  from: fromDate,
                  q: row.id ? undefined : row.label,
                  to: toDate
                })}
                key={row.id ?? row.label}
                title={`See the ${row.count} ${row.count === 1 ? "transaction" : "transactions"} in ${row.label}`}
              >
                <div className={styles.categoryRowHead}>
                  <strong>{row.label}</strong>
                  <strong>{formatMoney(row.amount)}</strong>
                </div>
                <div className={styles.categoryRowBar} aria-hidden>
                  <span style={{ width: `${widthPercent}%` }} />
                </div>
                <div className={styles.categoryRowMeta}>
                  <span>
                    {row.percent.toFixed(1)}% - {row.count} {row.count === 1 ? "transaction" : "transactions"} - {row.sourceLabel}
                  </span>
                  <span className={deltaTone}>{deltaLabel}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CategorySpendingPanel({
  asOfDate,
  rangeKey,
  setRangeKey,
  transactions
}: {
  asOfDate: string;
  rangeKey: TrendRangeKey;
  setRangeKey: (key: TrendRangeKey) => void;
  transactions: DashboardBalanceTransaction[];
}) {
  const [viewMode, setViewMode] = useState<CategoryViewMode>("month");
  const [monthIndex, setMonthIndex] = useState(0);
  const breakdowns = useMemo(
    () => buildDashboardCategoryBreakdownsByMonth(transactions, asOfDate),
    [asOfDate, transactions]
  );
  const { fromDate, toDate } = useMemo(
    () => categoryRangeBounds(transactions, rangeKey, asOfDate),
    [asOfDate, rangeKey, transactions]
  );
  const trend = useMemo(
    () => buildCategoryTrend(transactions, fromDate, toDate),
    [fromDate, toDate, transactions]
  );
  const width = 560;
  const height = 220;
  const padding = { bottom: 28, left: 34, right: 18, top: 16 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const rangeLabel = rangeKey === "ALL" ? "All time" : rangeKey;
  const topTotal = roundMoney(trend.series.reduce((sum, row) => sum + row.total, 0));
  const otherAmount = roundMoney(trend.totalAmount - topTotal);
  const yLabels = [
    { label: trend.maxAmount, y: padding.top },
    { label: trend.maxAmount / 2, y: padding.top + plotHeight / 2 },
    { label: 0, y: padding.top + plotHeight }
  ];
  const pointX = (index: number) => (
    trend.dates.length === 1
    ? padding.left + plotWidth
      : padding.left + (index / (trend.dates.length - 1)) * plotWidth
  );
  const pointY = (amount: number) => padding.top + plotHeight - (amount / trend.maxAmount) * plotHeight;
  const safeMonthIndex = Math.min(Math.max(0, monthIndex), Math.max(0, breakdowns.length - 1));
  const breakdown = breakdowns[safeMonthIndex] ?? { fromDate: "", rows: [], toDate: "", totalAmount: 0 };
  const monthRows = breakdown.rows;
  const maxMonthAmount = monthRows[0]?.amount ?? 0;
  const monthLabel = breakdown.fromDate ? formatMonthLabel(breakdown.fromDate) : "Month";
  const monthPeriodLabel = breakdown.fromDate
    ? safeMonthIndex === 0
      ? `${formatDate(breakdown.fromDate)} to ${formatDate(breakdown.toDate)} so far`
      : `${formatDate(breakdown.fromDate)} to ${formatDate(breakdown.toDate)}`
    : "No monthly period";
  const panelAmount = viewMode === "trend" ? trend.totalAmount : breakdown.totalAmount;
  const panelSubtitle = viewMode === "trend"
    ? `${rangeLabel} - ${formatDate(fromDate)} to ${formatDate(toDate)} - ${trend.totalCount} ${trend.totalCount === 1 ? "transaction" : "transactions"}${trend.pendingAmount > 0 ? ` - ${formatMoney(trend.pendingAmount)} pending` : ""}`
    : `${monthLabel} - ${monthPeriodLabel} - ${monthRows.length} ${monthRows.length === 1 ? "category" : "categories"}`;
  const openTransactionsHref = viewMode === "trend"
    ? transactionsHref({ direction: "spending", exclude_transfers: true, from: fromDate, to: toDate })
    : transactionsHref({ direction: "spending", exclude_transfers: true, from: breakdown.fromDate, to: breakdown.toDate });

  return (
    <section aria-label="Spending by category" className={styles.categoryPanel}>
      <div className={styles.categoryPanelHead}>
        <div className={styles.categoryHeadIdentity}>
          <span className={styles.eyebrow}><Tags size={13} aria-hidden /> Spending by category</span>
          <h3 className={styles.categoryHeadline}>{formatMoney(panelAmount)}</h3>
          <p className={styles.categorySubtitle}>{panelSubtitle}</p>
        </div>
        <div className={styles.categoryPanelActions}>
          <div className={styles.categoryModeControls} aria-label="Category spending view">
            <button
              aria-pressed={viewMode === "month"}
              className={viewMode === "month" ? styles.categoryModeActive : undefined}
              onClick={() => setViewMode("month")}
              type="button"
            >
              Month
            </button>
            <button
              aria-pressed={viewMode === "trend"}
              className={viewMode === "trend" ? styles.categoryModeActive : undefined}
              onClick={() => setViewMode("trend")}
              type="button"
            >
              Trend
            </button>
          </div>
          <Link
            className={styles.textLink}
            href={openTransactionsHref}
          >
            Open transactions
          </Link>
        </div>
      </div>

      {viewMode === "trend" ? (
        <div className={styles.categoryRangeControls} aria-label="Category trend range">
          {trendRangeOptions.map((option) => (
            <button
              aria-pressed={rangeKey === option.key}
              className={rangeKey === option.key ? styles.categoryRangeActive : undefined}
              key={option.key}
              onClick={() => setRangeKey(option.key)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {viewMode === "trend" && trend.series.length === 0 ? (
        <div className={styles.categoryEmpty}>No spending recorded in this selected period.</div>
      ) : viewMode === "trend" ? (
        <>
          <div className={styles.categoryTrendChart}>
            <svg aria-label="Category spending trend" viewBox={`0 0 ${width} ${height}`}>
              {yLabels.map(({ label, y }) => (
                <g key={`${label}-${y}`}>
                  <line
                    stroke="var(--line-2)"
                    strokeDasharray="4 6"
                    strokeWidth="1"
                    x1={padding.left}
                    x2={width - padding.right}
                    y1={y}
                    y2={y}
                  />
                  <text className={styles.categoryScaleLabel} x="4" y={y + 4}>
                    {formatMoney(label, true)}
                  </text>
                </g>
              ))}
              {trend.series.map((row) => {
                const path = row.points.map((point, index) => {
                  const command = index === 0 ? "M" : "L";
                  return `${command}${pointX(index).toFixed(1)},${pointY(point.amount).toFixed(1)}`;
                }).join(" ");
                const finalPoint = row.points[row.points.length - 1];
                return (
                  <g key={row.id ?? row.label}>
                    <path d={path} fill="none" stroke={row.color} strokeLinecap="round" strokeWidth="2.5" />
                    <circle
                      cx={pointX(row.points.length - 1)}
                      cy={pointY(finalPoint.amount)}
                      fill="var(--surface)"
                      r="4"
                      stroke={row.color}
                      strokeWidth="2"
                    >
                      <title>{`${row.label}: ${formatMoney(row.total)}`}</title>
                    </circle>
                  </g>
                );
              })}
              <text className={styles.categoryDateLabel} x={padding.left} y={height - 8}>{formatDate(fromDate)}</text>
              <text className={styles.categoryDateLabel} textAnchor="end" x={width - padding.right} y={height - 8}>{formatDate(toDate)}</text>
            </svg>
          </div>

          <div className={styles.categoryRows}>
            {trend.series.map((row) => {
              return (
                <Link
                  className={styles.categoryRow}
                  href={transactionsHref({
                    category: row.id ?? undefined,
                    direction: "spending",
                    exclude_transfers: true,
                    from: fromDate,
                    q: row.id ? undefined : row.label,
                    to: toDate
                  })}
                  key={row.id ?? row.label}
                  title={`See the ${row.count} ${row.count === 1 ? "transaction" : "transactions"} in ${row.label}`}
                >
                  <div className={styles.categoryRowHead}>
                    <span className={styles.categoryLegendLabel}>
                      <span style={{ background: row.color }} />
                      <strong>{row.label}</strong>
                    </span>
                    <strong>{formatMoney(row.total)}</strong>
                  </div>
                  <div className={styles.categoryRowMeta}>
                    <span>
                      {row.count} {row.count === 1 ? "transaction" : "transactions"}
                    </span>
                    {row.pendingAmount > 0 ? <span>{formatMoney(row.pendingAmount)} pending</span> : <span>Cumulative trend</span>}
                  </div>
                </Link>
              );
            })}
            {otherAmount > 0 ? (
              <div className={styles.categoryOtherRow}>
                <span>Other categories</span>
                <strong>{formatMoney(otherAmount)}</strong>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className={styles.categoryMonthPicker} aria-label="Month">
            {breakdowns.map((option, index) => (
              <button
                aria-pressed={index === safeMonthIndex}
                className={`${styles.categoryMonthButton} ${index === safeMonthIndex ? styles.categoryMonthActive : ""}`}
                key={option.fromDate || index}
                onClick={() => setMonthIndex(index)}
                type="button"
              >
                {option.fromDate ? formatMonthLabel(option.fromDate) : `M-${index}`}
              </button>
            ))}
          </div>

          {monthRows.length === 0 ? (
            <div className={styles.categoryEmpty}>No spending recorded for {monthLabel}.</div>
          ) : (
            <div className={styles.categoryRows}>
              {monthRows.map((row) => {
                const widthPercent = maxMonthAmount > 0 ? Math.max(2, (row.amount / maxMonthAmount) * 100) : 0;
                const deltaTone = row.deltaAmount > 0 ? styles.negative : row.deltaAmount < 0 ? styles.positive : undefined;
                const deltaLabel = row.previousAmount > 0
                  ? `${formatSignedMoney(row.deltaAmount)} (${formatPercentDelta(row.deltaPercent)})`
                  : "New this month";
                return (
                  <Link
                    className={styles.categoryRow}
                    href={transactionsHref({
                      category: row.id ?? undefined,
                      direction: "spending",
                      exclude_transfers: true,
                      from: breakdown.fromDate,
                      q: row.id ? undefined : row.label,
                      to: breakdown.toDate
                    })}
                    key={row.id ?? row.label}
                    title={`See the ${row.count} ${row.count === 1 ? "transaction" : "transactions"} in ${row.label} for ${monthLabel}`}
                  >
                    <div className={styles.categoryRowHead}>
                      <strong>{row.label}</strong>
                      <strong>{formatMoney(row.amount)}</strong>
                    </div>
                    <div className={styles.categoryRowBar} aria-hidden>
                      <span style={{ width: `${widthPercent}%` }} />
                    </div>
                    <div className={styles.categoryRowMeta}>
                      <span>
                        {row.percent.toFixed(1)}% - {row.count} {row.count === 1 ? "transaction" : "transactions"}
                      </span>
                      <span className={deltaTone}>{deltaLabel}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NetWorthCompositionPanel({
  accounts,
  totals
}: {
  accounts: readonly AccountRecord[];
  totals: AccountBalanceTotals;
}) {
  if (accounts.length === 0) return null;

  const liquidAccounts = accounts
    .filter((account) => account.type === "depository")
    .map((account) => ({ account, value: account.balance }))
    .sort((a, b) => b.value - a.value);
  const investmentAccounts = accounts
    .filter((account) => account.type === "investment" || account.type === "retirement")
    .map((account) => ({ account, value: account.balance }))
    .sort((a, b) => b.value - a.value);
  const debtAccounts = accounts
    .filter((account) => account.type === "credit")
    .map((account) => ({ account, value: Math.abs(account.balance) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  const liquidTotal = liquidAccounts.reduce((sum, row) => sum + row.value, 0);
  const investmentTotal = investmentAccounts.reduce((sum, row) => sum + row.value, 0);
  const debtTotal = debtAccounts.reduce((sum, row) => sum + row.value, 0);
  const grossAssets = Math.max(liquidTotal, 0) + Math.max(investmentTotal, 0);

  const groups = [
    {
      accounts: liquidAccounts,
      color: "var(--sage-ink)",
      key: "liquid",
      label: "Liquid assets",
      total: liquidTotal
    },
    {
      accounts: investmentAccounts,
      color: "var(--info)",
      key: "investments",
      label: "Investments",
      total: investmentTotal
    }
  ].filter((group) => group.accounts.length > 0);

  return (
    <section aria-label="Net worth composition" className={styles.liabilityPanel}>
      <div className={styles.liabilityPanelHead}>
        <div>
          <span className={styles.eyebrow}>Composition</span>
          <h3 className={styles.liabilityHeadline}>{formatMoney(totals.netWorth)}</h3>
          <p className={styles.liabilityCoverage}>
            {formatMoney(grossAssets)} assets minus {formatMoney(debtTotal)} debt.
          </p>
        </div>
      </div>

      {grossAssets + debtTotal > 0 ? (() => {
        const barTotal = grossAssets + debtTotal;
        return (
          <div className={styles.compositionBar} role="img" aria-label="Net worth composition bar">
            {groups.map((group) => (
              <span
                key={group.key}
                className={styles.compositionSegment}
                style={{ background: group.color, width: `${(Math.max(0, group.total) / barTotal) * 100}%` }}
                title={`${group.label}: ${formatMoney(group.total)}`}
              />
            ))}
            {debtTotal > 0 ? (
              <span
                className={styles.compositionSegment}
                style={{ background: "var(--neg)", width: `${(debtTotal / barTotal) * 100}%` }}
                title={`Debt: ${formatMoney(debtTotal)}`}
              />
            ) : null}
          </div>
        );
      })() : null}

      <div className={styles.compositionGroups}>
        {groups.map((group) => (
          <div className={styles.compositionGroup} key={group.key}>
            <div className={styles.compositionGroupHead}>
              <strong>
                <span className={styles.compositionSwatch} style={{ background: group.color }} aria-hidden />
                {group.label}
              </strong>
              <span className={styles.compositionGroupValue}>{formatMoney(group.total)}</span>
            </div>
            <ul className={styles.compositionAccountList}>
              {group.accounts.map(({ account, value }) => (
                <li key={account.id} className={styles.compositionAccountRow}>
                  <span>{friendlyAccountLabel(account)}</span>
                  <strong className={value < 0 ? styles.liabilityOverdue : undefined}>
                    {formatMoney(value)}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {debtAccounts.length > 0 ? (
          <div className={styles.compositionGroup}>
            <div className={styles.compositionGroupHead}>
              <strong>
                <span className={styles.compositionSwatch} style={{ background: "var(--neg)" }} aria-hidden />
                Debt
              </strong>
              <span className={`${styles.compositionGroupValue} ${styles.liabilityOverdue}`}>
                −{formatMoney(debtTotal)}
              </span>
            </div>
            <ul className={styles.compositionAccountList}>
              {debtAccounts.map(({ account, value }) => (
                <li key={account.id} className={styles.compositionAccountRow}>
                  <span>{friendlyAccountLabel(account)}</span>
                  <strong className={styles.liabilityOverdue}>−{formatMoney(value)}</strong>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CashAccountsPanel({ accounts }: { accounts: readonly AccountRecord[] }) {
  const cashAccounts = accounts
    .filter((account) => account.type === "depository")
    .map((account) => ({ account, value: account.balance }))
    .sort((a, b) => b.value - a.value);

  if (cashAccounts.length === 0) return null;

  const total = cashAccounts.reduce((sum, row) => sum + row.value, 0);

  const maxValue = Math.max(...cashAccounts.map((row) => row.value), 1);

  return (
    <section aria-label="Liquid accounts" className={styles.liabilityPanel}>
      <div className={styles.liabilityPanelHead}>
        <div>
          <span className={styles.eyebrow}>Liquid accounts</span>
          <h3 className={styles.liabilityHeadline}>{formatMoney(total)}</h3>
          <p className={styles.liabilityCoverage}>Checking and savings — money available right now.</p>
        </div>
      </div>
      <div className={styles.liabilityRows}>
        {cashAccounts.map(({ account, value }) => {
          const share = total > 0 ? (value / total) * 100 : 0;
          const barWidth = (value / maxValue) * 100;
          return (
            <div className={styles.liabilityRow} key={account.id}>
              <div className={styles.liabilityRowMain}>
                <div>
                  <strong>{friendlyAccountLabel(account)}</strong>
                  <span>{accountGroupLabel(account)}</span>
                </div>
                <div className={styles.liabilityRowAmount}>
                  <strong className={value < 0 ? styles.liabilityOverdue : undefined}>{formatMoney(value)}</strong>
                  <span className={styles.liabilityCurrent}>{share.toFixed(1)}% of liquid</span>
                </div>
              </div>
              <div className={styles.utilizationTrack} aria-hidden>
                <span style={{ width: `${barWidth}%` }} className={styles.liabilityPaid} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CreditCardActionPanel({ summary }: { summary: LiabilitiesDueSummary }) {
  if (summary.rows.length === 0) return null;

  const practicalRowLimit = 6;
  const visibleRows = summary.rows.length <= practicalRowLimit ? summary.rows : summary.rows.slice(0, practicalRowLimit);
  const coverageTone = summary.coverageDelta < 0 ? styles.liabilityOverdue : styles.liabilityPaid;
  const coverageCopy = summary.coverageDelta < 0
    ? `Cash is short by ${formatMoney(Math.abs(summary.coverageDelta))} if you paid every card today.`
    : `Cash covers card balances with ${formatMoney(summary.coverageDelta)} left.`;
  const utilizationCopy = summary.aggregateUtilizationPercent === null || summary.highestIndividualUtilizationPercent === null
    ? "Utilization needs reported credit limits."
    : `Aggregate utilization ${summary.aggregateUtilizationPercent.toFixed(1)}%; highest card ${summary.highestIndividualUtilizationPercent.toFixed(1)}%.`;
  const target30ActionCount = summary.targetPaymentPlans
    .find((plan) => plan.targetUtilizationPercent === 30)
    ?.actions.length ?? 0;
  const reportingCopy = target30ActionCount > 0
    ? `${target30ActionCount} card${target30ActionCount === 1 ? "" : "s"} with estimated reported-balance targets.`
    : "No precise reported-balance target is available right now.";

  return (
    <section aria-label="Credit card actions" className={styles.liabilityPanel}>
      <div className={styles.liabilityPanelHead}>
        <div>
          <span className={styles.eyebrow}>Card actions</span>
          <h3 className={styles.liabilityHeadline}>{formatMoney(summary.totalOwed)}</h3>
          <p className={styles.liabilityCoverage}>
            {summary.hasOverdue
              ? "Best action first: overdue cards, then cash-covered payments, then utilization."
              : summary.hasDueSoon
                ? "Best action first: due-soon cards, then cash-covered payments, then utilization."
                : "Best action first: cash-covered payments, then utilization."}
          </p>
        </div>
        <div className={styles.liabilityCashBlock}>
          <span>Cash coverage</span>
          <strong className={coverageTone}>{formatSignedMoney(summary.coverageDelta)}</strong>
        </div>
      </div>

      <div className={styles.cardActionSummary}>
        <ShieldCheck size={16} aria-hidden />
        <span>{coverageCopy} Due dates protect payment history; statement timing may help reported balances. {utilizationCopy} {reportingCopy}</span>
      </div>

      <div className={styles.cardActionGrid}>
        {visibleRows.map((row, index) => {
          const utilization = row.utilizationPercent ?? 0;
          const utilizationWidth = Math.max(0, Math.min(100, utilization));
          const statusClass = cardStatusClass(row);

          return (
            <Link
              className={styles.cardActionRow}
              href={transactionsHref({ account: row.accountId })}
              key={row.accountId}
            >
              <div className={styles.cardActionTopline}>
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.institutionName}{row.mask ? ` - ${row.mask}` : ""}</span>
                </div>
                <div className={styles.liabilityRowAmount}>
                  <strong>{formatMoney(row.amountOwed)}</strong>
                  <span className={statusClass}>{cardDueLabel(row)}</span>
                </div>
              </div>

              <div className={styles.cardActionGuidance}>
                <strong className={styles.cardPrimaryAction}>
                  {index === 0 ? "Best action: " : ""}{cardPrimaryAction(row, summary)}
                </strong>
                <span>{cardDueDetail(row)}</span>
                <span>{cardReportingDateDetail(row)}</span>
                <span>{cardUtilizationDetail(row, summary)}</span>
              </div>

              <div className={styles.cardUtilizationLine}>
                <span>Utilization</span>
                <strong className={statusClass}>
                  {row.utilizationPercent === null ? "Unknown" : `${row.utilizationPercent.toFixed(1)}%`}
                </strong>
              </div>
              <div className={styles.utilizationTrack} aria-hidden>
                <span style={{ width: `${utilizationWidth}%` }} className={statusClass} />
              </div>
            </Link>
          );
        })}
      </div>

      {summary.rows.length > visibleRows.length ? (
        <Link className={styles.cardActionMoreLink} href="/accounts">
          View {summary.rows.length - visibleRows.length} more cards
        </Link>
      ) : null}
    </section>
  );
}

export function DashboardView({
  accounts,
  asOfDate,
  balanceTransactions,
  balanceTrends,
  dataError,
  isConfigured,
  isDemo,
  isSignedIn,
  liabilitiesDueSummary,
  snapshotCount,
  syncSummary,
  totals
}: DashboardViewProps) {
  const router = useRouter();
  const [balanceViewKey, setBalanceViewKey] = useState<DashboardBalanceScope>("cashMinusLiabilities");
  const [trendRangeKey, setTrendRangeKey] = useState<TrendRangeKey>("1W");
  const [cashInflowRangeKey, setCashInflowRangeKey] = useState<TrendRangeKey>("ALL");
  const [syncState, setSyncState] = useState<"idle" | "syncing">("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const cashScopeValue = totals.cash;
  const cashMinusLiabilities = totals.cash - totals.liabilities;
  const balanceViews: BalanceViewOption[] = useMemo(() => [
    {
      description: "Cash and card activity together for the day-to-day view.",
      icon: WalletCards,
      key: "cashMinusLiabilities",
      label: "Cash flow",
      positiveIsGood: true,
      tone: cashMinusLiabilities < 0 ? "negative" : "positive",
      value: cashMinusLiabilities
    },
    {
      description: "Checking, savings, and positive non-transfer inflows.",
      icon: Database,
      key: "cash",
      label: "Inflows / liquid assets",
      positiveIsGood: true,
      value: cashScopeValue
    },
    {
      description: "All assets minus credit card balances.",
      icon: Landmark,
      key: "netWorth",
      label: "Net worth",
      positiveIsGood: true,
      value: totals.netWorth
    }
  ], [cashMinusLiabilities, cashScopeValue, totals.netWorth]);
  const selectedBalanceView = balanceViews.find((option) => option.key === balanceViewKey) ?? balanceViews[0];
  const selectedBalanceTone = selectedBalanceView.tone ?? (selectedBalanceView.value < 0 ? "negative" : undefined);
  const lastSyncedLabel = formatRelativeTime(syncSummary.latestSyncedAt);

  async function syncPlaidData() {
    if (isDemo) {
      setSyncMessage("Demo data is static.");
      return;
    }

    setSyncState("syncing");
    setSyncMessage(null);

    try {
      const response = await fetch("/api/plaid/sync", {
        cache: "no-store",
        method: "POST"
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to sync Plaid data.");
      }

      setSyncMessage("Synced");
      router.refresh();
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Unable to sync Plaid data.");
    } finally {
      setSyncState("idle");
    }
  }

  return (
    <div className={styles.shell}>
      {!isConfigured ? (
        <Notice role="status">
          Supabase is not configured for this environment, so persisted dashboard data cannot be loaded.
        </Notice>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <Notice role="status">
          Sign in with Supabase Auth to load your persisted dashboard data.
        </Notice>
      ) : null}

      {dataError ? (
        <Notice role="alert" tone="error">
          {dataError}
        </Notice>
      ) : null}

      {accounts.length === 0 ? (
        <div className={styles.emptyState} role="status">
          <Database size={24} aria-hidden />
          <div>
            <strong>No persisted accounts yet</strong>
            <span>Connect Plaid to populate account balances and net worth.</span>
            <LinkButton href="/accounts">Go to accounts</LinkButton>
          </div>
        </div>
      ) : (
        <section aria-label="Balance dashboard" className={styles.hero}>
          <div className={styles.heroTop}>
            <div className={styles.heroIdentity}>
              <span className={styles.eyebrow}>{selectedBalanceView.label}</span>
              <h2 className={selectedBalanceTone ? styles[selectedBalanceTone] : undefined} key={`${selectedBalanceView.key}-${selectedBalanceView.value}`}>
                {formatMoney(selectedBalanceView.value)}
              </h2>
              <p className={styles.heroDescription}>{selectedBalanceView.description}</p>
            </div>
            <section className={styles.syncActionPanel} aria-label="Plaid sync">
              <div className={styles.syncActionMeta}>
                <Clock3 size={13} aria-hidden />
                <span>Plaid sync</span>
                <strong>{lastSyncedLabel}</strong>
              </div>
              <button
                aria-busy={syncState === "syncing"}
                className={styles.syncActionLink}
                disabled={isDemo || syncState === "syncing"}
                onClick={() => void syncPlaidData()}
                type="button"
              >
                <RefreshCw className={syncState === "syncing" ? styles.spin : undefined} size={13} aria-hidden />
                {isDemo ? "Demo" : syncState === "syncing" ? "Syncing" : "Sync"}
              </button>
              <span className={styles.syncActionStatus} role="status">
                {syncMessage ?? (isDemo ? "Read-only sample data" : "")}
              </span>
            </section>
          </div>

          <div className={styles.balanceViewControls} aria-label="Balance view">
            {balanceViews.map((option) => {
              const Icon = option.icon;
              const optionTone = option.tone ?? (option.value < 0 ? "negative" : undefined);
              return (
                <button
                  aria-label={`${option.label} balance view`}
                  aria-pressed={balanceViewKey === option.key}
                  className={[
                    styles.balanceViewButton,
                    balanceViewKey === option.key ? styles.balanceViewActive : ""
                  ].filter(Boolean).join(" ")}
                  key={option.key}
                  onClick={() => setBalanceViewKey(option.key)}
                  type="button"
                >
                  <span className={styles.balanceViewLabel}>
                    <Icon size={13} aria-hidden />
                    {option.label}
                  </span>
                  <strong className={optionTone ? styles[optionTone] : undefined}>
                    {formatMoney(option.value, true)}
                  </strong>
                </button>
              );
            })}
          </div>

          <TrendChart
            accounts={accounts}
            anchorDate={asOfDate}
            key={selectedBalanceView.key}
            positiveIsGood={selectedBalanceView.positiveIsGood}
            rangeKey={trendRangeKey}
            scope={selectedBalanceView.key}
            setRangeKey={setTrendRangeKey}
            snapshotCount={snapshotCount}
            transactions={balanceTransactions}
            trend={balanceTrends[selectedBalanceView.key]}
            valueLabel={selectedBalanceView.label}
          />
        </section>
      )}

      {accounts.length > 0 ? (() => {
        const scope = selectedBalanceView.key;
        const accountTypeById = new Map(accounts.map((account) => [account.id, account.type] as const));
        const scopedTransactions = balanceTransactions.filter((transaction) =>
          transactionIncludedInScope(transaction, accountTypeById, scope)
        );

        if (scope === "netWorth") {
          return <NetWorthCompositionPanel accounts={accounts} totals={totals} />;
        }

        if (scope === "cash") {
          return (
            <>
              <CashAccountsPanel accounts={accounts} />
              <CashInflowsPanel
                asOfDate={asOfDate}
                rangeKey={cashInflowRangeKey}
                setRangeKey={setCashInflowRangeKey}
                transactions={balanceTransactions}
              />
            </>
          );
        }

        return (
          <>
            <CreditCardActionPanel summary={liabilitiesDueSummary} />
            <CategorySpendingPanel
              asOfDate={asOfDate}
              rangeKey={trendRangeKey}
              setRangeKey={setTrendRangeKey}
              transactions={scopedTransactions}
            />
          </>
        );
      })() : null}
    </div>
  );
}
