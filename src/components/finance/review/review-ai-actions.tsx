"use client";

import { Sparkles } from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  generateAiReviewSuggestionsAction,
  type ReviewActionState
} from "./actions";
import styles from "./review.module.css";

const initialState: ReviewActionState = {};
const AI_CLEANUP_BATCH_LIMIT = 8;

export function ReviewAiActions({
  disabled,
  eligibleCount
}: {
  disabled: boolean;
  eligibleCount: number;
}) {
  const [state, action, pending] = useActionState(generateAiReviewSuggestionsAction, initialState);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const batchSize = useMemo(
    () => Math.min(Math.max(eligibleCount, 0), AI_CLEANUP_BATCH_LIMIT),
    [eligibleCount]
  );

  useEffect(() => {
    if (!pending) return undefined;

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [pending]);

  return (
    <form action={action} aria-busy={pending} className={styles.aiCleanupForm} onSubmit={() => setElapsedSeconds(0)}>
      <input name="limit" type="hidden" value={AI_CLEANUP_BATCH_LIMIT} />
      <button className={styles.primaryButton} disabled={disabled || pending} type="submit">
        <Sparkles size={14} aria-hidden />
        {pending ? "Running cleanup..." : "Generate AI cleanup"}
      </button>
      {pending ? (
        <div className={styles.aiCleanupProgress} role="status" aria-live="polite">
          <div className={styles.aiCleanupProgressMeta}>
            <strong>OpenAI cleanup is running</strong>
            <span>{elapsedSeconds > 0 ? `${elapsedSeconds}s` : "Starting"}</span>
          </div>
          <div className={styles.aiCleanupProgressTrack} aria-hidden>
            <span />
          </div>
          <p>
            Checking up to {batchSize.toLocaleString("en-US")} review {batchSize === 1 ? "item" : "items"}.
            Keep this tab open while the safe items are suggested and auto-applied.
          </p>
        </div>
      ) : null}
      {!pending && state.message ? <span className={styles.inlineSuccess}>{state.message}</span> : null}
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}
