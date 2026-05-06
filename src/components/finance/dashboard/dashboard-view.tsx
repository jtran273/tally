import type {
  AccountRecord,
  RecurringExpenseRecord,
  ReviewQueueItem,
  TransactionRecord
} from "@/lib/db";
import type { AccountGroup, AccountBalanceTotals, BalanceTrendPoint, SyncSummary } from "@/lib/finance/balances";
import type { DashboardInsightCard } from "@/lib/insights";
import {
  Clock3,
  CreditCard,
  Database,
  Inbox,
  Landmark,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import styles from "./dashboard.module.css";

interface DashboardViewProps {
  accounts: AccountRecord[];
  dataError?: string;
  groups: AccountGroup[];
  insightCards: DashboardInsightCard[];
  isConfigured: boolean;
  isSignedIn: boolean;
  recentTransactions: TransactionRecord[];
  recurringExpenses: RecurringExpenseRecord[];
  reviewItems: ReviewQueueItem[];
  snapshotCount: number;
  syncSummary: SyncSummary;
  totals: AccountBalanceTotals;
  trend: BalanceTrendPoint[];
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

function TrendSpark({ trend }: { trend: BalanceTrendPoint[] }) {
  if (trend.length === 0) {
    return (
      <div className={styles.emptyTrend}>
        <Database size={18} aria-hidden />
        No balances yet
      </div>
    );
  }

  const values = trend.map((point) => point.netWorth);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const width = 640;
  const height = 132;
  const points = trend.map((point, index) => {
    const x = trend.length === 1 ? width / 2 : (index / (trend.length - 1)) * width;
    const y = height - ((point.netWorth - min) / range) * height;
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;

  return (
    <div className={styles.trend}>
      <svg aria-label="Net worth balance trend" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="dashboardTrendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#dashboardTrendFill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeLinecap="round" strokeWidth="2" />
        {points.map(([x, y], index) => (
          <circle cx={x} cy={y} fill="var(--surface)" key={`${trend[index].date}-${index}`} r="3.5" stroke="var(--accent)" strokeWidth="1.5" />
        ))}
      </svg>
      <div className={styles.trendAxis}>
        <span>{formatDate(trend[0].date)}</span>
        <span>{trend.length > 1 ? formatDate(trend[trend.length - 1].date) : "Current"}</span>
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

function RecurringPanel({ recurringExpenses }: { recurringExpenses: RecurringExpenseRecord[] }) {
  const monthlyTotal = recurringExpenses
    .filter((expense) => expense.status === "active" || expense.status === "pending")
    .reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.eyebrow}>Recurring</div>
          <h2>Upcoming fixed costs</h2>
        </div>
        <span className={styles.compactValue}>{formatMoney(monthlyTotal)}</span>
      </div>
      {recurringExpenses.length === 0 ? (
        <div className={styles.emptyMini}>No persisted recurring expenses yet.</div>
      ) : (
        <div className={styles.itemList}>
          {recurringExpenses.slice(0, 4).map((expense) => (
            <div className={styles.transactionRow} key={expense.id}>
              <div>
                <strong>{expense.merchant}</strong>
                <span>{expense.cadence} - due {formatDate(expense.nextDueDate)}</span>
              </div>
              <span className={styles.amount}>{formatMoney(expense.amount)}</span>
            </div>
          ))}
        </div>
      )}
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
  dataError,
  groups,
  insightCards,
  isConfigured,
  isSignedIn,
  recentTransactions,
  recurringExpenses,
  reviewItems,
  snapshotCount,
  syncSummary,
  totals,
  trend
}: DashboardViewProps) {
  const delta = latestTrendDelta(trend);
  const DeltaIcon = !delta || delta.amount >= 0 ? TrendingUp : TrendingDown;
  const hasSnapshotTrend = trend.some((point) => point.source === "snapshot");

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
            <span>Connect Plaid or load seed data to populate account balances and net worth.</span>
          </div>
        </div>
      ) : (
        <>
          <section className={styles.hero}>
            <div className={styles.heroTop}>
              <div>
                <span className={styles.eyebrow}>Net worth</span>
                <h2>{formatMoney(totals.netWorth)}</h2>
              </div>
              <div className={`${styles.syncPill} ${styles[`sync-${syncSummary.status}`]}`}>
                <Clock3 size={13} aria-hidden />
                <span>{syncLabel(syncSummary)}</span>
                <span>{formatRelativeTime(syncSummary.latestSyncedAt)}</span>
              </div>
            </div>
            <div className={styles.heroDelta}>
              <DeltaIcon size={14} aria-hidden />
              {delta ? (
                <span>
                  {formatSignedMoney(delta.amount)} ({delta.percent >= 0 ? "+" : ""}{delta.percent.toFixed(1)}%) across {hasSnapshotTrend ? `${snapshotCount} balance snapshots` : "current balances"}
                </span>
              ) : (
                <span>{hasSnapshotTrend ? `${snapshotCount} balance snapshots loaded` : "Current balances only"}</span>
              )}
            </div>
            <TrendSpark trend={trend} />
            <div className={styles.trendSource}>
              {hasSnapshotTrend ? "Snapshot balance trend" : "Snapshot trend unavailable; using current persisted balances"}
            </div>
          </section>

          <section className={styles.summaryGrid} aria-label="Balance summary">
            <SummaryCard detail={`${accounts.length} linked rows`} icon={Landmark} label="Assets" value={formatMoney(totals.assets)} />
            <SummaryCard detail="Checking and savings" icon={Database} label="Cash" value={formatMoney(totals.cash)} />
            <SummaryCard detail="Cards reduce net worth" icon={CreditCard} label="Liabilities" tone="negative" value={formatMoney(totals.credit)} />
            <SummaryCard detail={`${reviewItems.length} open review items`} icon={Inbox} label="Review" value={reviewItems.length.toLocaleString("en-US")} />
          </section>

          <AccountGroups groups={groups} />

          <div className={styles.contentGrid}>
            <RecentTransactions transactions={recentTransactions} />
            <ReviewQueue reviewItems={reviewItems} />
            <RecurringPanel recurringExpenses={recurringExpenses} />
            <InsightsPanel insights={insightCards} />
          </div>
        </>
      )}
    </div>
  );
}
