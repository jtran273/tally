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
  summarizeSync,
  type BalanceTrendScope
} from "@/lib/finance/balances";
import { buildBudgetGuardrailSummary } from "@/lib/finance/budget-guardrails";
import { buildMonthlyCashflowRunwaySummary } from "@/lib/finance/cashflow";
import { buildCategoryBreakdown, buildSpendingInsightSummary } from "@/lib/finance/spending";
import { buildDashboardInsightCards } from "@/lib/insights";
import { detectRecurringCandidates, normalizeRecurringMerchant, type RecurringCandidate } from "@/lib/recurring";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted dashboard data.";
}

function recurringKey(merchant: string, cadence: string) {
  return `${normalizeRecurringMerchant(merchant)}:${cadence}`;
}

export default async function DashboardPage() {
  let accounts: AccountRecord[] = [];
  let snapshots: BalanceSnapshotRecord[] = [];
  let recentTransactions: TransactionRecord[] = [];
  let trendTransactions: TransactionRecord[] = [];
  let reviewItems: ReviewQueueItem[] = [];
  let recurringExpenses: RecurringExpenseRecord[] = [];
  let allRecurringExpenses: RecurringExpenseRecord[] = [];
  let recurringCandidates: RecurringCandidate[] = [];
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
        allRecurringExpenses,
        insights
      ] = await Promise.all([
        accountIds.length > 0
          ? listBalanceSnapshots(context.client, context.userId, { accountIds, limit: 5000 })
          : Promise.resolve([]),
        listTransactions(context.client, context.userId, { limit: 5000 }),
        listReviewItems(context.client, context.userId, "open"),
        listRecurringExpenses(context.client, context.userId, ["active", "pending", "paused", "dismissed"]),
        listInsights(context.client, context.userId)
      ]);
      recentTransactions = trendTransactions.slice(0, 8);
      recurringExpenses = allRecurringExpenses.filter((expense) => expense.status !== "dismissed");
      const dismissedRecurringKeys = new Set(
        allRecurringExpenses
          .filter((expense) => expense.status === "dismissed")
          .map((expense) => recurringKey(expense.merchant, expense.cadence))
      );
      recurringCandidates = detectRecurringCandidates(trendTransactions, {
        asOfDate: new Date().toISOString().slice(0, 10),
        existingRecurring: allRecurringExpenses
      }).filter((candidate) => !dismissedRecurringKeys.has(recurringKey(candidate.merchant, candidate.cadence)));
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  const now = new Date();
  const asOfDate = now.toISOString().slice(0, 10);
  const totals = calculateAccountTotals(accounts);
  const groups = groupAccounts(accounts);
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
  const spendingSummary = buildSpendingInsightSummary(trendTransactions, { asOfDate });
  const categoryBreakdown = buildCategoryBreakdown(trendTransactions, { asOfDate });
  const budgetGuardrails = buildBudgetGuardrailSummary(trendTransactions, { asOfDate });
  const cashflowRunway = buildMonthlyCashflowRunwaySummary({
    accounts,
    asOfDate,
    now,
    recurringCandidates,
    recurringExpenses,
    transactions: trendTransactions
  });
  const insightCards = buildDashboardInsightCards({
    accounts,
    persistedInsights: insights,
    recentTransactions,
    recurringCandidates,
    recurringExpenses,
    reviewItems,
    spendingTransactions: trendTransactions,
    trend,
    now
  });

  return (
    <DashboardView
      accounts={accounts}
      balanceTrends={balanceTrends}
      budgetGuardrails={budgetGuardrails}
      categoryBreakdown={categoryBreakdown}
      cashflowRunway={cashflowRunway}
      dataError={dataError}
      groups={groups}
      insightCards={insightCards}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      recentTransactions={recentTransactions}
      recurringCandidates={recurringCandidates}
      recurringExpenses={recurringExpenses}
      reviewItems={reviewItems}
      snapshotCount={snapshots.length}
      spendingSummary={spendingSummary}
      syncSummary={summarizeSync(accounts)}
      totals={totals}
    />
  );
}
