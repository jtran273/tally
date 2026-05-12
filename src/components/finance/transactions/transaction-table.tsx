import type { AccountRecord, ReviewReason, ReviewStatus, TransactionIntent, TransactionRecord } from "@/lib/db";
import { summarizeTransactionReimbursement, type TransactionReimbursementState } from "@/lib/finance/reimbursements";
import { Clock3, HandCoins, Pencil, Repeat, TriangleAlert } from "lucide-react";
import Link from "next/link";
import styles from "./transactions.module.css";

interface TransactionTableProps {
  accountOnlyFilter: boolean;
  filtersActive: boolean;
  limit: number;
  selectedAccount: AccountRecord | null;
  transactions: TransactionRecord[];
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  weekday: "short"
});

const reviewStatusLabels: Record<ReviewStatus, string> = {
  open: "Needs review",
  resolved: "Resolved",
  dismissed: "Dismissed"
};

const reviewReasonLabels: Record<ReviewReason, string> = {
  venmo: "Peer-to-peer",
  large: "Large",
  "transfer-pair": "Transfer pair",
  "new-recurring": "New recurring",
  "low-confidence": "Low confidence",
  "missing-category": "Missing category",
  "unclear-transfer": "Unclear transfer",
  "recurring-candidate": "Recurring candidate"
};

const intentLabels: Record<TransactionIntent, string> = {
  personal: "Personal",
  business: "Business",
  shared: "Shared",
  reimbursable: "Reimbursable",
  transfer: "Transfer"
};

const reimbursementLabels: Record<TransactionReimbursementState, string> = {
  none: "",
  reimbursable: "Reimbursable",
  "partially-reimbursed": "Partially reimbursed",
  reimbursed: "Reimbursed",
  "written-off": "Written off"
};

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatMoney(value: number) {
  const formatted = moneyFormatter.format(Math.abs(value));
  if (value < 0) return `-${formatted}`;
  if (value > 0) return `+${formatted}`;
  return formatted;
}

function formatUnsignedMoney(value: number) {
  return moneyFormatter.format(Math.abs(value));
}


function confidenceLabel(confidence: number) {
  return `${Math.round(confidence * 100)}% confidence`;
}

function categoryQuality(transaction: TransactionRecord) {
  const issues: string[] = [];
  if (transaction.confidence < 0.75) issues.push("Low confidence");
  if (!transaction.categoryId || transaction.category.toLowerCase() === "uncategorized") issues.push("Uncategorized");
  if (transaction.reviewItems.some((review) => review.status === "open")) issues.push("Open review");
  return issues;
}

function reviewLabel(transaction: TransactionRecord) {
  const review = transaction.reviewItems.find((item) => item.status === "open") ?? transaction.reviewItems[0];
  if (!review) return "None";

  return `${reviewStatusLabels[review.status]} - ${reviewReasonLabels[review.reason]}`;
}

function accountLabel(transaction: TransactionRecord) {
  return [
    transaction.accountName,
    transaction.accountMask ? `-${transaction.accountMask}` : null
  ].filter(Boolean).join(" ");
}

function rawPlaidLine(transaction: TransactionRecord) {
  return [
    transaction.plaidMerchant && transaction.plaidMerchant !== transaction.merchant
      ? transaction.plaidMerchant
      : null,
    transaction.plaidName && transaction.plaidName !== transaction.merchant && transaction.plaidName !== transaction.plaidMerchant
      ? transaction.plaidName
      : null
  ].filter(Boolean).join(" / ");
}

function emptyTransactionTitle(filtersActive: boolean, accountOnlyFilter: boolean, selectedAccount: AccountRecord | null) {
  if (accountOnlyFilter && selectedAccount) return `No transaction rows for ${selectedAccount.name}`;
  return filtersActive ? "No transactions match these filters" : "No persisted transactions yet";
}

function emptyTransactionCopy(filtersActive: boolean, accountOnlyFilter: boolean, selectedAccount: AccountRecord | null) {
  if (accountOnlyFilter && selectedAccount) {
    if (selectedAccount.type === "investment" || selectedAccount.type === "retirement") {
      return "This account can be connected and show balances even when Plaid Transactions does not return posted rows for it.";
    }

    return "This connected account has no persisted transaction rows yet. Newly connected accounts may need a sync before posted activity appears.";
  }

  return filtersActive
    ? "Clear or loosen the filters to widen the persisted transaction set."
    : "Once Plaid syncs transactions, enriched and raw transaction records will appear here.";
}

