import type { AccountRecord, CategoryRecord, TransactionRecord } from "@/lib/db";
import { transactionSpendingAmount } from "@/lib/finance/spending";
import { buildReimbursementReportingSummary } from "@/lib/finance/reimbursements";
import type { PlaidConnectionSummary } from "@/lib/plaid/service";
import { Database, Filter, HandCoins, Hourglass, Inbox } from "lucide-react";
import type { TransactionFilterState } from "./filters";
import { MerchantCleanupPanel } from "./merchant-cleanup-panel";
import { TransactionFilters } from "./transaction-filters";
import { TransactionTable } from "./transaction-table";
import styles from "./transactions.module.css";

interface TransactionsViewProps {
  accounts: AccountRecord[];
  categories: CategoryRecord[];
  dataError?: string;
  filters: TransactionFilterState;
  isConfigured: boolean;
  isSignedIn: boolean;
  plaidConnections: PlaidConnectionSummary[];
  transactions: TransactionRecord[];
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function summarize(transactions: TransactionRecord[]) {
  const transactionSummary = transactions.reduce(
    (summary, transaction) => {
      summary.spending += transactionSpendingAmount(transaction);

      if (transaction.status === "pending") summary.pending += 1;
      if (transaction.reviewItems.some((review) => review.status === "open")) summary.needsReview += 1;

      return summary;
    },
    { spending: 0, pending: 0, needsReview: 0 }
  );

  return {
    ...transactionSummary,
    reimbursements: buildReimbursementReportingSummary(transactions)
  };
}

export function TransactionsView({
  accounts,
  categories,
  dataError,
  filters,
  isConfigured,
  isSignedIn,
  plaidConnections,
  transactions
}: TransactionsViewProps) {
  const summary = summarize(transactions);
  const selectedAccount = filters.accountId === "all"
    ? null
    : accounts.find((account) => account.id === filters.accountId) ?? null;
  const accountOnlyFilter = Boolean(
    selectedAccount &&
    !filters.search &&
    filters.categoryId === "all" &&
    filters.intent === "all" &&
    filters.reviewStatus === "all" &&
    !filters.month &&
    !filters.fromDate &&
    !filters.toDate &&
    !filters.excludeTransfers
  );
  const connectionByInstitutionId = new Map(plaidConnections.map((connection) => [connection.institutionId, connection]));
  const selectedAccountIssue = selectedAccount
    ? connectionByInstitutionId.get(selectedAccount.institutionId)?.issue ?? null
    : null;

  return (
    <div className={styles.shell}>
      <section className={styles.summaryGrid} aria-label="Transaction summary">
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>
            <Database size={13} aria-hidden />
            Rows shown
          </span>
          <strong>{transactions.length.toLocaleString("en-US")}</strong>
          <span>Persisted enriched transactions</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>
            <Filter size={13} aria-hidden />
            Spending
          </span>
          <strong>{formatMoney(summary.spending)}</strong>
          <span>Owned outflow excluding transfers and reimbursable portions</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>
            <HandCoins size={13} aria-hidden />
            Reimbursements
          </span>
          <strong>{formatMoney(summary.reimbursements.outstandingAmount)}</strong>
          <span>
            Outstanding from {formatMoney(summary.reimbursements.reimbursableAmount)} reimbursable activity
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>
            <Hourglass size={13} aria-hidden />
            Pending
          </span>
          <strong>{summary.pending.toLocaleString("en-US")}</strong>
          <span>Visually marked in the table</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>
            <Inbox size={13} aria-hidden />
            Review
          </span>
          <strong>{summary.needsReview.toLocaleString("en-US")}</strong>
          <span>Open review items in view</span>
        </div>
      </section>

      <TransactionFilters accounts={accounts} categories={categories} filters={filters} />
      <MerchantCleanupPanel categories={categories} defaultQuery={filters.search} />

      {filters.isDateRangeInverted ? (
        <div className={styles.notice} role="status">
          The selected date filters do not overlap. Adjust the month, from date, or to date to show transactions.
        </div>
      ) : null}

      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so persisted transactions cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in with Supabase Auth to load your persisted transaction data.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      <TransactionTable
        accountOnlyFilter={accountOnlyFilter}
        filtersActive={filters.hasActiveFilters}
        limit={filters.limit}
        selectedAccountIssue={selectedAccountIssue}
        selectedAccount={selectedAccount}
        transactions={transactions}
      />
    </div>
  );
}
