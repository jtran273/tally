"use client";

import { Sparkles } from "lucide-react";
import { useActionState } from "react";
import {
  generateAiReviewSuggestionsAction,
  type ReviewActionState
} from "./actions";
import styles from "./review.module.css";

const initialState: ReviewActionState = {};

export function ReviewAiActions({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(generateAiReviewSuggestionsAction, initialState);

  return (
    <form action={action} className={styles.aiCleanupForm}>
      <input name="limit" type="hidden" value="40" />
      <button className={styles.primaryButton} disabled={disabled || pending} type="submit">
        <Sparkles size={14} aria-hidden />
        {pending ? "Generating..." : "Generate AI cleanup"}
      </button>
      {state.message ? <span className={styles.inlineSuccess}>{state.message}</span> : null}
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}
