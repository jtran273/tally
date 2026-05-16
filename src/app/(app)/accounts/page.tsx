import { AccountsView } from "@/components/finance/accounts/accounts-view";
import {
  listAccounts,
  listBalanceSnapshots,
  listTransactions,
  type AccountRecord,
  type BalanceSnapshotRecord,
  type TransactionRecord
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import { applyManualInvestmentValuations } from "@/lib/investments/manual-valuations";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted accounts.";
}

export default async function AccountsPage() {
  let accounts: AccountRecord[] = [];
  let recentTransactionsByAccount: Record<string, TransactionRecord[]> = {};
  let snapshots: BalanceSnapshotRecord[] = [];
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
      const client = context.client;
      const userId = context.userId;
      accounts = await listAccounts(client, userId);
      const accountIds = accounts.map((account) => account.id);
      if (accountIds.length > 0) {
        const [loadedSnapshots, recentTransactionEntries] = await Promise.all([
          listBalanceSnapshots(client, userId, { accountIds, limit: 500 }),
          Promise.all(accounts.map(async (account) => [
            account.id,
            await listTransactions(client, userId, {
              accountIds: [account.id],
              includeRawContext: false,
              limit: 3
            })
          ] as const))
        ]);
        snapshots = loadedSnapshots;
        recentTransactionsByAccount = Object.fromEntries(recentTransactionEntries);
      }
      accounts = await applyManualInvestmentValuations(accounts);
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  return (
    <AccountsView
      accounts={accounts}
      dataError={dataError}
      isConfigured={isConfigured}
      isDemo={isDemo}
      isSignedIn={isSignedIn}
      recentTransactionsByAccount={recentTransactionsByAccount}
      snapshots={snapshots}
    />
  );
}
