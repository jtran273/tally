"use client";

import type { CategoryRecord, TransactionRecord } from "@/lib/db";
import {
  categoryOptionGroups,
  displayTransactionIntent,
  isTransferCategoryName,
  primaryCategoryIdForId,
  transactionTagFromIntent,
  userTransactionIntentOptions,
  type TransactionTag,
  type UserTransactionIntent
} from "@/lib/finance/classification";
import { isManualTransactionEditResolvableReview } from "@/lib/review/reasons";
import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, useActionState, useState } from "react";
import { updateTransactionAction, type TransactionEditActionState } from "@/app/(app)/transactions/actions";
import { isFeatureEnabled } from "@/lib/features";
import styles from "./transactions.module.css";

interface TransactionEditFormProps {
  categories: CategoryRecord[];
  isDemo: boolean;
  returnQuery?: string;
  transaction: TransactionRecord;
}

const NEW_CATEGORY_VALUE = "__new_category__";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const initialState: TransactionEditActionState = {};

function formatMoney(value: number) {
  const formatted = moneyFormatter.format(Math.abs(value));
  if (value < 0) return `-${formatted}`;
  if (value > 0) return `+${formatted}`;
  return formatted;
}

function reviewStatusLabel(transaction: TransactionRecord) {
  const open = transaction.reviewItems.find((item) => item.status === "open");
  if (open) return `Open - ${open.reason}`;
  if (transaction.reviewItems[0]) return `${transaction.reviewItems[0].status} - ${transaction.reviewItems[0].reason}`;
  return "No review item";
}

