import { SettingsView } from "@/components/finance/settings/settings-view";
import {
  listAccounts,
  listRecurringExpenses,
  listReviewItems,
  listTransactions,
  type AccountRecord,
  type RecurringExpenseRecord,
  type ReviewQueueItem,
  type TransactionRecord
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import { getAiProviderStatus } from "@/lib/ai/server";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted settings data.";
}

export default async function SettingsPage() {
  let accounts: AccountRecord[] = [];
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;
  let recurringExpenses: RecurringExpenseRecord[] = [];
  let reviewItems: ReviewQueueItem[] = [];
  let transactions: TransactionRecord[] = [];

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      [accounts, recurringExpenses, reviewItems, transactions] = await Promise.all([
        listAccounts(context.client, context.userId),
        listRecurringExpenses(context.client, context.userId),
        listReviewItems(context.client, context.userId, "open"),
        listTransactions(context.client, context.userId, { limit: 5000 })
      ]);
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  return (
    <SettingsView
      accounts={accounts}
      aiProviderStatus={getAiProviderStatus()}
      dataError={dataError}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      recurringExpenses={recurringExpenses}
      reviewItems={reviewItems}
      transactions={transactions}
    />
  );
}
