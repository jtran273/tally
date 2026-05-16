import type { AccountRecord, CategoryRecord, TransactionRecord } from "@/lib/db";
import { transactionSpendingAmount } from "@/lib/finance/spending";
import { buildReimbursementReportingSummary } from "@/lib/finance/reimbursements";
import { MetricCard, MetricGrid, Notice } from "@/components/ui/primitives";
import type { PlaidConnectionSummary } from "@/lib/plaid/service";
import { isRecurringReview } from "@/lib/review/reasons";
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
  isDemo: boolean;
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
      if (transaction.reviewItems.some((review) => review.status === "open" && !isRecurringReview(review.reason))) {
        summary.needsReview += 1;
      }

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
  isDemo,
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
    filters.direction === "all" &&
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

        <MetricGrid className={styles.summaryMetrics}>
          <MetricCard
            detail={reimbursementDetail}
            label={(
              <>
              <WalletCards size={13} aria-hidden />
              Spending
              </>
            )}
            value={formatMoney(summary.spending)}
          />
          <MetricCard
            detail={pendingDetail}
            label={(
              <>
              <Database size={13} aria-hidden />
              Rows
              </>
            )}
            value={transactions.length.toLocaleString("en-US")}
          />
          <MetricCard
            detail={summary.needsReview > 0 ? "Open review items" : "Ready for export"}
            label={(
              <>
              <Inbox size={13} aria-hidden />
              Review
              </>
            )}
            value={summary.needsReview.toLocaleString("en-US")}
          />
        </MetricGrid>
      </section>

      <TransactionFilters accounts={accounts} categories={categories} filters={filters} />
      <MerchantCleanupPanel categories={categories} defaultQuery={filters.search} isDemo={isDemo} />

      {filters.isDateRangeInverted ? (
        <Notice role="status" tone="warning">
          The selected date filters do not overlap. Adjust the month, from date, or to date to show transactions.
        </Notice>
      ) : null}

      {!isConfigured ? (
        <Notice role="status">
          Supabase is not configured for this environment, so persisted transactions cannot be loaded.
        </Notice>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <Notice role="status">
          Sign in with Supabase Auth to load your persisted transaction data.
        </Notice>
      ) : null}

      {dataError ? (
        <Notice role="alert" tone="error">
          {dataError}
        </Notice>
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
