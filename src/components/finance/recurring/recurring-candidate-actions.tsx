"use client";

import { Check, X } from "lucide-react";
import { useActionState } from "react";
import {
  confirmRecurringCandidateAction,
  dismissRecurringCandidateAction,
  type RecurringActionState
} from "./actions";
import styles from "./recurring.module.css";

interface RecurringCandidateActionsProps {
  candidateId?: string;
  isDemo: boolean;
  merchant: string;
  recurringExpenseId?: string;
}

const initialState: RecurringActionState = {};

export function RecurringCandidateActions({
  candidateId,
  isDemo,
  merchant,
  recurringExpenseId
}: RecurringCandidateActionsProps) {
  const [confirmState, confirmAction, confirming] = useActionState(confirmRecurringCandidateAction, initialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissRecurringCandidateAction, initialState);
  const disabled = confirming || dismissing || isDemo;
  // Prefer the most recent action's outcome; suppress messages while pending to avoid stale toasts.
  const message = disabled ? undefined : (dismissState.message ?? confirmState.message);
  const error = disabled ? undefined : (dismissState.error ?? confirmState.error);

  return (
    <div className={styles.actionForms} data-recurring-resolving={disabled ? "true" : undefined}>
      <form
        action={confirmAction}
        onSubmit={(event) => {
          if (isDemo) event.preventDefault();
        }}
      >
        {candidateId ? <input name="candidateId" type="hidden" value={candidateId} /> : null}
        {recurringExpenseId ? <input name="recurringExpenseId" type="hidden" value={recurringExpenseId} /> : null}
        <button
          aria-label={`Confirm ${merchant} as recurring`}
          className={styles.primaryButton}
          disabled={disabled}
          type="submit"
        >
          <Check size={14} aria-hidden />
          {isDemo ? "Read-only demo" : confirming ? "Confirming..." : "Confirm"}
        </button>
      </form>

      <form
        action={dismissAction}
        onSubmit={(event) => {
          if (isDemo) event.preventDefault();
        }}
      >
        {candidateId ? <input name="candidateId" type="hidden" value={candidateId} /> : null}
        {recurringExpenseId ? <input name="recurringExpenseId" type="hidden" value={recurringExpenseId} /> : null}
        <button
          aria-label={`Dismiss ${merchant} recurring candidate`}
          className={styles.secondaryButton}
          disabled={disabled}
          type="submit"
        >
          <X size={14} aria-hidden />
          {isDemo ? "Read-only demo" : dismissing ? "Dismissing..." : "Dismiss"}
        </button>
      </form>

      {isDemo ? (
        <div className={styles.inlineMessage} role="status" aria-live="polite">
          Demo recurring actions are read-only. Sign in to confirm or dismiss real recurring rows.
        </div>
      ) : null}
      {error ? (
        <div className={styles.inlineError} role="alert" aria-live="assertive">
          {error}
        </div>
      ) : null}
      {message && !error ? (
        <div className={styles.inlineMessage} role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
    </div>
  );
}
