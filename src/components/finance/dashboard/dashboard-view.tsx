"use client";

import type {
  AccountRecord,
  TransactionIntent,
  TransactionStatus
} from "@/lib/db";
import type {
  AccountBalanceTotals,
  BalanceTrendPoint,
  BalanceTrendScope,
  SyncSummary
} from "@/lib/finance/balances";
import type { LiabilitiesDueSummary, LiabilityAccountSummary } from "@/lib/finance/liabilities";
import { isReportableIncomeIntent } from "@/lib/finance/reimbursement-linking";
import { isSpendingIntent, type CategoryBreakdownSummary } from "@/lib/finance/spending";
import {
  Clock3,
  CreditCard,
  Database,
  Landmark,
  Tags,
  TrendingDown,
  TrendingUp,
  WalletCards,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
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
  splits: { amount: number; intent: TransactionIntent }[];
  status: TransactionStatus;
}

interface DashboardViewProps {
  accounts: AccountRecord[];
  asOfDate: string;
  balanceTransactions: DashboardBalanceTransaction[];
  balanceTrends: Record<BalanceTrendScope, BalanceTrendPoint[]>;
  categoryBreakdowns: CategoryBreakdownSummary[];
  dataError?: string;
  isConfigured: boolean;
  isSignedIn: boolean;
  liabilitiesDue: LiabilitiesDueSummary;
  snapshotCount: number;
  syncSummary: SyncSummary;
  totals: AccountBalanceTotals;
}

type TrendRangeKey = "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";
type ActivityMode = "point" | "through";
type CategoryViewMode = "trend" | "month";

interface BalanceViewOption {
  description: string;
  icon: LucideIcon;
  key: BalanceTrendScope;
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

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
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
  const percent = first.netWorth === 0 ? 0 : (amount / Math.abs(first.netWorth)) * 100;

  return { amount, percent };
}

