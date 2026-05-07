import { SettingsView } from "@/components/finance/settings/settings-view";
import {
  listAccounts,
  listCategories,
  listMerchantRules,
  listRecurringExpenses,
  listReviewItems,
  listTransactions,
  type AccountRecord,
  type CategoryRecord,
  type RecurringExpenseRecord,
  type MerchantRuleRow,
  type ReviewQueueItem,
  type TransactionRecord
} from "@/lib/db";
import { listDemoPlaidConnections } from "@/lib/demo/finance-client";
import { getFinanceServerContext } from "@/lib/demo/server";
import { getAiProviderStatus } from "@/lib/ai/server";
import { getLatestPlaidSyncRun, listPlaidConnections, type PlaidConnectionSummary, type PlaidPersistedSyncRunSummary } from "@/lib/plaid/service";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted settings data.";
}

export default async function SettingsPage() {
  let accounts: AccountRecord[] = [];
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;
  let isDemo = false;
  let categories: CategoryRecord[] = [];
  let plaidConnections: PlaidConnectionSummary[] = [];
  let latestPlaidSyncRun: PlaidPersistedSyncRunSummary | null = null;
  let merchantRules: MerchantRuleRow[] = [];
  let recurringExpenses: RecurringExpenseRecord[] = [];
  let reviewItems: ReviewQueueItem[] = [];
  let transactions: TransactionRecord[] = [];

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isDemo = context.isDemo;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      [accounts, categories, recurringExpenses, reviewItems, transactions, plaidConnections, latestPlaidSyncRun, merchantRules] = await Promise.all([
        listAccounts(context.client, context.userId),
        listCategories(context.client, context.userId),
        listRecurringExpenses(context.client, context.userId),
        listReviewItems(context.client, context.userId, "open"),
        listTransactions(context.client, context.userId, { limit: 5000 }),
        context.isDemo
          ? Promise.resolve(listDemoPlaidConnections())
          : listPlaidConnections(context.client as unknown as Parameters<typeof listPlaidConnections>[0], context.userId),
        context.isDemo
          ? Promise.resolve(null)
          : getLatestPlaidSyncRun(context.client as unknown as Parameters<typeof getLatestPlaidSyncRun>[0], context.userId),
        listMerchantRules(context.client, context.userId)
      ]);
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  return (
    <SettingsView
      accounts={accounts}
      aiProviderStatus={getAiProviderStatus()}
      categories={categories}
      dataError={dataError}
      isConfigured={isConfigured}
      isDemo={isDemo}
      isSignedIn={isSignedIn}
      latestPlaidSyncRun={latestPlaidSyncRun}
      merchantRules={merchantRules}
      plaidConnections={plaidConnections}
      recurringExpenses={recurringExpenses}
      reviewItems={reviewItems}
      transactions={transactions}
    />
  );
}
