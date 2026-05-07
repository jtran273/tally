import {
  normalizeTransactionFilters,
  parseTransactionFilters,
  toTransactionListFilters,
  type TransactionSearchParams
} from "@/components/finance/transactions/filters";
import { TransactionsView } from "@/components/finance/transactions/transactions-view";
import {
  listAccounts,
  listCategories,
  listTransactions,
  type AccountRecord,
  type CategoryRecord,
  type TransactionRecord
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";

export const dynamic = "force-dynamic";

interface TransactionsPageProps {
  searchParams?: Promise<TransactionSearchParams>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted transactions.";
}

export default async function TransactionsPage({ searchParams }: TransactionsPageProps) {
  const params = searchParams ? await searchParams : {};
  let filters = parseTransactionFilters(params);
  let accounts: AccountRecord[] = [];
  let categories: CategoryRecord[] = [];
  let transactions: TransactionRecord[] = [];
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      [accounts, categories] = await Promise.all([
        listAccounts(context.client, context.userId),
        listCategories(context.client, context.userId)
      ]);
      filters = normalizeTransactionFilters(filters, accounts, categories);
      transactions = await listTransactions(context.client, context.userId, toTransactionListFilters(filters));
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  return (
    <TransactionsView
      accounts={accounts}
      categories={categories}
      dataError={dataError}
      filters={filters}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      transactions={transactions}
    />
  );
}
