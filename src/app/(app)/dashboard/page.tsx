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
  summarizeSync
} from "@/lib/finance/balances";
import { buildLiabilitiesDueSummary } from "@/lib/finance/liabilities";
import { applyManualInvestmentValuations } from "@/lib/investments/manual-valuations";

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
  let isDemo = false;
  let isSignedIn = false;

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isDemo = context.isDemo;
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
        listTransactions(context.client, context.userId, { includeRawContext: false, limit: 5000 })
      ]);
      accounts = await applyManualInvestmentValuations(accounts);
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  const now = new Date();
  const asOfDate = now.toISOString().slice(0, 10);
  const plaidSyncAccounts = accounts.filter(
    (account) => account.type === "depository" || account.type === "credit" || account.type === "loan"
  );
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
  const liabilitiesDueSummary = buildLiabilitiesDueSummary({
    accounts,
    asOfDate,
    cashAvailable: totals.cash,
    transactions: trendTransactions
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
    netWorth: trend
  } satisfies Record<"cash" | "cashMinusLiabilities" | "netWorth", typeof trend>;
  const balanceTransactions = trendTransactions.map((transaction) => ({
    accountId: transaction.accountId,
    accountName: transaction.accountName,
    amount: transaction.amount,
    category: transaction.category,
    categoryId: transaction.categoryId,
    date: transaction.date,
    id: transaction.id,
    intent: transaction.intent,
    merchant: transaction.merchant,
    plaidName: transaction.plaidName,
    reimbursements: transaction.reimbursements.map((reimbursement) => ({
      receivedAmount: reimbursement.receivedAmount,
      receivedTransactionId: reimbursement.receivedTransactionId,
      status: reimbursement.status
    })),
    reviewItems: transaction.reviewItems.map((review) => ({
      reason: review.reason,
      status: review.status
    })),
    reviewStatus: transaction.reviewStatus,
    splits: transaction.splits.map((split) => ({
      amount: split.amount,
      intent: split.intent
    })),
    status: transaction.status
  }));

  return (
    <DashboardView
      accounts={accounts}
      asOfDate={asOfDate}
      balanceTransactions={balanceTransactions}
      balanceTrends={balanceTrends}
      dataError={dataError}
      isConfigured={isConfigured}
      isDemo={isDemo}
      isSignedIn={isSignedIn}
      liabilitiesDueSummary={liabilitiesDueSummary}
      snapshotCount={snapshots.length}
      syncSummary={summarizeSync(plaidSyncAccounts)}
      totals={totals}
    />
  );
}
