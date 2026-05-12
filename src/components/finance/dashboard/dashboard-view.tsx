"use client";

import type {
  AccountRecord,
  RecurringExpenseRecord,
  ReviewQueueItem,
  TransactionRecord
} from "@/lib/db";
import type {
  AccountGroup,
  AccountBalanceTotals,
  BalanceTrendPoint,
  BalanceTrendScope,
  SyncSummary
} from "@/lib/finance/balances";
import type { CategoryBreakdownSummary, CategoryCleanupAction, SpendingGroupSummary, SpendingInsightSummary } from "@/lib/finance/spending";
import type { DashboardInsightCard } from "@/lib/insights";
import {
  Clock3,
  CreditCard,
  Database,
  Landmark,
  ShieldCheck,
  Sparkles,
  Store,
  Tags,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  WalletCards,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./dashboard.module.css";
import type { BudgetGuardrailItem, BudgetGuardrailSummary } from "@/lib/finance/budget-guardrails";
import type { MonthlyCashflowRunwaySummary } from "@/lib/finance/cashflow";
import type { RecurringCandidate } from "@/lib/recurring";

interface DashboardViewProps {
  accounts: AccountRecord[];
  balanceTrends: Record<BalanceTrendScope, BalanceTrendPoint[]>;
  budgetGuardrails: BudgetGuardrailSummary;
  categoryBreakdown: CategoryBreakdownSummary;
  cashflowRunway: MonthlyCashflowRunwaySummary;
  dataError?: string;
  groups: AccountGroup[];
  insightCards: DashboardInsightCard[];
  isConfigured: boolean;
  isSignedIn: boolean;
  recentTransactions: TransactionRecord[];
  recurringCandidates: RecurringCandidate[];
  recurringExpenses: RecurringExpenseRecord[];
  reviewItems: ReviewQueueItem[];
  snapshotCount: number;
  spendingSummary: SpendingInsightSummary;
  syncSummary: SyncSummary;
  totals: AccountBalanceTotals;
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

type TrendRangeKey = "1M" | "3M" | "6M" | "1Y" | "ALL";

interface BalanceViewOption {
  description: string;
  icon: LucideIcon;
  key: BalanceTrendScope;
  label: string;
  positiveIsGood: boolean;
  tone?: "negative" | "positive";
  value: number;
}

const trendRangeOptions: { days: number | null; key: TrendRangeKey; label: string }[] = [
  { days: 31, key: "1M", label: "1M" },
  { days: 93, key: "3M", label: "3M" },
  { days: 186, key: "6M", label: "6M" },
  { days: 366, key: "1Y", label: "1Y" },
  { days: null, key: "ALL", label: "All" }
];

const reviewReasonLabels: Record<ReviewQueueItem["reason"], string> = {
  large: "Large",
  "low-confidence": "Low confidence",
  "missing-category": "Missing category",
  "new-recurring": "New recurring",
  "recurring-candidate": "Recurring candidate",
  "transfer-pair": "Transfer pair",
  "unclear-transfer": "Unclear transfer",
  venmo: "Peer-to-peer"
};

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

function spendingGroupHref(
  group: SpendingGroupSummary,
  kind: "category" | "merchant",
  summary: SpendingInsightSummary
) {
  return transactionsHref({
    category: kind === "category" ? group.id ?? undefined : undefined,
    exclude_transfers: true,
    from: summary.currentMonth.fromDate,
    q: kind === "merchant" || !group.id ? group.label : undefined,
    to: summary.currentMonth.toDate
  });
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
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

function monthProgressLabel(summary: MonthlyCashflowRunwaySummary) {
  if (!summary.isPartialMonth) return "Full month";
  return `Day ${summary.monthElapsedDays} of ${summary.monthTotalDays}`;
}

function TrendChart({
  positiveIsGood,
  snapshotCount,
  trend,
  valueLabel
}: {
  positiveIsGood: boolean;
  snapshotCount: number;
  trend: BalanceTrendPoint[];
  valueLabel: string;
}) {
  const [rangeKey, setRangeKey] = useState<TrendRangeKey>("6M");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
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

  const selectedTrend = useMemo(() => filterTrendByRange(trend, rangeKey), [rangeKey, trend]);
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
  const activePoint = selectedTrend[selectedIndex];
  const activeCoords = points[selectedIndex];
  const activeDelta = pointDelta(selectedTrend, selectedIndex);
  const activeDeltaClass = activeDelta ? deltaToneClass(activeDelta.amount, positiveIsGood) : undefined;
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
            <circle
              cx={x}
              cy={y}
              fill="transparent"
              r="11"
            />
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
      <div className={styles.trendSource}>
        {sourceLabel}
      </div>
    </div>
  );
}

function SummaryCard({
  detail,
  icon: Icon,
  label,
  tone,
  value
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  tone?: "negative" | "positive";
  value: string;
}) {
  return (
    <div className={styles.summaryCard}>
      <span className={styles.summaryLabel}>
        <Icon size={13} aria-hidden />
        {label}
      </span>
      <strong className={tone ? styles[tone] : undefined}>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}

function SpendingTrendRows({
  groups,
  kind,
  summary
}: {
  groups: SpendingGroupSummary[];
  kind: "category" | "merchant";
  summary: SpendingInsightSummary;
}) {
  if (groups.length === 0) {
    return <div className={styles.emptyMini}>No spending rows in this period.</div>;
  }

  return (
    <div className={styles.spendRows}>
      {groups.slice(0, 4).map((group) => {
        const isUp = group.deltaAmount > 0;
        const isDown = group.deltaAmount < 0;
        const deltaClass = isUp ? styles.negative : isDown ? styles.positive : undefined;
        return (
          <Link
            className={styles.spendRow}
            href={spendingGroupHref(group, kind, summary)}
            key={`${kind}-${group.id ?? group.label}`}
          >
            <div>
              <strong>{group.label}</strong>
              <span>
                {group.count} {group.count === 1 ? "transaction" : "transactions"}
                {group.openReviewCount > 0 ? ` - ${formatMoney(group.unresolvedReviewAmount)} unresolved` : ""}
              </span>
            </div>
            <div>
              <strong>{formatMoney(group.amount)}</strong>
              <span className={deltaClass}>
                {group.previousAmount > 0 ? `${formatSignedMoney(group.deltaAmount)} (${formatPercent(group.deltaPercent)})` : "New this month"}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function CategorySpendingPanel({ breakdown }: { breakdown: CategoryBreakdownSummary }) {
  const rows = breakdown.rows;
  const periodLabel = `${formatDate(breakdown.fromDate)} - ${formatDate(breakdown.toDate)}`;
  const maxAmount = rows[0]?.amount ?? 0;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>Spending by category</div>
          <h2>{formatMoney(breakdown.totalAmount)}</h2>
        </div>
        <span className={styles.compactValue}>
          <Tags size={14} aria-hidden />
          {rows.length} {rows.length === 1 ? "category" : "categories"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className={styles.emptyMini}>No spending this month yet ({periodLabel}).</div>
      ) : (
        <div className={styles.categoryBreakdownRows}>
          {rows.map((row) => {
            const widthPercent = maxAmount > 0 ? Math.max(2, (row.amount / maxAmount) * 100) : 0;
            const deltaTone = row.deltaAmount > 0 ? styles.negative : row.deltaAmount < 0 ? styles.positive : undefined;
            const deltaLabel = row.previousAmount > 0
              ? `${formatSignedMoney(row.deltaAmount)} (${formatPercent(row.deltaPercent)})`
              : "New this month";
            return (
              <Link
                className={styles.categoryBreakdownRow}
                href={transactionsHref({
                  category: row.id ?? undefined,
                  exclude_transfers: true,
                  from: breakdown.fromDate,
                  q: row.id ? undefined : row.label,
                  to: breakdown.toDate
                })}
                key={row.id ?? row.label}
              >
                <div className={styles.categoryBreakdownHead}>
                  <strong>{row.label}</strong>
                  <strong>{formatMoney(row.amount)}</strong>
                </div>
                <div className={styles.categoryBreakdownBar} aria-hidden>
                  <span style={{ width: `${widthPercent}%` }} />
                </div>
                <div className={styles.categoryBreakdownMeta}>
                  <span>
                    {row.percent.toFixed(1)}% · {row.count} {row.count === 1 ? "transaction" : "transactions"}
                    {row.openReviewCount > 0 ? ` · ${row.openReviewCount} in review` : ""}
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

function cleanupReasonLabel(reason: CategoryCleanupAction["reasons"][number]) {
  if (reason === "open-review") return "Open review";
  if (reason === "low-confidence") return "Low confidence";
  return "Uncategorized";
}

function cleanupActionMerchantSearch(item: CategoryCleanupAction) {
  if (!item.reasons.includes("uncategorized")) return undefined;
  return item.label.replace(/^Uncategorized:\s*/i, "").trim() || item.label;
}

function CategoryCleanupPanel({ summary }: { summary: SpendingInsightSummary }) {
  const confidence = summary.confidence;
  const current = summary.currentMonth;
  const hasCleanup = confidence.cleanupCandidateCount > 0;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>AI category cleanup</div>
          <h2>{confidence.categoryCoveragePercent.toFixed(1)}% trusted</h2>
        </div>
        <Link className={styles.textLink} href="/review">Run cleanup</Link>
      </div>

      <div className={styles.cleanupHero}>
        <Sparkles size={16} aria-hidden />
        <div>
          <strong>{hasCleanup ? `${confidence.cleanupCandidateCount.toLocaleString("en-US")} transactions need cleanup` : "Category coverage is clean"}</strong>
          <span>
            {hasCleanup
              ? `${formatMoney(confidence.cleanupCandidateAmount)} of this month's spending still depends on AI review, merchant rules, or manual confirmation.`
              : "This month's spending rows are categorized with enough confidence for the dashboard."}
          </span>
        </div>
      </div>

      <div className={styles.cleanupStats}>
        <div>
          <span>Open review</span>
          <strong>{confidence.openReviewCount.toLocaleString("en-US")}</strong>
        </div>
        <div>
          <span>Low confidence</span>
          <strong>{confidence.lowConfidenceCount.toLocaleString("en-US")}</strong>
        </div>
        <div>
          <span>Uncategorized</span>
          <strong>{confidence.uncategorizedCount.toLocaleString("en-US")}</strong>
        </div>
      </div>

      {confidence.topCleanupActions.length === 0 ? (
        <div className={styles.emptyMini}>No category cleanup actions for {formatDate(current.fromDate)} - {formatDate(current.toDate)}.</div>
      ) : (
        <div className={styles.cleanupRows}>
          {confidence.topCleanupActions.map((item) => (
            <Link
              className={styles.cleanupRow}
              href={transactionsHref({
                category: cleanupActionMerchantSearch(item) ? undefined : item.id ?? undefined,
                exclude_transfers: true,
                from: current.fromDate,
                q: cleanupActionMerchantSearch(item) ?? (item.id ? undefined : item.label),
                quality: "needs-cleanup",
                review: item.openReviewCount > 0 ? "open" : undefined,
                to: current.toDate
              })}
              key={`${item.id ?? "no-category"}-${item.label}`}
            >
              <div>
                <strong>{item.label}</strong>
                <span>{item.count.toLocaleString("en-US")} rows - {item.reasons.map(cleanupReasonLabel).join(", ")}</span>
              </div>
              <strong>{formatMoney(item.amount)}</strong>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function SpendingPanel({ summary }: { summary: SpendingInsightSummary }) {
  const current = summary.currentMonth;
  const unresolved = current.unresolvedReviewSpending;
  const hasUnresolved = unresolved > 0;
  const periodLabel = `${formatDate(current.fromDate)} - ${formatDate(current.toDate)}`;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>Spending</div>
          <h2>Money out by trust state</h2>
        </div>
        <Link
          className={styles.textLink}
          href={transactionsHref({
            exclude_transfers: true,
            from: current.fromDate,
            to: current.toDate
          })}
        >
          Open period
        </Link>
      </div>

      <div className={styles.trustSummary}>
        <div>
          <span>Trusted spending</span>
          <strong>{formatMoney(current.trustedSpending)}</strong>
          <em>{periodLabel}</em>
        </div>
        <Link
          className={`${styles.trustReview} ${hasUnresolved ? styles.trustReviewActive : ""}`}
          href={transactionsHref({
            exclude_transfers: true,
            from: current.fromDate,
            review: "open",
            to: current.toDate
          })}
        >
          <span>Unresolved review impact</span>
          <strong>{formatMoney(unresolved)}</strong>
          <em>{current.openReviewTransactionCount} open {current.openReviewTransactionCount === 1 ? "transaction" : "transactions"}</em>
        </Link>
      </div>

      <div className={styles.spendSections}>
        <div>
          <h3><Tags size={14} aria-hidden /> Top categories</h3>
          <SpendingTrendRows groups={current.topCategories} kind="category" summary={summary} />
        </div>
        <div>
          <h3><Store size={14} aria-hidden /> Top merchants</h3>
          <SpendingTrendRows groups={current.topMerchants} kind="merchant" summary={summary} />
        </div>
      </div>
    </section>
  );
}

function guardrailStatusLabel(status: BudgetGuardrailItem["status"]) {
  if (status === "over") return "Over";
  if (status === "near") return "Near";
  return "On track";
}

function BudgetGuardrailsPanel({ summary }: { summary: BudgetGuardrailSummary }) {
  const visibleItems = summary.items.filter((item) => item.status !== "on-track").slice(0, 4);
  const periodLabel = `${formatDate(summary.fromDate)} - ${formatDate(summary.toDate)}`;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>Guardrails</div>
          <h2>Budget pace</h2>
        </div>
        <span className={styles.compactValue}>
          <ShieldCheck size={14} aria-hidden />
          {summary.overCount > 0 ? `${summary.overCount} over` : `${summary.nearCount} near`}
        </span>
      </div>

      {visibleItems.length === 0 ? (
        <div className={styles.emptyMini}>No category guardrails are near budget pace.</div>
      ) : (
        <div className={styles.guardrailRows}>
          {visibleItems.map((item) => (
            <Link
              className={`${styles.guardrailRow} ${styles[`guardrail-${item.status}`]}`}
              href={transactionsHref({
                category: item.id ?? undefined,
                exclude_transfers: true,
                from: summary.fromDate,
                q: item.id ? undefined : item.label,
                to: summary.toDate
              })}
              key={item.id ?? item.label}
            >
              <div className={styles.guardrailTop}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{periodLabel} - {item.transactionCount} {item.transactionCount === 1 ? "transaction" : "transactions"}</span>
                </div>
                <span className={styles.guardrailBadge}>{guardrailStatusLabel(item.status)}</span>
              </div>
              <div className={styles.guardrailMeter} aria-hidden>
                <span style={{ width: `${Math.min(100, item.percentUsed)}%` }} />
              </div>
              <div className={styles.guardrailMeta}>
                <span>{formatMoney(item.currentAmount)} of {formatMoney(item.budgetAmount)}</span>
                <span>Projected {formatMoney(item.projectedAmount)} ({item.projectedPercent.toFixed(1)}%)</span>
              </div>
              {item.openReviewCount > 0 ? (
                <div className={styles.guardrailReview}>
                  {formatMoney(item.unresolvedReviewAmount)} unresolved review impact
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function AccountGroups({ groups }: { groups: AccountGroup[] }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>Accounts</div>
          <h2>Balance groups</h2>
        </div>
        <Link className={styles.textLink} href="/accounts">Open accounts</Link>
      </div>
      <div className={styles.groupGrid}>
        {groups.map((group) => (
          <div className={styles.groupCard} key={group.key}>
            <div className={styles.groupTop}>
              <span>{group.label}</span>
              <strong className={group.key === "credit" ? styles.negative : undefined}>{formatMoney(group.total, true)}</strong>
            </div>
            <p>{group.description}</p>
            <div className={styles.groupMeta}>
              <span>{group.accounts.length} accounts</span>
              {group.accounts[0] ? <span>{group.accounts[0].institutionName}</span> : <span>No rows</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentTransactions({ transactions }: { transactions: TransactionRecord[] }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>Activity</div>
          <h2>Recent transactions</h2>
        </div>
        <Link className={styles.textLink} href="/transactions">See all</Link>
      </div>
      {transactions.length === 0 ? (
        <div className={styles.emptyMini}>No persisted transactions yet.</div>
      ) : (
        <div className={styles.itemList}>
          {transactions.map((transaction) => (
            <div className={styles.transactionRow} key={transaction.id}>
              <div>
                <strong>{transaction.merchant}</strong>
                <span>{formatDate(transaction.date)} - {transaction.accountName}</span>
              </div>
              <span className={`${styles.amount} ${transactionAmountClass(transaction.amount)}`}>
                {formatSignedMoney(transaction.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewQueue({ reviewItems }: { reviewItems: ReviewQueueItem[] }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>Review</div>
          <h2>Open queue</h2>
        </div>
        <Link className={styles.textLink} href="/review">Open review</Link>
      </div>
      {reviewItems.length === 0 ? (
        <div className={styles.emptyMini}>No persisted review items are open.</div>
      ) : (
        <div className={styles.itemList}>
          {reviewItems.slice(0, 5).map((item) => (
            <div className={styles.reviewRow} key={item.id}>
              <span className={styles.reviewIcon}>
                <TriangleAlert size={13} aria-hidden />
              </span>
              <div>
                <strong>{item.transaction.merchant}</strong>
                <span>{reviewReasonLabels[item.reason]} - {formatSignedMoney(item.transaction.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CashflowRunwayPanel({ summary }: { summary: MonthlyCashflowRunwaySummary }) {
  const netTone = summary.currentMonth.netCashflow >= 0 ? "positive" : "negative";
  const syncText = syncLabel(summary.syncSummary);
  const readinessTone = summary.upcomingCashflow.netTotal >= 0 ? "positive" : "negative";

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>Cashflow</div>
          <h2>Monthly runway</h2>
        </div>
        <span className={styles.compactValue}>{monthProgressLabel(summary)}</span>
      </div>
      <div className={styles.cashflowGrid}>
        <div>
          <span>Income</span>
          <strong className={styles.positive}>{formatMoney(summary.currentMonth.income)}</strong>
        </div>
        <div>
          <span>Spending</span>
          <strong className={styles.negative}>{formatMoney(summary.currentMonth.spending)}</strong>
        </div>
        <div>
          <span>Net cashflow</span>
          <strong className={styles[netTone]}>{formatSignedMoney(summary.currentMonth.netCashflow)}</strong>
        </div>
        <div>
          <span>Confirmed recurring load</span>
          <strong>{formatMoney(summary.confirmedRecurringMonthlyLoad)}</strong>
        </div>
        <div>
          <span>Next 30 days</span>
          <strong className={styles[readinessTone]}>{formatSignedMoney(summary.upcomingCashflow.netTotal)}</strong>
        </div>
      </div>
      <div className={styles.cashflowMeta}>
        <span>
          Pending recurring signals: {summary.pendingRecurringCount.toLocaleString("en-US")}
          {summary.pendingRecurringCount > 0 ? ` (${formatMoney(summary.pendingRecurringMonthlyLoad)}/mo not confirmed)` : ""}
        </span>
        <span>
          Upcoming income {formatMoney(summary.upcomingCashflow.incomeTotal)} against bills {formatMoney(summary.upcomingCashflow.billTotal)}
        </span>
        <span>{syncText} sync - {formatRelativeTime(summary.syncSummary.latestSyncedAt)}</span>
      </div>
    </section>
  );
}

function RecurringPanel({
  recurringCandidates,
  recurringExpenses,
  summary
}: {
  recurringCandidates: RecurringCandidate[];
  recurringExpenses: RecurringExpenseRecord[];
  summary: MonthlyCashflowRunwaySummary;
}) {
  const visibleRecurring = recurringExpenses.filter((expense) => expense.status !== "dismissed");
  const priceChange = summary.priceChanges[0];
  const timeline = summary.upcomingCashflow;
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>Recurring</div>
          <h2>Cashflow calendar</h2>
        </div>
        <span className={styles.compactValue}>{formatSignedMoney(timeline.netTotal)}</span>
      </div>
      {priceChange ? (
        <div className={styles.inlineAlert}>
          <TriangleAlert size={14} aria-hidden />
          <span>{priceChange.merchant} changed from {formatMoney(priceChange.previousAmount)} to {formatMoney(priceChange.currentAmount)}</span>
        </div>
      ) : null}
      {timeline.projectedCashBalance !== null ? (
        <div className={styles.readinessStrip}>
          <span>Cash after scheduled activity</span>
          <strong className={timeline.projectedCashBalance >= 0 ? styles.positive : styles.negative}>
            {formatMoney(timeline.projectedCashBalance)}
          </strong>
        </div>
      ) : null}
      {timeline.events.length === 0 ? (
        <div className={styles.emptyMini}>No scheduled income or bills in the next 30 days.</div>
      ) : (
        <div className={styles.itemList}>
          {timeline.events.slice(0, 5).map((event) => (
            <div className={styles.transactionRow} key={event.id}>
              <div>
                <strong>{event.merchant}</strong>
                <span>
                  {event.direction === "income" ? "Income" : "Bill"} - {event.cadence} - {formatDate(event.date)}
                  {event.status === "pending" ? " - pending" : ""}
                </span>
              </div>
              <span className={`${styles.amount} ${event.direction === "income" ? styles.positive : styles.negative}`}>
                {formatSignedMoney(event.direction === "income" ? event.amount : -event.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
      {visibleRecurring.length === 0 && timeline.events.some((event) => event.direction === "income") ? (
        <div className={styles.pendingNote}>Income projections come from recurring posted transaction history.</div>
      ) : null}
      {recurringCandidates.filter((candidate) => candidate.isNew).length > 0 ? (
        <div className={styles.pendingNote}>
          {recurringCandidates.filter((candidate) => candidate.isNew).length.toLocaleString("en-US")} detected candidates are pending and excluded from confirmed load.
        </div>
      ) : null}
    </section>
  );
}

function InsightsPanel({ insights }: { insights: DashboardInsightCard[] }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>Insights</div>
          <h2>Active signals</h2>
        </div>
        <Sparkles size={16} aria-hidden />
      </div>
      {insights.length === 0 ? (
        <div className={styles.emptyMini}>No active insights yet.</div>
      ) : (
        <div className={styles.itemList}>
          {insights.map((insight) => (
            <div className={`${styles.insight} ${styles[`tone-${insight.tone}`]}`} key={insight.id}>
              <strong>{insight.title}</strong>
              <span>{insight.body}</span>
              <Link
                aria-label={`View evidence for ${insight.title}`}
                className={styles.insightLink}
                href={insight.href}
              >
                {insight.evidenceLabel}
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function DashboardView({
  accounts,
  balanceTrends,
  budgetGuardrails,
  categoryBreakdown,
  cashflowRunway,
  dataError,
  groups,
  insightCards,
  isConfigured,
  isSignedIn,
  recentTransactions,
  recurringCandidates,
  recurringExpenses,
  reviewItems,
  snapshotCount,
  spendingSummary,
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
        <>
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
              positiveIsGood={selectedBalanceView.positiveIsGood}
              snapshotCount={snapshotCount}
              trend={balanceTrends[selectedBalanceView.key]}
              valueLabel={selectedBalanceView.label}
            />
          </section>

          <section className={styles.summaryGrid} aria-label="Balance summary">
            <SummaryCard detail={`${accounts.length} linked rows`} icon={Landmark} label="Assets" value={formatMoney(totals.assets)} />
            <SummaryCard detail="Checking and savings" icon={Database} label="Cash" value={formatMoney(totals.cash)} />
            <SummaryCard detail="Credit card balances owed" icon={CreditCard} label="Liabilities" tone="negative" value={formatMoney(totals.liabilities)} />
            <SummaryCard detail="Cash after card balances" icon={WalletCards} label="Cash - liabilities" tone={cashMinusLiabilities >= 0 ? "positive" : "negative"} value={formatMoney(cashMinusLiabilities)} />
          </section>

          <section className={styles.summaryGrid} aria-label="Monthly cashflow summary">
            <SummaryCard detail={monthProgressLabel(cashflowRunway)} icon={TrendingUp} label="Income" tone="positive" value={formatMoney(cashflowRunway.currentMonth.income)} />
            <SummaryCard detail={`${cashflowRunway.currentMonth.transactionCount} month transactions`} icon={TrendingDown} label="Spending" tone="negative" value={formatMoney(cashflowRunway.currentMonth.spending)} />
            <SummaryCard detail="Income minus spending" icon={WalletCards} label="Net cashflow" tone={cashflowRunway.currentMonth.netCashflow >= 0 ? "positive" : "negative"} value={formatSignedMoney(cashflowRunway.currentMonth.netCashflow)} />
            <SummaryCard detail={`${cashflowRunway.pendingRecurringCount} pending signals excluded`} icon={Clock3} label="Confirmed recurring" value={formatMoney(cashflowRunway.confirmedRecurringMonthlyLoad)} />
          </section>

          <AccountGroups groups={groups} />
          <SpendingPanel summary={spendingSummary} />
          <CategorySpendingPanel breakdown={categoryBreakdown} />

          <div className={styles.contentGrid}>
            <CategoryCleanupPanel summary={spendingSummary} />
            <BudgetGuardrailsPanel summary={budgetGuardrails} />
            <CashflowRunwayPanel summary={cashflowRunway} />
            <RecentTransactions transactions={recentTransactions} />
            <ReviewQueue reviewItems={reviewItems} />
            <RecurringPanel
              recurringCandidates={recurringCandidates}
              recurringExpenses={recurringExpenses}
              summary={cashflowRunway}
            />
            <InsightsPanel insights={insightCards} />
          </div>
        </>
      )}
    </div>
  );
}