function pointDelta(trend: readonly BalanceTrendPoint[], index: number) {
  if (index <= 0 || trend.length < 2) return null;

  const previous = trend[index - 1];
  const current = trend[index];
  const amount = current.netWorth - previous.netWorth;
  const percent = previous.netWorth === 0 ? 0 : (amount / Math.abs(previous.netWorth)) * 100;

  return { amount, percent };
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

function syncLabel(summary: SyncSummary) {
  if (summary.status === "empty") return "No accounts";
  if (summary.status === "never") return "Never synced";
  if (summary.status === "stale") return `${summary.staleCount + summary.neverSyncedCount} stale`;
  return "Fresh";
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

function accountIncludedInScope(type: AccountRecord["type"] | undefined, scope: BalanceTrendScope) {
  if (scope === "netWorth") return true;
  if (!type) return false;
  if (scope === "cash") return type === "depository";
  if (scope === "liabilities") return type === "credit";
  return type === "depository" || type === "credit";
}

function transactionIncludedInScope(
  transaction: DashboardBalanceTransaction,
  accountTypeById: ReadonlyMap<string, AccountRecord["type"]>,
  scope: BalanceTrendScope
) {
  if (transaction.intent === "transfer") return false;
  return accountIncludedInScope(accountTypeById.get(transaction.accountId), scope);
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
          <div>
            <strong>{transaction.merchant}</strong>
            <span>
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
  scope: BalanceTrendScope;
  setRangeKey: (key: TrendRangeKey) => void;
  snapshotCount: number;
  transactions: DashboardBalanceTransaction[];
  trend: BalanceTrendPoint[];
  valueLabel: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activityMode, setActivityMode] = useState<ActivityMode>("point");
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
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
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
    const y = padding.top + plotHeight - ((point.netWorth - min) / range) * plotHeight;
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
    scopedTransactions.filter((transaction) => transaction.date >= start.date && transaction.date <= end.date)
  ).slice(0, 10);
  const pointTransactions = hasSelectedPoint ? sortTransactionsForPoint(
    scopedTransactions.filter((transaction) => (
      previousPoint
        ? transaction.date > previousPoint.date && transaction.date <= activePoint.date
        : transaction.date >= start.date && transaction.date <= activePoint.date
    )),
    activeDelta?.amount ?? null
  ).slice(0, 10) : periodTransactions;
  const throughTransactions = hasSelectedPoint ? sortTransactionsByDate(
    scopedTransactions.filter((transaction) => transaction.date >= start.date && transaction.date <= activePoint.date)
  ).slice(0, 10) : periodTransactions;
  const visibleTransactions = !hasSelectedPoint
    ? periodTransactions
    : activityMode === "point"
      ? pointTransactions
      : throughTransactions;
  const activityFromDate = !hasSelectedPoint
    ? start.date
    : activityMode === "point"
      ? previousPoint ? addDaysIso(previousPoint.date, 1) : start.date
      : start.date;
  const activityToDate = hasSelectedPoint ? activePoint.date : end.date;
  const activityHref = transactionsHref({
    exclude_transfers: true,
    from: activityFromDate,
    to: activityToDate
  });
  const gridLines = [
    { label: max, y: padding.top },
    { label: min + range / 2, y: padding.top + plotHeight / 2 },
    { label: min, y: padding.top + plotHeight }
  ];
  const sourceLabel = hasSnapshotTrend
    ? `${snapshotCount.toLocaleString("en-US")} balance snapshots available`
    : hasTransactionTrend
      ? "Estimated from posted non-transfer transaction history"
      : "Snapshot trend unavailable; using current persisted balances";
  const activeSourceLabel = activePoint.source === "snapshot"
    ? "Daily Plaid balance snapshot"
    : activePoint.source === "transaction"
      ? "Estimated from posted transactions"
      : "Current persisted balance";
  const selectedPeriodDeltaLabel = delta
    ? `${formatSignedMoney(delta.amount)} (${delta.percent >= 0 ? "+" : ""}${delta.percent.toFixed(1)}%)`
    : "No change yet";
  const selectedPointDeltaLabel = activeDelta
    ? `${formatSignedMoney(activeDelta.amount)} (${activeDelta.percent >= 0 ? "+" : ""}${activeDelta.percent.toFixed(1)}%)`
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
  const activityTitle = !hasSelectedPoint
    ? "Transactions in selected period"
    : activityMode === "point"
      ? "Transactions for selected point"
      : "Transactions up to selected point";

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
                {formatSignedMoney(delta.amount)} ({delta.percent >= 0 ? "+" : ""}{delta.percent.toFixed(1)}%)
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
                {formatMoney(label, true)}
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

      <section className={styles.activityPanel} aria-label="Selected balance transactions">
        <div className={styles.activityHead}>
          <div>
            <span className={styles.eyebrow}>Transactions</span>
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
                  aria-pressed={activityMode === "through"}
                  className={activityMode === "through" ? styles.activityModeActive : undefined}
                  onClick={() => setActivityMode("through")}
                  type="button"
                >
                  Up to point
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
    </div>
  );
}

const categoryTrendPalette = ["#2f6f4e", "#2f5f8f", "#9a6b1f", "#7a4f9f", "#b55353"];

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
  pendingAmount: number;
  points: CategoryTrendPoint[];
  total: number;
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
  if (transaction.amount <= 0 || !isReportableIncomeIntent(transaction.intent)) return 0;
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

