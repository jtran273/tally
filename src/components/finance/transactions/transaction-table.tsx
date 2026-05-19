import type { AccountRecord, ReviewItemRecord, ReviewReason, ReviewStatus, TransactionRecord } from "@/lib/db";
import { displayCategoryName, isTransferCategoryName } from "@/lib/finance/classification";
import { summarizeTransactionReimbursement, type TransactionReimbursementState } from "@/lib/finance/reimbursements";
import type { PlaidConnectionIssue } from "@/lib/plaid/status";
import { isRecurringReview } from "@/lib/review/reasons";
import {
  ArrowLeftRight,
  Clock3,
  HandCoins,
  Pencil,
  Repeat,
  TriangleAlert,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./transactions.module.css";

interface TransactionTableProps {
  accountOnlyFilter: boolean;
  filtersActive: boolean;
  limit: number;
  selectedAccountIssue: PlaidConnectionIssue | null;
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

const reimbursementLabels: Record<TransactionReimbursementState, string> = {
  none: "",
  reimbursable: "Reimbursable",
  "partially-reimbursed": "Partially reimbursed",
  reimbursed: "Reimbursed",
  "written-off": "Written off"
};

const institutionSuffixes = new Set(["bank", "credit union", "cu", "fcu", "financial", "na", "n.a."]);
const preservedAccountWords = new Set(["ACH", "ATM", "CD", "FCU", "FSA", "HSA", "IRA", "USB"]);

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
  return `${Math.round(confidence * 100)}%`;
}

function confidenceCopy(transaction: TransactionRecord) {
  if (transaction.confidence >= 0.95 || transaction.reviewedAt) {
    return "Reviewed";
  }
  if (transaction.confidence < 0.75) {
    return `${confidenceLabel(transaction.confidence)} confidence — review`;
  }
  return `${confidenceLabel(transaction.confidence)} confidence`;
}

function needsCategory(transaction: TransactionRecord) {
  return transaction.intent !== "transfer" &&
    !isTransferCategoryName(transaction.category) &&
    (!transaction.categoryId || transaction.category.toLowerCase() === "uncategorized");
}

function reviewLabel(review: ReviewItemRecord | undefined) {
  if (!review) return "None";

  return `${reviewStatusLabels[review.status]} - ${reviewReasonLabels[review.reason]}`;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function suggestedCategoryName(transaction: TransactionRecord) {
  const openReview = transaction.reviewItems.find((item) => item.status === "open" && !isRecurringReview(item.reason));
  const suggestion = objectValue(openReview?.aiSuggestion);
  const nestedCategory = objectValue(suggestion?.category);
  const categoryName = typeof suggestion?.categoryName === "string"
    ? suggestion.categoryName
    : typeof suggestion?.category === "string"
      ? suggestion.category
      : typeof nestedCategory?.name === "string"
        ? nestedCategory.name
        : null;
  const displayName = displayCategoryName(categoryName ?? "");
  return displayName === "Uncategorized" ? null : displayName;
}

function displayName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return normalized;
  if (/[a-z]/.test(normalized)) return normalized;

  return normalized
    .toLowerCase()
    .replace(/[a-z0-9]+(?:'[a-z0-9]+)?/g, (word) => {
      const upper = word.toUpperCase();
      if (preservedAccountWords.has(upper)) return upper;
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    });
}

function searchableInstitutionName(value: string) {
  return displayName(value)
    .toLowerCase()
    .replace(/[^\w\s.]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !institutionSuffixes.has(word))
    .join(" ");
}

function accountLabel(transaction: TransactionRecord) {
  const accountName = displayName(transaction.accountName);
  const institutionName = displayName(transaction.institutionName);
  if (!institutionName || institutionName === "Unknown institution") return accountName;
  const normalizedAccount = accountName.toLowerCase();
  const normalizedInstitution = institutionName.toLowerCase();
  const compactInstitution = searchableInstitutionName(institutionName);
  if (
    normalizedAccount.includes(normalizedInstitution) ||
    (compactInstitution && normalizedAccount.includes(compactInstitution))
  ) {
    return accountName;
  }
  return `${institutionName} ${accountName}`;
}

function emptyTransactionTitle(filtersActive: boolean, accountOnlyFilter: boolean, selectedAccount: AccountRecord | null) {
  if (accountOnlyFilter && selectedAccount) return `No transaction rows for ${selectedAccount.name}`;
  return filtersActive ? "No rows match the current filters" : "No persisted transactions yet";
}

function emptyTransactionCopy(
  filtersActive: boolean,
  accountOnlyFilter: boolean,
  selectedAccount: AccountRecord | null,
  selectedAccountIssue: PlaidConnectionIssue | null
) {
  if (accountOnlyFilter && selectedAccount) {
    if (selectedAccountIssue?.action === "reconnect") {
      return `${selectedAccountIssue.detail} The saved balance can remain visible even though no transaction rows are importing.`;
    }

    if (selectedAccount.type === "investment" || selectedAccount.type === "retirement") {
      return "This account can be connected and show balances even when Plaid Transactions does not return posted rows for it.";
    }

    return "This connected account has no persisted transaction rows yet. Newly connected accounts may need a sync before posted activity appears.";
  }

  return filtersActive
    ? "Reset search, month, account, category, or review filters to bring more transactions back into view."
    : "After Plaid syncs, Tally will show enriched transaction rows here with merchant, category, review, and reimbursement context.";
}

function StatusBadge({
  children,
  icon: Icon,
  label,
  tone
}: {
  children: ReactNode;
  icon: LucideIcon;
  label: string;
  tone?: "pending" | "review" | "reimbursement";
}) {
  const toneClass = tone === "pending"
    ? styles.pendingBadge
    : tone === "review"
      ? styles.reviewBadge
      : tone === "reimbursement"
        ? styles.reimbursementBadge
        : "";

  return (
    <span aria-label={label} className={`${styles.badge} ${toneClass}`} title={label}>
      <Icon size={11} aria-hidden />
      <span className={styles.badgeText}>{children}</span>
    </span>
  );
}

export function TransactionTable({
  accountOnlyFilter,
  filtersActive,
  limit,
  selectedAccountIssue,
  selectedAccount,
  transactions
}: TransactionTableProps) {
  if (transactions.length === 0) {
    return (
      <div className={styles.emptyState} role="status" aria-live="polite">
        <div className={styles.emptyTitle}>
          {emptyTransactionTitle(filtersActive, accountOnlyFilter, selectedAccount)}
        </div>
        <div className={styles.emptyCopy}>
          {emptyTransactionCopy(filtersActive, accountOnlyFilter, selectedAccount, selectedAccountIssue)}
        </div>
        {filtersActive ? (
          <div className={styles.emptyActions}>
            <Link className={styles.emptyResetLink} href="/transactions">Reset all filters</Link>
          </div>
        ) : null}
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
              <th className={styles.amountHead} scope="col">Amount</th>
              <th scope="col">Edit</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => {
              const actionableReview = transaction.reviewItems.find((review) => review.status === "open" && !isRecurringReview(review.reason));
              const hasRecurringSignal = transaction.reviewItems.some((review) => review.status === "open" && isRecurringReview(review.reason));
              const reimbursement = summarizeTransactionReimbursement(transaction);
              const transferTagged = transaction.intent === "transfer" || isTransferCategoryName(transaction.category);
              const isUncategorized = needsCategory(transaction);
              const suggestedCategory = isUncategorized ? suggestedCategoryName(transaction) : null;
              const confidenceNeedsReview = transaction.confidence < 0.75 && !transaction.reviewedAt;
              const showConfidenceContext = confidenceNeedsReview || Boolean(transaction.reviewedAt);

              return (
                <tr
                  className={`${transaction.status === "pending" ? styles.pendingRow : ""} ${actionableReview ? styles.reviewRow : ""}`}
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
                      </div>
                      <div className={styles.statusTags}>
                        {transaction.status === "pending" ? (
                          <StatusBadge icon={Clock3} label="Pending transaction" tone="pending">Pending</StatusBadge>
                        ) : null}
                        {actionableReview ? (
                          <StatusBadge icon={TriangleAlert} label={reviewLabel(actionableReview)} tone="review">Needs review</StatusBadge>
                        ) : null}
                        {transaction.recurring || hasRecurringSignal ? (
                          <StatusBadge icon={Repeat} label={hasRecurringSignal ? "Recurring pattern detected" : "Recurring transaction"}>Recurring</StatusBadge>
                        ) : null}
                        {transferTagged ? (
                          <StatusBadge icon={ArrowLeftRight} label="Money movement between accounts">Transfer</StatusBadge>
                        ) : null}
                        {reimbursement.state !== "none" ? (
                          <StatusBadge icon={HandCoins} label={reimbursementLabels[reimbursement.state]} tone="reimbursement">
                            {reimbursementLabels[reimbursement.state]}
                          </StatusBadge>
                        ) : null}
                      </div>
                      {reimbursement.state !== "none" ? (
                        <div className={styles.reimbursementLine}>
                          {formatUnsignedMoney(reimbursement.outstandingAmount)} outstanding from {formatUnsignedMoney(reimbursement.reimbursableAmount)} reimbursable
                        </div>
                      ) : null}
                      {transaction.note ? (
                        <div className={styles.noteLine}>{transaction.note}</div>
                      ) : null}
                    </div>
                  </td>
                  <td data-label="Category">
                    <div className={styles.categoryCell}>
                      <span className={styles.categoryLabel}>{displayCategoryName(transaction.category)}</span>
                      {showConfidenceContext ? (
                        <span
                          className={`${styles.categoryMeta} ${confidenceNeedsReview ? styles.categoryWarning : styles.categoryHint}`}
                          title={confidenceCopy(transaction)}
                        >
                          {confidenceCopy(transaction)}
                        </span>
                      ) : null}
                      {suggestedCategory ? (
                        <span className={`${styles.categoryMeta} ${styles.categoryHint}`}>Suggested: {suggestedCategory}</span>
                      ) : null}
                      {isUncategorized ? (
                        <span className={`${styles.categoryMeta} ${styles.categoryWarning}`}>Needs a real category</span>
                      ) : null}
                      {isUncategorized ? (
                        actionableReview ? (
                          <Link className={styles.categoryActionLink} href={`/review#review-${actionableReview.id}`}>
                            Open review
                          </Link>
                        ) : (
                          <Link className={styles.categoryActionLink} href={`/transactions/${transaction.id}`}>
                            Choose category
                          </Link>
                        )
                      ) : null}
                    </div>
                  </td>
                  <td data-label="Account">
                    <div className={styles.accountCell}>
                      <span>{accountLabel(transaction)}</span>
                    </div>
                  </td>
                  <td
                    aria-label={`${transaction.amount >= 0 ? "Inflow" : "Outflow"} ${formatUnsignedMoney(transaction.amount)}`}
                    className={`${styles.amountCell} ${transaction.amount >= 0 ? styles.positiveAmount : styles.negativeAmount}`}
                    data-label="Amount"
                  >
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
