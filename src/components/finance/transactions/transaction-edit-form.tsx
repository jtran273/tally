"use client";

import type { CategoryRecord, TransactionIntent, TransactionRecord } from "@/lib/db";
import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, useActionState, useState } from "react";
import { updateTransactionAction, type TransactionEditActionState } from "@/app/(app)/transactions/actions";
import styles from "./transactions.module.css";

interface TransactionEditFormProps {
  categories: CategoryRecord[];
  transaction: TransactionRecord;
}

const intentOptions: Array<{ label: string; value: TransactionIntent }> = [
  { value: "personal", label: "Personal" },
  { value: "business", label: "Business" },
  { value: "shared", label: "Shared" },
  { value: "reimbursable", label: "Reimbursable" },
  { value: "transfer", label: "Transfer" }
];

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

export function TransactionEditForm({ categories, transaction }: TransactionEditFormProps) {
  const [state, formAction, isPending] = useActionState(updateTransactionAction, initialState);
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? "none");
  const [categoryName, setCategoryName] = useState(transaction.category);

  function handleCategoryChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextCategoryId = event.target.value;
    setCategoryId(nextCategoryId);

    const category = categories.find((item) => item.id === nextCategoryId);
    if (category) {
      setCategoryName(category.name);
    } else if (!categoryName.trim()) {
      setCategoryName("Uncategorized");
    }
  }

  return (
    <div className={styles.editShell}>
      <div className={styles.editHeader}>
        <Link className={styles.secondaryButton} href="/transactions">
          <ArrowLeft size={14} aria-hidden />
          Transactions
        </Link>
        <div>
          <div className={styles.summaryLabel}>Edit enrichment</div>
          <h2>{transaction.merchant}</h2>
        </div>
      </div>

      <div className={styles.editGrid}>
        <form action={formAction} className={styles.editPanel}>
          <input name="transactionId" type="hidden" value={transaction.id} />

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
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Category / subcategory</span>
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

          <label className={`${styles.checkboxField} ${styles.switchField}`}>
            <input defaultChecked={transaction.recurring} name="isRecurring" type="checkbox" value="1" />
            <span>Recurring</span>
          </label>

          {state.error ? (
            <div className={styles.formError} role="alert">
              {state.error}
            </div>
          ) : null}

          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} disabled={isPending} type="submit">
              <Save size={14} aria-hidden />
              {isPending ? "Saving..." : "Save"}
            </button>
            <Link className={styles.secondaryButton} href="/transactions">
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
              <span>Raw Plaid category</span>
              <strong>{transaction.plaidCategory ?? "None"}</strong>
            </div>
            <div>
              <span>Review</span>
              <strong>{reviewStatusLabel(transaction)}</strong>
            </div>
            <div>
              <span>Plaid transaction</span>
              <strong>{transaction.plaidTransactionId ?? "Unavailable"}</strong>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