function buildIncomeBreakdownForRange(
  transactions: readonly DashboardBalanceTransaction[],
  fromDate: string,
  toDate: string,
  previousFrom: string,
  previousTo: string
): IncomeBreakdownSummary {
  const currentRows = new Map<string, {
    amount: number;
    count: number;
    id: string | null;
    label: string;
    sources: Map<string, { amount: number; count: number }>;
  }>();
  const previousAmounts = new Map<string, number>();
  let totalAmount = 0;

  transactions.forEach((transaction) => {
    if (transaction.date < previousFrom || transaction.date > toDate) return;

    const amount = dashboardTransactionIncomeAmount(transaction);
    if (amount <= 0) return;

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

function categoryRangeBounds(
  transactions: readonly DashboardBalanceTransaction[],
  rangeKey: TrendRangeKey,
  anchorDate: string
) {
  const range = rangeOptionForKey(rangeKey);
  if (range.days) {
    return {
      fromDate: addDaysIso(anchorDate, -(range.days - 1)),
      toDate: anchorDate
    };
  }

  const firstTransactionDate = transactions.reduce<string | null>(
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
  const grouped = new Map<string, {
    byDate: Map<string, number>;
    count: number;
    id: string | null;
    label: string;
    pendingAmount: number;
    total: number;
  }>();
  let totalAmount = 0;
  let totalCount = 0;
  let pendingAmount = 0;

  transactions.forEach((transaction) => {
    if (transaction.date < fromDate || transaction.date > toDate) return;

    const amount = dashboardTransactionSpendingAmount(transaction);
    if (amount <= 0) return;

    const key = transaction.categoryId ?? transaction.category;
    const group = grouped.get(key) ?? {
      byDate: new Map<string, number>(),
      count: 0,
      id: transaction.categoryId,
      label: transaction.category,
      pendingAmount: 0,
      total: 0
    };

    group.byDate.set(transaction.date, roundMoney((group.byDate.get(transaction.date) ?? 0) + amount));
    group.count += 1;
    group.total = roundMoney(group.total + amount);
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
        id: group.id,
        label: group.label,
        pendingAmount: group.pendingAmount,
        points: dates.map((date) => {
          cumulative = roundMoney(cumulative + (group.byDate.get(date) ?? 0));
          return { amount: cumulative, date };
        }),
        total: group.total
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

function IncomeByCategoryPanel({
  asOfDate,
  transactions
}: {
  asOfDate: string;
  transactions: DashboardBalanceTransaction[];
}) {
  const [monthIndex, setMonthIndex] = useState(0);
  const breakdowns = useMemo(
    () => buildIncomeBreakdownsByMonth(transactions, asOfDate, 6),
    [asOfDate, transactions]
  );
  const safeMonthIndex = Math.min(Math.max(0, monthIndex), Math.max(0, breakdowns.length - 1));
  const breakdown = breakdowns[safeMonthIndex] ?? { fromDate: "", rows: [], toDate: "", totalAmount: 0 };
  const maxAmount = breakdown.rows[0]?.amount ?? 0;
  const monthLabel = breakdown.fromDate ? formatMonthLabel(breakdown.fromDate) : "Month";
  const monthPeriodLabel = breakdown.fromDate
    ? safeMonthIndex === 0
      ? `${formatDate(breakdown.fromDate)} to ${formatDate(breakdown.toDate)} so far`
      : `${formatDate(breakdown.fromDate)} to ${formatDate(breakdown.toDate)}`
    : "No monthly period";
  const subtitle = `${monthLabel} - ${monthPeriodLabel} - ${breakdown.rows.length} ${breakdown.rows.length === 1 ? "category" : "categories"} - transfers excluded`;

  return (
    <section aria-label="Income by category" className={styles.categoryPanel}>
      <div className={styles.categoryPanelHead}>
        <div className={styles.categoryHeadIdentity}>
          <span className={styles.eyebrow}><Tags size={13} aria-hidden /> Income by category</span>
          <h3 className={styles.categoryHeadline}>{formatMoney(breakdown.totalAmount)}</h3>
          <p className={styles.categorySubtitle}>{subtitle}</p>
        </div>
        <Link
          className={styles.textLink}
          href={transactionsHref({ from: breakdown.fromDate, to: breakdown.toDate })}
        >
          Open transactions
        </Link>
      </div>

      <div className={styles.categoryMonthPicker} aria-label="Income month">
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

      {breakdown.rows.length === 0 ? (
        <div className={styles.categoryEmpty}>No positive non-transfer income recorded for {monthLabel}.</div>
      ) : (
        <div className={styles.categoryRows}>
          {breakdown.rows.map((row) => {
            const widthPercent = maxAmount > 0 ? Math.max(2, (row.amount / maxAmount) * 100) : 0;
            const deltaTone = row.deltaAmount > 0 ? styles.positive : row.deltaAmount < 0 ? styles.negative : undefined;
            const deltaLabel = row.previousAmount > 0
              ? `${formatSignedMoney(row.deltaAmount)} (${formatPercentDelta(row.deltaPercent)})`
              : "New this month";

            return (
              <Link
                className={styles.categoryRow}
                href={transactionsHref({
                  category: row.id ?? undefined,
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
  breakdowns,
  rangeKey,
  setRangeKey,
  transactions
}: {
  asOfDate: string;
  breakdowns: CategoryBreakdownSummary[];
  rangeKey: TrendRangeKey;
  setRangeKey: (key: TrendRangeKey) => void;
  transactions: DashboardBalanceTransaction[];
}) {
  const [viewMode, setViewMode] = useState<CategoryViewMode>("month");
  const [monthIndex, setMonthIndex] = useState(0);
  const { fromDate, toDate } = useMemo(
    () => categoryRangeBounds(transactions, rangeKey, asOfDate),
    [asOfDate, rangeKey, transactions]
  );
  const trend = useMemo(
    () => buildCategoryTrend(transactions, fromDate, toDate),
    [fromDate, toDate, transactions]
  );
  const width = 720;
  const height = 248;
  const padding = { bottom: 32, left: 58, right: 22, top: 18 };
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
    ? transactionsHref({ exclude_transfers: true, from: fromDate, to: toDate })
    : transactionsHref({ exclude_transfers: true, from: breakdown.fromDate, to: breakdown.toDate });

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
              aria-pressed={viewMode === "trend"}
              className={viewMode === "trend" ? styles.categoryModeActive : undefined}
              onClick={() => setViewMode("trend")}
              type="button"
            >
              Trend
            </button>
            <button
              aria-pressed={viewMode === "month"}
              className={viewMode === "month" ? styles.categoryModeActive : undefined}
              onClick={() => setViewMode("month")}
              type="button"
            >
              Month
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
            {trend.series.map((row) => (
              <Link
                className={styles.categoryRow}
                href={transactionsHref({
                  category: row.id ?? undefined,
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
                  <span>{row.count} {row.count === 1 ? "transaction" : "transactions"}</span>
                  {row.pendingAmount > 0 ? <span>{formatMoney(row.pendingAmount)} pending</span> : <span>Cumulative trend</span>}
                </div>
              </Link>
            ))}
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
                        {row.openReviewCount > 0 ? ` - ${row.openReviewCount} in review` : ""}
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

function liabilityStatusLabel(row: LiabilityAccountSummary) {
  if (row.status === "no-balance") return "Paid off";
  if (row.status === "overdue") return `${Math.abs(row.daysUntilDue ?? 0)}d overdue`;
  if (row.status === "due-soon") return `Due in ${row.daysUntilDue}d`;
  if (row.daysUntilDue !== null) return `~${row.daysUntilDue}d`;
  return "Schedule unknown";
}

function liabilityStatusClass(status: LiabilityAccountSummary["status"]) {
  if (status === "overdue") return styles.liabilityOverdue;
  if (status === "due-soon") return styles.liabilityDueSoon;
  if (status === "no-balance") return styles.liabilityPaid;
  return styles.liabilityCurrent;
}

function LiabilitiesDuePanel({ summary }: { summary: LiabilitiesDueSummary }) {
  if (summary.rows.length === 0) return null;

  const coverageOk = summary.coverageDelta >= 0;
  const coverageLabel = coverageOk
    ? `${formatMoney(summary.coverageDelta)} left after paying all balances`
    : `${formatMoney(Math.abs(summary.coverageDelta))} short — cash can't cover total owed`;
  const headlineTone = summary.hasOverdue
    ? styles.liabilityOverdue
    : summary.hasDueSoon
      ? styles.liabilityDueSoon
      : coverageOk
        ? styles.liabilityCurrent
        : styles.liabilityDueSoon;

  return (
    <section aria-label="Liabilities due" className={styles.liabilityPanel}>
      <div className={styles.liabilityPanelHead}>
        <div>
          <span className={styles.eyebrow}>Liabilities due</span>
          <h3 className={styles.liabilityHeadline}>{formatMoney(summary.totalOwed)} owed</h3>
          <p className={`${styles.liabilityCoverage} ${headlineTone}`}>{coverageLabel}</p>
        </div>
        <div className={styles.liabilityCashBlock}>
          <span>Cash available</span>
          <strong>{formatMoney(summary.cashAvailable)}</strong>
        </div>
      </div>

      <div className={styles.liabilityRows}>
        {summary.rows.map((row) => {
          const utilization = row.utilizationPercent ?? 0;
          const utilizationLabel = row.creditLimit
            ? `${utilization.toFixed(1)}% of ${formatMoney(row.creditLimit)} limit`
            : "No limit reported";
          const lastPayment = row.lastPaymentDate
            ? `Last payment ${formatDate(row.lastPaymentDate)}${row.lastPaymentAmount ? ` · ${formatMoney(row.lastPaymentAmount)}` : ""}`
            : "No payment seen yet";
          const dueLabel = row.estimatedDueDate ? `Est. due ${formatDate(row.estimatedDueDate)}` : "Schedule unknown";

          return (
            <div className={styles.liabilityRow} key={row.accountId}>
              <div className={styles.liabilityRowMain}>
                <div>
                  <strong>{row.name}{row.mask ? ` · ${row.mask}` : ""}</strong>
                  <span>{row.institutionName}</span>
                </div>
                <div className={styles.liabilityRowAmount}>
                  <strong>{formatMoney(row.amountOwed)}</strong>
                  <span className={liabilityStatusClass(row.status)}>{liabilityStatusLabel(row)}</span>
                </div>
              </div>
              <div className={styles.liabilityRowMeta}>
                <span>{dueLabel}</span>
                <span>{lastPayment}</span>
                <span>{utilizationLabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardView({
  accounts,
  asOfDate,
  balanceTransactions,
  balanceTrends,
  categoryBreakdowns,
  dataError,
  isConfigured,
  isSignedIn,
  liabilitiesDue,
  snapshotCount,
  syncSummary,
  totals
}: DashboardViewProps) {
  const [balanceViewKey, setBalanceViewKey] = useState<BalanceTrendScope>("cashMinusLiabilities");
  const [trendRangeKey, setTrendRangeKey] = useState<TrendRangeKey>("1W");
  const [categoryRangeKey, setCategoryRangeKey] = useState<TrendRangeKey>("1M");
  const cashMinusLiabilities = totals.cash - totals.liabilities;
  const balanceViews: BalanceViewOption[] = [
    {
      description: "All assets minus credit card balances.",
      icon: Landmark,
      key: "netWorth",
      label: "Net worth",
      positiveIsGood: true,
      value: totals.netWorth
    },
    {
      description: "Checking, savings, and other cash accounts.",
      icon: Database,
      key: "cash",
      label: "Cash",
      positiveIsGood: true,
      value: totals.cash
    },
    {
      description: "Credit card balances owed.",
      icon: CreditCard,
      key: "liabilities",
      label: "Liabilities",
      positiveIsGood: false,
      tone: "negative",
      value: totals.liabilities
    },
    {
      description: "Cash accounts after subtracting liabilities.",
      icon: WalletCards,
      key: "cashMinusLiabilities",
      label: "Cash - liabilities",
      positiveIsGood: true,
      tone: cashMinusLiabilities < 0 ? "negative" : "positive",
      value: cashMinusLiabilities
    }
  ];
  const selectedBalanceView = balanceViews.find((option) => option.key === balanceViewKey) ?? balanceViews[0];
  const selectedBalanceTone = selectedBalanceView.tone ?? (selectedBalanceView.value < 0 ? "negative" : undefined);

  return (
    <div className={styles.shell}>
      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so persisted dashboard data cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in with Supabase Auth to load your persisted dashboard data.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <div className={styles.emptyState}>
          <Database size={24} aria-hidden />
          <div>
            <strong>No persisted accounts yet</strong>
            <span>Connect Plaid to populate account balances and net worth.</span>
          </div>
        </div>
      ) : (
        <section aria-label="Balance dashboard" className={styles.hero}>
          <div className={styles.heroTop}>
            <div className={styles.heroIdentity}>
              <span className={styles.eyebrow}>{selectedBalanceView.label}</span>
              <h2 className={selectedBalanceTone ? styles[selectedBalanceTone] : undefined}>
                {formatMoney(selectedBalanceView.value)}
              </h2>
              <p className={styles.heroDescription}>{selectedBalanceView.description}</p>
            </div>
            <div className={`${styles.syncPill} ${styles[`sync-${syncSummary.status}`]}`}>
              <Clock3 size={13} aria-hidden />
              <span>{syncLabel(syncSummary)}</span>
              <span>{formatRelativeTime(syncSummary.latestSyncedAt)}</span>
            </div>
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

      {accounts.length > 0 ? <LiabilitiesDuePanel summary={liabilitiesDue} /> : null}
      {accounts.length > 0 ? (
        <CategorySpendingPanel
          asOfDate={asOfDate}
          breakdowns={categoryBreakdowns}
          rangeKey={categoryRangeKey}
          setRangeKey={setCategoryRangeKey}
          transactions={balanceTransactions}
        />
      ) : null}
      {accounts.length > 0 ? (
        <IncomeByCategoryPanel
          asOfDate={asOfDate}
          transactions={balanceTransactions}
        />
      ) : null}
    </div>
  );
}
