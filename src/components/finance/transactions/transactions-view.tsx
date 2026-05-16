import type { AccountRecord, CategoryRecord, TransactionRecord } from "@/lib/db";
import { transactionSpendingAmount } from "@/lib/finance/spending";
import { buildReimbursementReportingSummary } from "@/lib/finance/reimbursements";
import type { PlaidConnectionSummary } from "@/lib/plaid/service";
import { Database, Inbox, WalletCards } from "lucide-react";
import { transactionPeriodTitle, type TransactionFilterState } from "./filters";
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
  const periodTitle = transactionPeriodTitle(filters);
  const pendingDetail = summary.pending > 0
    ? `${summary.pending.toLocaleString("en-US")} pending`
    : "Transactions shown";
  const reimbursementDetail = summary.reimbursements.outstandingAmount > 0
    ? `${formatMoney(summary.reimbursements.outstandingAmount)} reimbursement outstanding`
    : "Owned outflow";

  return (
    <div className={styles.shell}>
      <section className={styles.headerPanel} aria-label="Transaction summary">
        <div className={styles.headerCopy}>
          <span>Transaction period</span>
          <h2>{periodTitle}</h2>
          <p>
            {filters.hasActiveFilters
              ? `Filtered view, latest ${filters.limit.toLocaleString("en-US")} rows.`
              : `Latest ${filters.limit.toLocaleString("en-US")} enriched transactions.`}
          </p>
        </div>

        <div className={styles.summaryMetrics}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>
              <WalletCards size={13} aria-hidden />
              Spending
            </span>
            <strong>{formatMoney(summary.spending)}</strong>
            <span>{reimbursementDetail}</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>
              <Database size={13} aria-hidden />
              Rows
            </span>
            <strong>{transactions.length.toLocaleString("en-US")}</strong>
            <span>{pendingDetail}</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>
              <Inbox size={13} aria-hidden />
              Review
            </span>
            <strong>{summary.needsReview.toLocaleString("en-US")}</strong>
            <span>{summary.needsReview > 0 ? "Open review items" : "Ready for export"}</span>
          </div>
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
