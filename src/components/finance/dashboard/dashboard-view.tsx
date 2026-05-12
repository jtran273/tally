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
import {
  Clock3,
  CreditCard,
  Database,
  Landmark,
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
  date: string;
  id: string;
  intent: TransactionIntent;
  merchant: string;
  status: TransactionStatus;
}

interface DashboardViewProps {
  accounts: AccountRecord[];
  balanceTransactions: DashboardBalanceTransaction[];
  balanceTrends: Record<BalanceTrendScope, BalanceTrendPoint[]>;
  dataError?: string;
  isConfigured: boolean;
  isSignedIn: boolean;
  liabilitiesDue: LiabilitiesDueSummary;
  snapshotCount: number;
  syncSummary: SyncSummary;
  totals: AccountBalanceTotals;
}

type TrendRangeKey = "1M" | "3M" | "6M" | "1Y" | "ALL";
type ActivityMode = "change" | "through";

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
  { days: 31, key: "1M", label: "1M" },
  { days: 93, key: "3M", label: "3M" },
  { days: 186, key: "6M", label: "6M" },
  { days: 366, key: "1Y", label: "1Y" },
  { days: null, key: "ALL", label: "All" }
];

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

function filterTrendByRange(trend: readonly BalanceTrendPoint[], rangeKey: TrendRangeKey) {
  const range = trendRangeOptions.find((option) => option.key === rangeKey);
  if (!range?.days || trend.length < 2) return [...trend];

  const latest = trend[trend.length - 1];
  const latestTime = new Date(`${latest.date}T12:00:00`).getTime();
  const cutoffTime = latestTime - range.days * 24 * 60 * 60 * 1000;
  const firstInRangeIndex = trend.findIndex((point) => new Date(`${point.date}T12:00:00`).getTime() >= cutoffTime);

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
  positiveIsGood,
  scope,
  snapshotCount,
  transactions,
  trend,
  valueLabel
}: {
  accounts: AccountRecord[];
  positiveIsGood: boolean;
  scope: BalanceTrendScope;
  snapshotCount: number;
  transactions: DashboardBalanceTransaction[];
  trend: BalanceTrendPoint[];
  valueLabel: string;
}) {
  const [rangeKey, setRangeKey] = useState<TrendRangeKey>("6M");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activityMode, setActivityMode] = useState<ActivityMode>("change");
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
  const selectedTrend = useMemo(() => filterTrendByRange(trend, rangeKey), [rangeKey, trend]);
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
  const selectedIndex = activeIndex === null
    ? selectedTrend.length - 1
    : Math.min(activeIndex, selectedTrend.length - 1);
  const previousPoint = selectedIndex > 0 ? selectedTrend[selectedIndex - 1] : null;
  const activePoint = selectedTrend[selectedIndex];
  const activeCoords = points[selectedIndex];
  const activeDelta = pointDelta(selectedTrend, selectedIndex);
  const activeDeltaClass = activeDelta ? deltaToneClass(activeDelta.amount, positiveIsGood) : undefined;
  const pointTransactions = sortTransactionsForPoint(
    scopedTransactions.filter((transaction) => (
      previousPoint
        ? transaction.date > previousPoint.date && transaction.date <= activePoint.date
        : transaction.date <= activePoint.date
    )),
    activeDelta?.amount ?? null
  ).slice(0, 8);
  const throughTransactions = sortTransactionsByDate(
    scopedTransactions.filter((transaction) => transaction.date <= activePoint.date)
  ).slice(0, 8);
  const visibleTransactions = activityMode === "change" ? pointTransactions : throughTransactions;
  const activityHref = transactionsHref({
    exclude_transfers: true,
    from: activityMode === "change" ? previousPoint?.date : undefined,
    to: activePoint.date
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

      <div className={styles.trendInspector} aria-live="polite">
        <div>
          <span>Selected point</span>
          <strong>{formatLongDate(activePoint.date)}</strong>
          <em>{formatMoney(activePoint.netWorth)}</em>
        </div>
        <div>
          <span>Point change</span>
          <strong className={activeDeltaClass}>
            {activeDelta ? (
              <>
                {formatSignedMoney(activeDelta.amount)} ({activeDelta.percent >= 0 ? "+" : ""}{activeDelta.percent.toFixed(1)}%)
              </>
            ) : (
              "Range start"
            )}
          </strong>
          <em>{activeSourceLabel}</em>
        </div>
        <div>
          <span>Y-axis scale</span>
          <strong>{formatMoney(min, true)} to {formatMoney(max, true)}</strong>
          <em>{formatLongDate(start.date)} to {formatLongDate(end.date)}</em>
        </div>
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
          {activeCoords ? (
            <line
              className={styles.trendCrosshair}
              x1={activeCoords[0]}
              x2={activeCoords[0]}
              y1={padding.top}
              y2={height - padding.bottom}
            />
          ) : null}
          {points.map(([x, y], index) => {
            const point = selectedTrend[index];
            const isActive = index === selectedIndex;
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
            <h3>{activityMode === "change" ? "Moved this point" : "Up to selected date"}</h3>
          </div>
          <div className={styles.activityActions}>
            <div className={styles.activityModeControls} aria-label="Transaction scope">
              <button
                aria-pressed={activityMode === "change"}
                className={activityMode === "change" ? styles.activityModeActive : undefined}
                onClick={() => setActivityMode("change")}
                type="button"
              >
                Point change
              </button>
              <button
                aria-pressed={activityMode === "through"}
                className={activityMode === "through" ? styles.activityModeActive : undefined}
                onClick={() => setActivityMode("through")}
                type="button"
              >
                Up to date
              </button>
            </div>
            <Link className={styles.textLink} href={activityHref}>Open transactions</Link>
          </div>
        </div>
        <TransactionRows transactions={visibleTransactions} />
      </section>
    </div>
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
  balanceTransactions,
  balanceTrends,
  dataError,
  isConfigured,
  isSignedIn,
  liabilitiesDue,
  snapshotCount,
  syncSummary,
  totals
}: DashboardViewProps) {
  const [balanceViewKey, setBalanceViewKey] = useState<BalanceTrendScope>("netWorth");
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
            key={selectedBalanceView.key}
            positiveIsGood={selectedBalanceView.positiveIsGood}
            scope={selectedBalanceView.key}
            snapshotCount={snapshotCount}
            transactions={balanceTransactions}
            trend={balanceTrends[selectedBalanceView.key]}
            valueLabel={selectedBalanceView.label}
          />
        </section>
      )}

      {accounts.length > 0 ? <LiabilitiesDuePanel summary={liabilitiesDue} /> : null}
    </div>
  );
}
