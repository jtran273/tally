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
import { Pencil, Save, X } from "lucide-react";
import { type ChangeEvent, useActionState, useState } from "react";
import { isFeatureEnabled } from "@/lib/features";
import { editReviewTransactionAction, type ReviewActionState } from "./actions";
import styles from "./review.module.css";

interface ReviewTransactionEditFormProps {
  categories: CategoryRecord[];
  isDemo: boolean;
  reviewItemId: string;
  transaction: TransactionRecord;
}

const initialState: ReviewActionState = {};

export function ReviewTransactionEditForm({
  categories,
  isDemo,
  reviewItemId,
  transaction
}: ReviewTransactionEditFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(editReviewTransactionAction, initialState);
  const categoryGroups = categoryOptionGroups(categories);
  const initialCategoryId = isTransferCategoryName(transaction.category)
    ? "none"
    : primaryCategoryIdForId(transaction.categoryId, categories) ?? "none";
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [categoryName, setCategoryName] = useState(transaction.category);
  const [baseIntent, setBaseIntent] = useState<UserTransactionIntent>(displayTransactionIntent(transaction.intent));
  const [tag, setTag] = useState<TransactionTag>(transactionTagFromIntent(transaction.intent));

  function handleCategoryChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextCategoryId = event.target.value;
    setCategoryId(nextCategoryId);

    const category = categories.find((item) => item.id === nextCategoryId);
    if (category) setCategoryName(category.name);
  }

  function handleTagToggle(nextTag: Exclude<TransactionTag, "none">, checked: boolean) {
    setTag(checked ? nextTag : "none");
  }

  if (!isOpen) {
    return (
      <button className={styles.secondaryButton} onClick={() => setIsOpen(true)} type="button">
        <Pencil size={14} aria-hidden />
        Edit here
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className={styles.inlineEditForm}
      onSubmit={(event) => {
        if (isDemo) event.preventDefault();
      }}
    >
      <input name="reviewItemId" type="hidden" value={reviewItemId} />

      {isDemo ? (
        <div className={styles.inlineSuccess} role="status">
          Inline transaction edits are preview-only in demo mode.
        </div>
      ) : null}

      <div className={styles.inlineEditGrid}>
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
            <option value="none">Select category</option>
            {categoryGroups.map((category) => (
              <option key={category.primaryCategoryId} value={category.primaryCategoryId}>
                {category.label}
              </option>
            ))}
          </select>
        </label>

        <input name="categoryName" type="hidden" value={categoryName} />

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

        <label className={`${styles.field} ${styles.inlineEditNotes}`}>
          <span>Notes</span>
          <textarea
            className={styles.textareaControl}
            defaultValue={transaction.note}
            maxLength={1000}
            name="note"
            rows={3}
          />
        </label>

        <div className={styles.inlineEditFlags} aria-label="Transaction flags">
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
      </div>

      {state.error ? (
        <div className={styles.inlineError} role="alert">
          {state.error}
        </div>
      ) : state.message ? (
        <div className={styles.inlineSuccess} role="status">
          {state.message}
        </div>
      ) : null}

      <div className={styles.inlineEditActions}>
        <button className={styles.primaryButton} disabled={isDemo || isPending} type="submit">
          <Save size={14} aria-hidden />
          {isDemo ? "Read-only demo" : isPending ? "Saving..." : "Save and finalize"}
        </button>
        <button className={styles.secondaryButton} disabled={isPending} onClick={() => setIsOpen(false)} type="button">
          <X size={14} aria-hidden />
          Cancel
        </button>
      </div>
    </form>
  );
}
