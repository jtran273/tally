import { RecurringView } from "@/components/finance/recurring/recurring-view";
import {
  listRecurringExpenses,
  listTransactions,
  type RecurringExpenseRecord,
  type TransactionRecord
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import { detectRecurringCandidates, normalizeRecurringMerchant, type RecurringCandidate } from "@/lib/recurring";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted recurring data.";
}

function recurringKey(merchant: string, cadence: string) {
  return `${normalizeRecurringMerchant(merchant)}:${cadence}`;
}

export default async function RecurringPage() {
  let candidates: RecurringCandidate[] = [];
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;
  let allRecurringExpenses: RecurringExpenseRecord[] = [];
  let recurringExpenses: RecurringExpenseRecord[] = [];
  let transactions: TransactionRecord[] = [];

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      [allRecurringExpenses, transactions] = await Promise.all([
        listRecurringExpenses(context.client, context.userId, ["active", "pending", "paused", "dismissed"]),
        listTransactions(context.client, context.userId, { limit: 5000 })
      ]);
      recurringExpenses = allRecurringExpenses.filter((expense) => expense.status !== "dismissed");
      const dismissedRecurringKeys = new Set(
        allRecurringExpenses
          .filter((expense) => expense.status === "dismissed")
          .map((expense) => recurringKey(expense.merchant, expense.cadence))
      );
      candidates = detectRecurringCandidates(transactions, {
        asOfDate: new Date().toISOString().slice(0, 10),
        existingRecurring: allRecurringExpenses
      }).filter((candidate) => !dismissedRecurringKeys.has(recurringKey(candidate.merchant, candidate.cadence)));
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  return (
    <RecurringView
      candidates={candidates}
      dataError={dataError}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      recurringExpenses={recurringExpenses}
      transactions={transactions}
    />
  );
}
