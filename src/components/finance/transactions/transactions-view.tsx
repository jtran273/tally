import type { AccountRecord, CategoryRecord, TransactionRecord } from "@/lib/db";
import { transactionSpendingAmount } from "@/lib/finance/spending";
import { buildReimbursementReportingSummary } from "@/lib/finance/reimbursements";
import { Database, Filter, HandCoins, Hourglass, Inbox, type LucideIcon } from "lucide-react";
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

function SummaryCard({
  detail,
  icon: Icon,
  label,
  value
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className={styles.summaryCard} tabIndex={0}>
      <span className={styles.summaryLabel}>
        <Icon size={13} aria-hidden />
        {label}
      </span>
      <strong>{value}</strong>
      <span className={styles.summaryDetail}>{detail}</span>
    </div>
  );
}

export function TransactionsView({
  accounts,
  categories,
  dataError,
  filters,
  isConfigured,
  isSignedIn,
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

  return (
    <div className={styles.shell}>
      <section className={styles.summaryGrid} aria-label="Transaction summary">
        <SummaryCard
          detail="Persisted enriched transactions"
          icon={Database}
          label="Rows shown"
          value={transactions.length.toLocaleString("en-US")}
        />
        <SummaryCard
          detail="Owned outflow excluding transfers and reimbursable portions"
          icon={Filter}
          label="Spending"
          value={formatMoney(summary.spending)}
        />
        <SummaryCard
          detail={`Outstanding from ${formatMoney(summary.reimbursements.reimbursableAmount)} reimbursable activity`}
          icon={HandCoins}
          label="Reimbursements"
          value={formatMoney(summary.reimbursements.outstandingAmount)}
        />
        <SummaryCard
          detail="Visually marked in the table"
          icon={Hourglass}
          label="Pending"
          value={summary.pending.toLocaleString("en-US")}
        />
        <SummaryCard
          detail="Open review items in view"
          icon={Inbox}
          label="Review"
          value={summary.needsReview.toLocaleString("en-US")}
        />
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
        selectedAccount={selectedAccount}
        transactions={transactions}
      />
    </div>
  );
}
