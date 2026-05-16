import { TransactionEditForm } from "@/components/finance/transactions/transaction-edit-form";
import styles from "@/components/finance/transactions/transactions.module.css";
import {
  getTransactionById,
  listCategories,
  type CategoryRecord,
  type TransactionRecord
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface TransactionEditPageProps {
  params: Promise<{
    transactionId: string;
  }>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load transaction.";
}

export default async function TransactionEditPage({ params }: TransactionEditPageProps) {
  const { transactionId } = await params;
  let categories: CategoryRecord[] = [];
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;
  let transaction: TransactionRecord | null = null;
  let isDemo = false;

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isDemo = context.isDemo;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      [transaction, categories] = await Promise.all([
        getTransactionById(context.client, context.userId, transactionId),
        listCategories(context.client, context.userId)
      ]);
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  if (isConfigured && isSignedIn && !dataError && !transaction) {
    notFound();
  }

  if (!isConfigured) {
    return (
      <div className={styles.notice} role="status">
        Supabase is not configured for this environment, so transactions cannot be edited.
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className={styles.notice} role="status">
        Sign in with Supabase Auth to edit persisted transaction data.
      </div>
    );
  }

  if (dataError || !transaction) {
    return (
      <div className={styles.errorNotice} role="alert">
        {dataError ?? "Unable to load transaction."}
      </div>
    );
  }

  return <TransactionEditForm categories={categories} isDemo={isDemo} transaction={transaction} />;
}
