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
import { listDemoPlaidConnections } from "@/lib/demo/finance-client";
import { getFinanceServerContext } from "@/lib/demo/server";
import { listPlaidConnections, type PlaidConnectionSummary } from "@/lib/plaid/service";

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
  let plaidConnections: PlaidConnectionSummary[] = [];
  let transactions: TransactionRecord[] = [];
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
      [accounts, categories, plaidConnections] = await Promise.all([
        listAccounts(context.client, context.userId),
        listCategories(context.client, context.userId),
        context.isDemo
          ? Promise.resolve(listDemoPlaidConnections())
          : listPlaidConnections(context.client as unknown as Parameters<typeof listPlaidConnections>[0], context.userId)
      ]);
      filters = normalizeTransactionFilters(filters, accounts, categories);
      transactions = await listTransactions(context.client, context.userId, {
        ...toTransactionListFilters(filters),
        includeRawContext: false
      });
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
      isDemo={isDemo}
      isSignedIn={isSignedIn}
      plaidConnections={plaidConnections}
      transactions={transactions}
    />
  );
}
