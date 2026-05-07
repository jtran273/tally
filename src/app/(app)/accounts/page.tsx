import { AccountsView } from "@/components/finance/accounts/accounts-view";
import {
  listAccounts,
  listBalanceSnapshots,
  type AccountRecord,
  type BalanceSnapshotRecord
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import { calculateAccountTotals, groupAccounts, summarizeSync } from "@/lib/finance/balances";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted accounts.";
}

export default async function AccountsPage() {
  let accounts: AccountRecord[] = [];
  let snapshots: BalanceSnapshotRecord[] = [];
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
      snapshots = accountIds.length > 0
        ? await listBalanceSnapshots(context.client, context.userId, { accountIds, limit: 500 })
        : [];
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  return (
    <AccountsView
      accounts={accounts}
      dataError={dataError}
      groups={groupAccounts(accounts)}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      snapshots={snapshots}
      syncSummary={summarizeSync(accounts)}
      totals={calculateAccountTotals(accounts)}
    />
  );
}
