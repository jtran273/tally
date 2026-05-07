"use client";

import type { CategoryRecord, TransactionIntent, TransactionRecord } from "@/lib/db";
import { Pencil, Save, X } from "lucide-react";
import { type ChangeEvent, useActionState, useState } from "react";
import { editReviewTransactionAction, type ReviewActionState } from "./actions";
import styles from "./review.module.css";

interface ReviewTransactionEditFormProps {
  categories: CategoryRecord[];
  reviewItemId: string;
  transaction: TransactionRecord;
}

const intentOptions: Array<{ label: string; value: TransactionIntent }> = [
  { value: "personal", label: "Personal" },
  { value: "business", label: "Business" },
  { value: "shared", label: "Shared" },
  { value: "reimbursable", label: "Reimbursable" },
  { value: "transfer", label: "Transfer" }
];

const initialState: ReviewActionState = {};

export function ReviewTransactionEditForm({
  categories,
  reviewItemId,
  transaction
}: ReviewTransactionEditFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(editReviewTransactionAction, initialState);
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? "none");
  const [categoryName, setCategoryName] = useState(transaction.category);

  function handleCategoryChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextCategoryId = event.target.value;
    setCategoryId(nextCategoryId);

    const category = categories.find((item) => item.id === nextCategoryId);
    if (category) setCategoryName(category.name);
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
    <form action={formAction} className={styles.inlineEditForm}>
      <input name="reviewItemId" type="hidden" value={reviewItemId} />

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
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Category label</span>
          <input
            className={styles.inputControl}
            maxLength={160}
            name="categoryName"
            onChange={(event) => setCategoryName(event.target.value)}
            required
            value={categoryName}
          />
        </label>

        <label className={styles.field}>
          <span>Intent</span>
          <select className={styles.selectControl} defaultValue={transaction.intent} name="intent">
            {intentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

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

        <label className={`${styles.checkboxField} ${styles.inlineEditRecurring}`}>
          <input defaultChecked={transaction.recurring} name="isRecurring" type="checkbox" value="1" />
          <span>Recurring</span>
        </label>
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
        <button className={styles.primaryButton} disabled={isPending} type="submit">
          <Save size={14} aria-hidden />
          {isPending ? "Saving..." : "Save and finalize"}
        </button>
        <button className={styles.secondaryButton} disabled={isPending} onClick={() => setIsOpen(false)} type="button">
          <X size={14} aria-hidden />
          Cancel
        </button>
      </div>
    </form>
  );
}