export function TransactionTable({
  accountOnlyFilter,
  filtersActive,
  limit,
  selectedAccount,
  transactions
}: TransactionTableProps) {
  if (transactions.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyTitle}>
          {emptyTransactionTitle(filtersActive, accountOnlyFilter, selectedAccount)}
        </div>
        <div className={styles.emptyCopy}>
          {emptyTransactionCopy(filtersActive, accountOnlyFilter, selectedAccount)}
        </div>
      </div>
    );
  }

  return (
    <section className={styles.tableShell} aria-label="Persisted transactions">
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Merchant</th>
              <th scope="col">Category</th>
              <th scope="col">Account</th>
              <th scope="col">Intent</th>
              <th scope="col">Review</th>
              <th className={styles.amountHead} scope="col">Amount</th>
              <th scope="col">Edit</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => {
              const hasOpenReview = transaction.reviewItems.some((review) => review.status === "open");
              const qualityIssues = categoryQuality(transaction);
              const reimbursement = summarizeTransactionReimbursement(transaction);
              const rawLine = rawPlaidLine(transaction);

              return (
                <tr
                  className={`${transaction.status === "pending" ? styles.pendingRow : ""} ${hasOpenReview ? styles.reviewRow : ""}`}
                  key={transaction.id}
                >
                  <td data-label="Date">
                    <div className={styles.dateCell}>
                      <span>{formatDate(transaction.date)}</span>
                      <span>{transaction.date}</span>
                    </div>
                  </td>
                  <td data-label="Merchant">
                    <div className={styles.merchantCell}>
                      <div className={styles.merchantName}>
                        <Link
                          className={styles.merchantEditLink}
                          href={`/transactions/${transaction.id}`}
                          title={`Edit ${transaction.merchant}`}
                        >
                          {transaction.merchant}
                        </Link>
                        {transaction.status === "pending" ? (
                          <span className={`${styles.badge} ${styles.pendingBadge}`}>
                            <Clock3 size={11} aria-hidden />
                            Pending
                          </span>
                        ) : null}
                        {transaction.recurring ? (
                          <span className={styles.badge}>
                            <Repeat size={11} aria-hidden />
                            Recurring
                          </span>
                        ) : null}
                        {hasOpenReview ? (
                          <span className={`${styles.badge} ${styles.reviewBadge}`}>
                            <TriangleAlert size={11} aria-hidden />
                            Review
                          </span>
                        ) : null}
                        {reimbursement.state !== "none" ? (
                          <span className={`${styles.badge} ${styles.reimbursementBadge}`}>
                            <HandCoins size={11} aria-hidden />
                            {reimbursementLabels[reimbursement.state]}
                          </span>
                        ) : null}
                      </div>
                      <div className={styles.secondaryLine}>
                        {rawLine || transaction.note || "Raw and enriched names match"}
                      </div>
                      {reimbursement.state !== "none" ? (
                        <div className={styles.reimbursementLine}>
                          {formatUnsignedMoney(reimbursement.outstandingAmount)} outstanding from {formatUnsignedMoney(reimbursement.reimbursableAmount)} reimbursable
                        </div>
                      ) : null}
                      {transaction.note && rawLine ? (
                        <div className={styles.noteLine}>{transaction.note}</div>
                      ) : null}
                    </div>
                  </td>
                  <td data-label="Category">
                    <div className={styles.categoryCell}>
                      <span>{transaction.category}</span>
                      <span className={transaction.confidence < 0.75 ? styles.lowConfidenceText : styles.confidenceText}>
                        {confidenceLabel(transaction.confidence)}
                      </span>
                      {qualityIssues.length > 0 ? (
                        <div className={styles.qualityBadges}>
                          {qualityIssues.map((issue) => (
                            <span className={styles.qualityBadge} key={issue}>{issue}</span>
                          ))}
                        </div>
                      ) : null}
                      {transaction.plaidCategory && transaction.plaidCategory !== transaction.category ? (
                        <span>{transaction.plaidCategory}</span>
                      ) : null}
                    </div>
                  </td>
                  <td data-label="Account">
                    <div className={styles.accountCell}>
                      <span>{accountLabel(transaction)}</span>
                      <span>{transaction.institutionName}</span>
                    </div>
                  </td>
                  <td data-label="Intent">
                    <span className={`${styles.intentChip} ${styles[`intent-${transaction.intent}`]}`}>
                      {intentLabels[transaction.intent]}
                    </span>
                  </td>
                  <td data-label="Review">
                    <span className={hasOpenReview ? styles.reviewText : styles.mutedText}>
                      {reviewLabel(transaction)}
                    </span>
                  </td>
                  <td className={`${styles.amountCell} ${transaction.amount >= 0 ? styles.positiveAmount : styles.negativeAmount}`} data-label="Amount">
                    {formatMoney(transaction.amount)}
                  </td>
                  <td data-label="Edit">
                    <Link className={styles.iconLink} href={`/transactions/${transaction.id}`} aria-label={`Edit ${transaction.merchant}`}>
                      <Pencil size={14} aria-hidden />
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {transactions.length >= limit ? (
        <div className={styles.limitNotice}>
          Row limit is {limit.toLocaleString("en-US")} transactions. Narrow filters or raise the limit to inspect a wider set.
        </div>
      ) : null}
    </section>
  );
}
