import type { AccountRecord, CategoryRecord, TransactionRecord } from "@/lib/db";
import type { AgentInboxProposal } from "@/lib/agents/proposal-inbox";
import { excludeMatchedRefundReversalTransactions } from "@/lib/finance/refund-reversals";
import { transactionSpendingAmount, type SpendingReportingMode } from "@/lib/finance/spending";
import {
  buildReimbursementReportingSummary,
  summarizeTransactionReimbursement
} from "@/lib/finance/reimbursements";
import { MetricCard, MetricGrid, Notice } from "@/components/ui/primitives";
import type { PlaidConnectionSummary } from "@/lib/plaid/service";
import { isRecurringReview } from "@/lib/review/reasons";
import { ArrowRight, Database, HandCoins, Inbox, Sparkles, WalletCards } from "lucide-react";
import Link from "next/link";
import {
  hasOnlyAccountFilter,
  transactionFiltersHref,
  transactionFiltersToSearchParams,
  transactionPeriodTitle,
  type TransactionFilterState
} from "./filters";
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
  reimbursementProposals: AgentInboxProposal[];
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

function summarize(transactions: TransactionRecord[], reportingMode: SpendingReportingMode) {
  const reportableTransactions = excludeMatchedRefundReversalTransactions(transactions);
  const transactionSummary = reportableTransactions.reduce(
    (summary, transaction) => {
      summary.spending += transactionSpendingAmount(transaction, { reportingMode });

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

function topOutstandingItems(transactions: TransactionRecord[]) {
  return transactions
    .map((transaction) => ({
      reimbursement: summarizeTransactionReimbursement(transaction),
      transaction
    }))
    .filter(({ reimbursement }) =>
      reimbursement.outstandingAmount > 0 &&
      reimbursement.state !== "unmatched-income" &&
      reimbursement.state !== "written-off"
    )
    .sort((left, right) =>
      right.reimbursement.outstandingAmount - left.reimbursement.outstandingAmount ||
      left.transaction.date.localeCompare(right.transaction.date)
    )
    .slice(0, 3);
}

function ReimbursementFocusPanel({
  proposals,
  transactions
}: {
  proposals: AgentInboxProposal[];
  transactions: TransactionRecord[];
}) {
  const matchCount = proposals.filter((proposal) => proposal.action === "reimbursement-match").length;
  const candidateCount = proposals.filter((proposal) => proposal.action === "reimbursement-candidate").length;
  const summary = buildReimbursementReportingSummary(transactions);
  const outstandingItems = topOutstandingItems(transactions);
  const hasReimbursementWork = summary.outstandingAmount > 0 ||
    summary.unmatchedIncomeCount > 0 ||
    matchCount > 0 ||
    candidateCount > 0;

  if (!hasReimbursementWork) return null;

  const primaryCopy = matchCount > 0
    ? `${matchCount.toLocaleString("en-US")} suggested match${matchCount === 1 ? "" : "es"} ready`
    : candidateCount > 0
      ? `${candidateCount.toLocaleString("en-US")} AI candidate${candidateCount === 1 ? "" : "s"} to review`
      : summary.unmatchedIncomeCount > 0
        ? `${summary.unmatchedIncomeCount.toLocaleString("en-US")} unmatched inflow${summary.unmatchedIncomeCount === 1 ? "" : "s"}`
        : "No suggested match yet";

  return (
    <section className={styles.reimbursementFocusPanel} aria-label="Reimbursement follow-up">
      <div className={styles.reimbursementFocusHeader}>
        <div>
          <span>
            <HandCoins size={13} aria-hidden />
            Reimbursements
          </span>
          <strong>{formatMoney(summary.outstandingAmount)} outstanding</strong>
          <p>
            {primaryCopy}. Tally can draft candidates and matches, but ledger changes still need explicit approval.
          </p>
        </div>
        <div className={styles.reimbursementFocusActions}>
          {matchCount > 0 || candidateCount > 0 ? (
            <Link className={styles.primaryButton} href="/agent-inbox">
              <Sparkles size={14} aria-hidden />
              Review proposals
            </Link>
          ) : null}
          {outstandingItems[0] ? (
            <Link className={styles.secondaryButton} href={`/transactions/${outstandingItems[0].transaction.id}`}>
              <ArrowRight size={14} aria-hidden />
              Open largest
            </Link>
          ) : null}
        </div>
      </div>

      {outstandingItems.length > 0 ? (
        <div className={styles.reimbursementBreakdownGrid}>
          {outstandingItems.map(({ reimbursement, transaction }) => (
            <Link
              className={styles.reimbursementBreakdownItem}
              href={`/transactions/${transaction.id}`}
              key={transaction.id}
            >
              <span>{transaction.merchant}</span>
              <strong>{formatMoney(reimbursement.outstandingAmount)}</strong>
              <em>
                {formatMoney(reimbursement.receivedAmount)} received of {formatMoney(reimbursement.expectedAmount)} expected
              </em>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
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
  reimbursementProposals,
  transactions
}: TransactionsViewProps) {
  const reportingMode = filters.spendingReportingMode;
  const summary = summarize(transactions, reportingMode);
  const selectedAccount = filters.accountId === "all"
    ? null
    : accounts.find((account) => account.id === filters.accountId) ?? null;
  const accountOnlyFilter = Boolean(selectedAccount && hasOnlyAccountFilter(filters));
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
  const netHref = transactionFiltersHref("/transactions", {
    ...filters,
    spendingReportingMode: "net-after-reimbursement"
  });
  const grossHref = transactionFiltersHref("/transactions", {
    ...filters,
    spendingReportingMode: "gross"
  });
  const spendingDetail = reportingMode === "gross"
    ? summary.reimbursements.receivedAmount > 0
      ? `${formatMoney(summary.reimbursements.receivedAmount)} received reimbursements not netted`
      : "Gross outflow"
    : reimbursementDetail;

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
            detail={spendingDetail}
            label={(
              <>
              <WalletCards size={13} aria-hidden />
              {reportingMode === "gross" ? "Gross spending" : "Net spending"}
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
        <div className={styles.reportingControls} aria-label="Spending reporting basis">
          <Link
            aria-current={reportingMode === "net-after-reimbursement" ? "true" : undefined}
            className={reportingMode === "net-after-reimbursement" ? styles.reportingControlActive : undefined}
            href={netHref}
          >
            Net
          </Link>
          <Link
            aria-current={reportingMode === "gross" ? "true" : undefined}
            className={reportingMode === "gross" ? styles.reportingControlActive : undefined}
            href={grossHref}
          >
            Gross
          </Link>
        </div>
      </section>

      <TransactionFilters accounts={accounts} categories={categories} filters={filters} />
      <ReimbursementFocusPanel proposals={reimbursementProposals} transactions={transactions} />
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
        returnQuery={transactionFiltersToSearchParams(filters).toString()}
        selectedAccountIssue={selectedAccountIssue}
        selectedAccount={selectedAccount}
        transactions={transactions}
      />
    </div>
  );
}
