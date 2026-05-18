import {
  ReimbursementLinkPanel,
  type ReimbursementLinkOption
} from "@/components/finance/transactions/reimbursement-link-panel";
import { TransactionEditForm } from "@/components/finance/transactions/transaction-edit-form";
import styles from "@/components/finance/transactions/transactions.module.css";
import {
  getTransactionById,
  listCategories,
  listTransactions,
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

function reimbursementOutstanding(reimbursement: TransactionRecord["reimbursements"][number]) {
  return Math.round(Math.max(0, reimbursement.expectedAmount - reimbursement.receivedAmount) * 100) / 100;
}

function reimbursementLinkOptions(transactions: TransactionRecord[], currentTransaction: TransactionRecord) {
  const options: ReimbursementLinkOption[] = [];
  const linkedReceivedReimbursements: ReimbursementLinkOption[] = [];

  for (const sourceTransaction of transactions) {
    for (const reimbursement of sourceTransaction.reimbursements) {
      const option = {
        reimbursement,
        sourceTransaction: {
          amount: sourceTransaction.amount,
          date: sourceTransaction.date,
          id: sourceTransaction.id,
          merchant: sourceTransaction.merchant
        }
      } satisfies ReimbursementLinkOption;

      if (reimbursement.receivedTransactionId === currentTransaction.id) {
        linkedReceivedReimbursements.push(option);
        continue;
      }

      if (
        currentTransaction.amount > 0 &&
        !reimbursement.receivedTransactionId &&
        reimbursement.status !== "written-off" &&
        reimbursementOutstanding(reimbursement) > 0
      ) {
        options.push(option);
      }
    }
  }

  return {
    linkedReceivedReimbursements,
    linkOptions: options
      .sort((left, right) => reimbursementOutstanding(right.reimbursement) - reimbursementOutstanding(left.reimbursement))
      .slice(0, 8)
  };
}

export default async function TransactionEditPage({ params }: TransactionEditPageProps) {
  const { transactionId } = await params;
  let categories: CategoryRecord[] = [];
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;
  let transaction: TransactionRecord | null = null;
  let reimbursementOptions: ReimbursementLinkOption[] = [];
  let linkedReceivedReimbursements: ReimbursementLinkOption[] = [];
  let isDemo = false;

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isDemo = context.isDemo;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      const [loadedTransaction, loadedCategories, recentTransactions] = await Promise.all([
        getTransactionById(context.client, context.userId, transactionId),
        listCategories(context.client, context.userId),
        listTransactions(context.client, context.userId, { includeRawContext: false, limit: 500 })
      ]);
      transaction = loadedTransaction;
      categories = loadedCategories;
      if (transaction) {
        const links = reimbursementLinkOptions(recentTransactions, transaction);
        reimbursementOptions = links.linkOptions;
        linkedReceivedReimbursements = links.linkedReceivedReimbursements;
      }
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

  return (
    <>
      <TransactionEditForm categories={categories} isDemo={isDemo} transaction={transaction} />
      <ReimbursementLinkPanel
        isDemo={isDemo}
        linkedReceivedReimbursements={linkedReceivedReimbursements}
        linkOptions={reimbursementOptions}
        transaction={transaction}
      />
    </>
  );
}
