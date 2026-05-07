import { DashboardView } from "@/components/finance/dashboard/dashboard-view";
import {
  listAccounts,
  listBalanceSnapshots,
  listInsights,
  listRecurringExpenses,
  listReviewItems,
  listTransactions,
  type AccountRecord,
  type BalanceSnapshotRecord,
  type InsightRecord,
  type RecurringExpenseRecord,
  type ReviewQueueItem,
  type TransactionRecord
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import {
  buildBalanceTrend,
  calculateAccountTotals,
  groupAccounts,
  summarizeSync
} from "@/lib/finance/balances";
import { buildDashboardInsightCards } from "@/lib/insights";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted dashboard data.";
}

export default async function DashboardPage() {
  let accounts: AccountRecord[] = [];
  let snapshots: BalanceSnapshotRecord[] = [];
  let recentTransactions: TransactionRecord[] = [];
  let trendTransactions: TransactionRecord[] = [];
  let reviewItems: ReviewQueueItem[] = [];
  let recurringExpenses: RecurringExpenseRecord[] = [];
  let insights: InsightRecord[] = [];
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      accounts = await listAccounts(context.client, context.userId);
      const accountIds = accounts.map((account) => account.id);

      [
        snapshots,
        trendTransactions,
        reviewItems,
        recurringExpenses,
        insights
      ] = await Promise.all([
        accountIds.length > 0
          ? listBalanceSnapshots(context.client, context.userId, { accountIds, limit: 5000 })
          : Promise.resolve([]),
        listTransactions(context.client, context.userId, { limit: 5000 }),
        listReviewItems(context.client, context.userId, "open"),
        listRecurringExpenses(context.client, context.userId),
        listInsights(context.client, context.userId)
      ]);
      recentTransactions = trendTransactions.slice(0, 8);
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  const now = new Date();
  const totals = calculateAccountTotals(accounts);
  const groups = groupAccounts(accounts);
  const trend = buildBalanceTrend(accounts, snapshots, {
    asOfDate: now.toISOString().slice(0, 10),
    maxPoints: 366,
    transactions: trendTransactions
  });
  const insightCards = buildDashboardInsightCards({
    accounts,
    persistedInsights: insights,
    recentTransactions,
    recurringExpenses,
    reviewItems,
    spendingTransactions: trendTransactions,
    trend,
    now
  });

  return (
    <DashboardView
      accounts={accounts}
      dataError={dataError}
      groups={groups}
      insightCards={insightCards}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      recentTransactions={recentTransactions}
      recurringExpenses={recurringExpenses}
      reviewItems={reviewItems}
      snapshotCount={snapshots.length}
      syncSummary={summarizeSync(accounts)}
      totals={totals}
      trend={trend}
    />
  );
}
