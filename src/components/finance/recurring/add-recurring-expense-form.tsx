"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { addRecurringExpenseAction, type RecurringActionState } from "./actions";
import styles from "./recurring.module.css";

const initialState: RecurringActionState = {};

const CADENCE_OPTIONS: { label: string; value: string }[] = [
  { label: "Monthly", value: "monthly" },
  { label: "Weekly", value: "weekly" },
  { label: "Biweekly", value: "biweekly" },
  { label: "Quarterly", value: "quarterly" },
  { label: "Annual", value: "annual" }
];

export function AddRecurringExpenseForm({ isDemo }: { isDemo: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addRecurringExpenseAction, initialState);

  if (!open) {
    return (
      <div className={styles.addFormActions} style={{ padding: "16px" }}>
        <button className={styles.primaryButton} onClick={() => setOpen(true)} type="button">
          <Plus size={14} aria-hidden /> Add recurring expense
        </button>
        {state.message ? (
          <span className={styles.inlineMessage} role="status" aria-live="polite">
            {state.message}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className={styles.addForm}
      onSubmit={(event) => {
        if (isDemo) event.preventDefault();
      }}
    >
      <div className={styles.addFormGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Merchant</span>
          <input className={styles.input} name="merchant" placeholder="Chase Sapphire" required type="text" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Amount</span>
          <input className={styles.input} min="0.01" name="amount" placeholder="95.00" step="0.01" required type="number" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Cadence</span>
          <select className={styles.select} defaultValue="monthly" name="cadence">
            {CADENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Last charge date</span>
          <input className={styles.input} name="lastChargeDate" required type="date" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Next due (optional)</span>
          <input className={styles.input} name="nextDueDate" type="date" />
        </label>
      </div>

      <div className={styles.addFormActions}>
        <button className={styles.primaryButton} disabled={pending || isDemo} type="submit">
          {isDemo ? "Read-only demo" : pending ? "Adding..." : "Add recurring expense"}
        </button>
        <button className={styles.secondaryButton} onClick={() => setOpen(false)} type="button">
          <X size={14} aria-hidden /> Cancel
        </button>
        {state.error ? (
          <span className={styles.inlineError} role="alert" aria-live="assertive">
            {state.error}
          </span>
        ) : state.message ? (
          <span className={styles.inlineMessage} role="status" aria-live="polite">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
