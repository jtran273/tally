"use client";

import type { AiSuggestionProviderKind } from "@/lib/ai/types";
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
  aiProviderKind: AiSuggestionProviderKind;
  canAccept: boolean;
  canDismiss: boolean;
  canSuggest: boolean;
  hasSuggestion: boolean;
  isDemo: boolean;
  reviewItemId: string;
}

const initialState: ReviewActionState = {};

function suggestionButtonLabel(providerKind: AiSuggestionProviderKind, hasSuggestion: boolean, suggesting: boolean) {
  if (providerKind === "openai") {
    if (suggesting) return hasSuggestion ? "Refreshing OpenAI..." : "Asking OpenAI...";
    return hasSuggestion ? "Refresh OpenAI suggestion" : "Ask OpenAI";
  }

  if (suggesting) return hasSuggestion ? "Refreshing rules..." : "Checking rules...";
  return hasSuggestion ? "Refresh rules suggestion" : "Run rules suggestion";
}

export function ReviewItemActions({
  aiProviderKind,
  canAccept,
  canDismiss,
  canSuggest,
  hasSuggestion,
  isDemo,
  reviewItemId
}: ReviewItemActionsProps) {
  const [acceptState, acceptAction, accepting] = useActionState(acceptReviewSuggestionAction, initialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissReviewItemAction, initialState);
  const [suggestState, suggestAction, suggesting] = useActionState(generateReviewSuggestionAction, initialState);
  const busy = accepting || dismissing || suggesting;
  const disabled = busy || isDemo;

  return (
    <div className={styles.actionForms} data-review-resolving={accepting || dismissing ? "true" : undefined}>
      {canSuggest ? (
        <form action={suggestAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <button className={styles.secondaryButton} disabled={disabled} type="submit">
            <Sparkles size={14} aria-hidden />
            {isDemo ? "Preview suggestion" : suggestionButtonLabel(aiProviderKind, hasSuggestion, suggesting)}
          </button>
        </form>
      ) : null}

      {canAccept ? (
        <form action={acceptAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <button className={styles.primaryButton} disabled={disabled} type="submit">
            <Check size={14} aria-hidden />
            {isDemo ? "Read-only demo" : accepting ? "Accepting..." : "Accept suggestion"}
          </button>
        </form>
      ) : null}

      {canDismiss ? (
        <form action={dismissAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <input name="resolutionNote" type="hidden" value="Dismissed from review queue." />
          <button className={styles.secondaryButton} disabled={disabled} type="submit">
            <X size={14} aria-hidden />
            {isDemo ? "Read-only demo" : dismissing ? "Dismissing..." : "Dismiss"}
          </button>
        </form>
      ) : null}

      {!busy && (acceptState.error || dismissState.error || suggestState.error) ? (
        <div className={styles.inlineError} role="alert" aria-live="assertive">
          {acceptState.error ?? dismissState.error ?? suggestState.error}
        </div>
      ) : null}

      {!busy && suggestState.message && !suggestState.error ? (
        <div className={styles.inlineSuccess} role="status" aria-live="polite">
          {suggestState.message}
        </div>
      ) : null}

      {isDemo ? (
        <div className={styles.inlineSuccess} role="status" aria-live="polite">
          Demo review actions are read-only. Sign in to generate, accept, or dismiss real review items.
        </div>
      ) : null}
    </div>
  );
}
