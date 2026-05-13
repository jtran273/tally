"use client";

import { Check, Sparkles, X } from "lucide-react";
import { useActionState } from "react";
import {
  acceptReviewSuggestionAction,
  dismissReviewItemAction,
  generateReviewSuggestionAction,
  type ReviewActionState
} from "./actions";
import styles from "./review.module.css";

interface ReviewItemActionsProps {
  canAccept: boolean;
  canDismiss: boolean;
  canSuggest: boolean;
  reviewItemId: string;
}

const initialState: ReviewActionState = {};

export function ReviewItemActions({ canAccept, canDismiss, canSuggest, reviewItemId }: ReviewItemActionsProps) {
  const [acceptState, acceptAction, accepting] = useActionState(acceptReviewSuggestionAction, initialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissReviewItemAction, initialState);
  const [suggestState, suggestAction, suggesting] = useActionState(generateReviewSuggestionAction, initialState);
  const busy = accepting || dismissing || suggesting;

  return (
    <div className={styles.actionForms} data-review-resolving={accepting || dismissing ? "true" : undefined}>
      {canSuggest ? (
        <form action={suggestAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <button className={styles.secondaryButton} disabled={busy} type="submit">
            <Sparkles size={14} aria-hidden />
            {suggesting ? "Suggesting..." : "Suggest with AI"}
          </button>
        </form>
      ) : null}

      {canAccept ? (
        <form action={acceptAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <button className={styles.primaryButton} disabled={busy} type="submit">
            <Check size={14} aria-hidden />
            {accepting ? "Accepting..." : "Accept suggestion"}
          </button>
        </form>
      ) : null}

      {canDismiss ? (
        <form action={dismissAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <input name="resolutionNote" type="hidden" value="Dismissed from review queue." />
          <button className={styles.secondaryButton} disabled={busy} type="submit">
            <X size={14} aria-hidden />
            {dismissing ? "Dismissing..." : "Dismiss"}
          </button>
        </form>
      ) : null}

      {acceptState.error || dismissState.error || suggestState.error ? (
        <div className={styles.inlineError} role="alert">
          {acceptState.error ?? dismissState.error ?? suggestState.error}
        </div>
      ) : null}

      {suggestState.message ? (
        <div className={styles.inlineSuccess} role="status">
          {suggestState.message}
        </div>
      ) : null}
    </div>
  );
}
