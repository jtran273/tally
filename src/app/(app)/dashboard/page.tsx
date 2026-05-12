import { DashboardView } from "@/components/finance/dashboard/dashboard-view";
import {
  listAccounts,
  listBalanceSnapshots,
  listTransactions,
  type AccountRecord,
  type BalanceSnapshotRecord,
  type TransactionRecord
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import {
  buildBalanceTrend,
  calculateAccountTotals,
  summarizeSync,
  type BalanceTrendScope
} from "@/lib/finance/balances";
import { buildLiabilitiesDueSummary } from "@/lib/finance/liabilities";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted dashboard data.";
}

export default async function DashboardPage() {
  let accounts: AccountRecord[] = [];
  let snapshots: BalanceSnapshotRecord[] = [];
  let trendTransactions: TransactionRecord[] = [];
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
        trendTransactions
      ] = await Promise.all([
        accountIds.length > 0
          ? listBalanceSnapshots(context.client, context.userId, { accountIds, limit: 5000 })
          : Promise.resolve([]),
        listTransactions(context.client, context.userId, { limit: 5000 })
      ]);
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  const now = new Date();
  const asOfDate = now.toISOString().slice(0, 10);
  const totals = calculateAccountTotals(accounts);
  const trendOptions = {
    asOfDate,
    maxPoints: 366,
    transactions: trendTransactions
  };
  const trend = buildBalanceTrend(accounts, snapshots, {
    ...trendOptions,
    scope: "netWorth"
  });
  const balanceTrends = {
    cash: buildBalanceTrend(accounts, snapshots, {
      ...trendOptions,
      scope: "cash"
    }),
    cashMinusLiabilities: buildBalanceTrend(accounts, snapshots, {
      ...trendOptions,
      scope: "cashMinusLiabilities"
    }),
    liabilities: buildBalanceTrend(accounts, snapshots, {
      ...trendOptions,
      scope: "liabilities"
    }),
    netWorth: trend
  } satisfies Record<BalanceTrendScope, typeof trend>;
  const liabilitiesDue = buildLiabilitiesDueSummary({
    accounts,
    asOfDate,
    cashAvailable: totals.cash,
    transactions: trendTransactions
  });
  const balanceTransactions = trendTransactions.map((transaction) => ({
    accountId: transaction.accountId,
    accountName: transaction.accountName,
    amount: transaction.amount,
    category: transaction.category,
    date: transaction.date,
    id: transaction.id,
    intent: transaction.intent,
    merchant: transaction.merchant,
    status: transaction.status
  }));

  return (
    <DashboardView
      accounts={accounts}
      balanceTransactions={balanceTransactions}
      balanceTrends={balanceTrends}
      dataError={dataError}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      liabilitiesDue={liabilitiesDue}
      snapshotCount={snapshots.length}
      syncSummary={summarizeSync(accounts)}
      totals={totals}
    />
  );
}
