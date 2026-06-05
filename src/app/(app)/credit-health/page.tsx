import { CreditHealthView } from "@/components/finance/credit-health/credit-health-view";
import {
  listAccounts,
  listCreditScoreSnapshots,
  listTransactions,
  type AccountRecord,
  type CreditScoreSnapshotRecord,
  type TransactionRecord
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import { calculateAccountTotals } from "@/lib/finance/balances";
import {
  assessRewardsBenefitsCapability,
  buildCreditHealthSummary
} from "@/lib/finance/credit-health";
import { buildLiabilitiesDueSummary } from "@/lib/finance/liabilities";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load credit health data.";
}

export default async function CreditHealthPage() {
  let accounts: AccountRecord[] = [];
  let transactions: TransactionRecord[] = [];
  let scoreSnapshots: CreditScoreSnapshotRecord[] = [];
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
      [accounts, transactions, scoreSnapshots] = await Promise.all([
        listAccounts(context.client, context.userId),
        listTransactions(context.client, context.userId, { includeRawContext: false, limit: 5000 }),
        listCreditScoreSnapshots(context.client, context.userId, { limit: 24 })
      ]);
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  const asOfDate = new Date().toISOString().slice(0, 10);
  const totals = calculateAccountTotals(accounts);
  const liabilities = buildLiabilitiesDueSummary({
    accounts,
    asOfDate,
    cashAvailable: totals.cash,
    transactions
  });
  const summary = buildCreditHealthSummary({
    liabilities,
    scoreSnapshots
  });

  return (
    <CreditHealthView
      asOfDate={asOfDate}
      capability={assessRewardsBenefitsCapability(accounts)}
      dataError={dataError}
      isConfigured={isConfigured}
      isDemo={isDemo}
      isSignedIn={isSignedIn}
      liabilities={liabilities}
      scoreSnapshots={scoreSnapshots}
      summary={summary}
    />
  );
}
