"use client";

import { Check, X } from "lucide-react";
import { useActionState } from "react";
import {
  acceptReviewSuggestionAction,
  dismissReviewItemAction,
  type ReviewActionState
} from "./actions";
import styles from "./review.module.css";

interface ReviewItemActionsProps {
  canAccept: boolean;
  canDismiss: boolean;
  reviewItemId: string;
}

const initialState: ReviewActionState = {};

export function ReviewItemActions({ canAccept, canDismiss, reviewItemId }: ReviewItemActionsProps) {
  const [acceptState, acceptAction, accepting] = useActionState(acceptReviewSuggestionAction, initialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissReviewItemAction, initialState);

  return (
    <div className={styles.actionForms}>
      {canAccept ? (
        <form action={acceptAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <button className={styles.primaryButton} disabled={accepting || dismissing} type="submit">
            <Check size={14} aria-hidden />
            {accepting ? "Accepting..." : "Accept suggestion"}
          </button>
        </form>
      ) : null}

      {canDismiss ? (
        <form action={dismissAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <input name="resolutionNote" type="hidden" value="Dismissed from review queue." />
          <button className={styles.secondaryButton} disabled={accepting || dismissing} type="submit">
            <X size={14} aria-hidden />
            {dismissing ? "Dismissing..." : "Dismiss"}
          </button>
        </form>
      ) : null}

      {acceptState.error || dismissState.error ? (
        <div className={styles.inlineError} role="alert">
          {acceptState.error ?? dismissState.error}
        </div>
      ) : null}
    </div>
  );
}