export function TransactionEditForm({ categories, isDemo, returnQuery, transaction }: TransactionEditFormProps) {
  const [state, formAction, isPending] = useActionState(updateTransactionAction, initialState);
  const backHref = returnQuery ? `/transactions?${returnQuery}` : "/transactions";
  const categoryGroups = categoryOptionGroups(categories);
  const initialCategoryId = isTransferCategoryName(transaction.category)
    ? "none"
    : primaryCategoryIdForId(transaction.categoryId, categories) ?? "none";
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [baseIntent, setBaseIntent] = useState<UserTransactionIntent>(displayTransactionIntent(transaction.intent));
  const [newCategoryName, setNewCategoryName] = useState("");
  const [tag, setTag] = useState<TransactionTag>(transactionTagFromIntent(transaction.intent));
  const canClearReview = transaction.reviewItems.some((item) => (
    item.status === "open" &&
    isManualTransactionEditResolvableReview(item.reason) &&
    (item.reason !== "missing-category" || categoryId !== "none" || tag === "transfer")
  ));

  function handleCategoryChange(event: ChangeEvent<HTMLSelectElement>) {
    setCategoryId(event.target.value);
  }

  function handleTagToggle(nextTag: Exclude<TransactionTag, "none">, checked: boolean) {
    setTag(checked ? nextTag : "none");
  }

  return (
    <div className={styles.editShell}>
      <div className={styles.editHeader}>
        <Link className={styles.secondaryButton} href={backHref}>
          <ArrowLeft size={14} aria-hidden />
          Transactions
        </Link>
        <div>
          <div className={styles.summaryLabel}>Edit enrichment</div>
          <h2>{transaction.merchant}</h2>
        </div>
      </div>

      <div className={styles.editGrid}>
        <form
          action={formAction}
          aria-label="Edit transaction enrichment"
          className={styles.editPanel}
          onSubmit={(event) => {
            if (isDemo) event.preventDefault();
          }}
        >
          <input name="transactionId" type="hidden" value={transaction.id} />
          <input name="returnTo" type="hidden" value={returnQuery ?? ""} />

          {isDemo ? (
            <div className={styles.formSuccess} role="status">
              Demo transactions are read-only. Sign in to save enrichment changes to your own account.
            </div>
          ) : null}

          <label className={styles.field}>
            <span>Merchant</span>
            <input
              className={styles.inputControl}
              defaultValue={transaction.merchant}
              maxLength={160}
              name="merchantName"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Category</span>
            <select className={styles.selectControl} name="categoryId" onChange={handleCategoryChange} value={categoryId}>
              <option value="none">No linked category</option>
              {categoryGroups.map((category) => (
                <option key={category.primaryCategoryId} value={category.primaryCategoryId}>
                  {category.label}
                </option>
              ))}
              <option value={NEW_CATEGORY_VALUE}>Create new category...</option>
            </select>
          </label>

          {categoryId === NEW_CATEGORY_VALUE ? (
            <label className={styles.field}>
              <span>New category</span>
              <input
                className={styles.inputControl}
                maxLength={160}
                name="newCategoryName"
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="Gifts"
                required
                value={newCategoryName}
              />
            </label>
          ) : (
            <input
              name="newCategoryName"
              type="hidden"
              value=""
            />
          )}

          <label className={styles.field}>
            <span>Intent</span>
            <select
              className={styles.selectControl}
              name="baseIntent"
              onChange={(event) => setBaseIntent(event.target.value as UserTransactionIntent)}
              value={baseIntent}
            >
              {userTransactionIntentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <input name="tag" type="hidden" value={tag} />

          <label className={`${styles.field} ${styles.fullField}`}>
            <span>Notes</span>
            <textarea
              className={styles.textareaControl}
              defaultValue={transaction.note}
              maxLength={1000}
              name="note"
              rows={5}
            />
          </label>

          <div className={styles.flagGroup} aria-label="Transaction flags">
            <label className={styles.checkboxField}>
              <input defaultChecked={transaction.recurring} name="isRecurring" type="checkbox" value="1" />
              <span>Recurring</span>
            </label>
            {isFeatureEnabled("reimbursements") ? (
              <label className={styles.checkboxField}>
                <input
                  checked={tag === "reimbursable"}
                  name="isReimbursable"
                  onChange={(event) => handleTagToggle("reimbursable", event.currentTarget.checked)}
                  type="checkbox"
                  value="1"
                />
                <span>Reimbursable</span>
              </label>
            ) : null}
            <label className={styles.checkboxField}>
              <input
                checked={tag === "transfer"}
                name="isTransfer"
                onChange={(event) => handleTagToggle("transfer", event.currentTarget.checked)}
                type="checkbox"
                value="1"
              />
              <span>Transfer</span>
            </label>
          </div>

          {state.error ? (
            <div className={styles.formError} role="alert">
              {state.error}
            </div>
          ) : null}

          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} disabled={isDemo || isPending} type="submit">
              <Save size={14} aria-hidden />
              {isDemo ? "Read-only demo" : isPending ? "Saving..." : canClearReview ? "Save and clear review" : "Save"}
            </button>
            <Link className={styles.secondaryButton} href={backHref}>
              Cancel
            </Link>
          </div>
        </form>

        <aside className={styles.editPanel} aria-label="Read-only transaction details">
          <div className={styles.readonlyGrid}>
            <div>
              <span>Date</span>
              <strong>{transaction.date}</strong>
            </div>
            <div>
              <span>Amount</span>
              <strong>{formatMoney(transaction.amount)}</strong>
            </div>
            <div>
              <span>Account</span>
              <strong>{transaction.accountName}</strong>
            </div>
            <div>
              <span>Institution</span>
              <strong>{transaction.institutionName}</strong>
            </div>
            <div>
              <span>Raw Plaid merchant</span>
              <strong>{transaction.plaidMerchant ?? "None"}</strong>
            </div>
            <div>
              <span>Raw Plaid name</span>
              <strong>{transaction.plaidName ?? "None"}</strong>
            </div>
            <div>
              <span>Raw Plaid category</span>
              <strong>{transaction.plaidCategory ?? "None"}</strong>
            </div>
            <div>
              <span>Review</span>
              <strong>{reviewStatusLabel(transaction)}</strong>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
