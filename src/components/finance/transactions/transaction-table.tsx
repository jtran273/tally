import type { ReviewReason, ReviewStatus, TransactionIntent, TransactionRecord } from "@/lib/db";
import { Clock3, Pencil, Repeat, TriangleAlert } from "lucide-react";
import Link from "next/link";
import styles from "./transactions.module.css";

interface TransactionTableProps {
  filtersActive: boolean;
  limit: number;
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

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatMoney(value: number) {
  const formatted = moneyFormatter.format(Math.abs(value));
  if (value < 0) return `-${formatted}`;
  if (value > 0) return `+${formatted}`;
  return formatted;
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

export function TransactionTable({ filtersActive, limit, transactions }: TransactionTableProps) {
  if (transactions.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyTitle}>
          {filtersActive ? "No transactions match these filters" : "No persisted transactions yet"}
        </div>
        <div className={styles.emptyCopy}>
          {filtersActive
            ? "Clear or loosen the filters to widen the persisted transaction set."
            : "Once Plaid syncs transactions, enriched and raw transaction records will appear here."}
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

              return (
                <tr
                  className={`${transaction.status === "pending" ? styles.pendingRow : ""} ${hasOpenReview ? styles.reviewRow : ""}`}
                  key={transaction.id}
                >
                  <td>
                    <div className={styles.dateCell}>
                      <span>{formatDate(transaction.date)}</span>
                      <span>{transaction.date}</span>
                    </div>
                  </td>
                  <td>
                    <div className={styles.merchantCell}>
                      <div className={styles.merchantName}>
                        {transaction.merchant}
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
                      </div>
                      <div className={styles.secondaryLine}>
                        {transaction.plaidMerchant && transaction.plaidMerchant !== transaction.merchant
                          ? transaction.plaidMerchant
                          : transaction.note || "Raw and enriched names match"}
                      </div>
                      {transaction.note && transaction.plaidMerchant && transaction.plaidMerchant !== transaction.merchant ? (
                        <div className={styles.noteLine}>{transaction.note}</div>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className={styles.categoryCell}>
                      <span>{transaction.category}</span>
                      {transaction.plaidCategory && transaction.plaidCategory !== transaction.category ? (
                        <span>{transaction.plaidCategory}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className={styles.accountCell}>
                      <span>{accountLabel(transaction)}</span>
                      <span>{transaction.institutionName}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`${styles.intentChip} ${styles[`intent-${transaction.intent}`]}`}>
                      {intentLabels[transaction.intent]}
                    </span>
                  </td>
                  <td>
                    <span className={hasOpenReview ? styles.reviewText : styles.mutedText}>
                      {reviewLabel(transaction)}
                    </span>
                  </td>
                  <td className={`${styles.amountCell} ${transaction.amount >= 0 ? styles.positiveAmount : styles.negativeAmount}`}>
                    {formatMoney(transaction.amount)}
                  </td>
                  <td>
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
