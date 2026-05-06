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
  type FinanceSupabaseClient,
  type InsightRecord,
  type RecurringExpenseRecord,
  type ReviewQueueItem,
  type TransactionRecord
} from "@/lib/db";
import {
  buildBalanceTrend,
  calculateAccountTotals,
  groupAccounts,
  summarizeSync
} from "@/lib/finance/balances";
import { buildDashboardInsightCards } from "@/lib/insights";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted dashboard data.";
}

export default async function DashboardPage() {
  let accounts: AccountRecord[] = [];
  let snapshots: BalanceSnapshotRecord[] = [];
  let recentTransactions: TransactionRecord[] = [];
  let reviewItems: ReviewQueueItem[] = [];
  let recurringExpenses: RecurringExpenseRecord[] = [];
  let insights: InsightRecord[] = [];
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;

  const supabase = await createSupabaseServerClient();
  isConfigured = Boolean(supabase);

  if (supabase) {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    if (error) {
      dataError = `Unable to verify Supabase session: ${error.message}`;
    }

    if (user) {
      isSignedIn = true;
      const financeClient = supabase as unknown as FinanceSupabaseClient;

      try {
        accounts = await listAccounts(financeClient, user.id);
        const accountIds = accounts.map((account) => account.id);

        [
          snapshots,
          recentTransactions,
          reviewItems,
          recurringExpenses,
          insights
        ] = await Promise.all([
          accountIds.length > 0
            ? listBalanceSnapshots(financeClient, user.id, { accountIds, limit: 500 })
            : Promise.resolve([]),
          listTransactions(financeClient, user.id, { limit: 8 }),
          listReviewItems(financeClient, user.id, "open"),
          listRecurringExpenses(financeClient, user.id),
          listInsights(financeClient, user.id)
        ]);
      } catch (loadError) {
        dataError = errorMessage(loadError);
      }
    }
  }

  const now = new Date();
  const totals = calculateAccountTotals(accounts);
  const groups = groupAccounts(accounts);
  const trend = buildBalanceTrend(accounts, snapshots, {
    asOfDate: now.toISOString().slice(0, 10),
    maxPoints: 24
  });
  const insightCards = buildDashboardInsightCards({
    accounts,
    persistedInsights: insights,
    recentTransactions,
    recurringExpenses,
    reviewItems,
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
