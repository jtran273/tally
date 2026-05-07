"use client";

import { CheckCheck } from "lucide-react";
import { useActionState } from "react";
import type { BulkReviewPlan } from "@/lib/review/bulk-actions";
import { bulkAcceptReviewSuggestionsAction, type ReviewActionState } from "./actions";
import styles from "./review.module.css";

const initialState: ReviewActionState = {};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

function formatMoney(value: number) {
  return moneyFormatter.format(Math.abs(value));
}

function formatBool(value: boolean | null) {
  if (value === null) return "Keep";
  return value ? "Yes" : "No";
}

function formatConfidence(value: number | null) {
  return value === null ? "Keep" : `${Math.round(value * 100)}%`;
}

function compactChange(current: string, suggested: string | null) {
  return suggested ? `${current} -> ${suggested}` : current;
}

export function BulkReviewActions({ plan }: { plan: BulkReviewPlan }) {
  const [state, action, pending] = useActionState(bulkAcceptReviewSuggestionsAction, initialState);
  const previewItems = plan.items.slice(0, 8);
  const hiddenAcceptReady = plan.acceptReady.slice(0, 40);

  return (
    <form action={action} className={styles.bulkReviewForm}>
      <div className={styles.bulkReviewHead}>
        <div>
          <strong>Bulk accept preview</strong>
          <span>
            {plan.acceptReady.length.toLocaleString("en-US")} ready, {plan.skipped.length.toLocaleString("en-US")} skipped
          </span>
        </div>
        <button className={styles.primaryButton} disabled={hiddenAcceptReady.length === 0 || pending} type="submit">
          <CheckCheck size={14} aria-hidden />
          {pending ? "Accepting..." : `Accept ${hiddenAcceptReady.length.toLocaleString("en-US")}`}
        </button>
      </div>

      {hiddenAcceptReady.map((item) => (
        <input name="reviewItemId" type="hidden" value={item.reviewItemId} key={item.reviewItemId} />
      ))}

      <div className={styles.bulkPreviewList} aria-label="Bulk review item preview">
        {previewItems.length === 0 ? (
          <div className={styles.emptySuggestion}>No open review items are available for bulk preview yet.</div>
        ) : null}
        {previewItems.map((item) => (
          <div className={styles.bulkPreviewRow} key={item.reviewItemId}>
            <div>
              <strong>{item.merchantName}</strong>
              <span>{item.date} | {formatMoney(item.amount)}</span>
            </div>
            <div>
              <span>{compactChange(item.preview.current.categoryName, item.preview.suggested.categoryName)}</span>
              <span>{compactChange(item.preview.current.intent, item.preview.suggested.intent)}</span>
              <span>Recurring {formatBool(item.preview.suggested.recurring)}</span>
              <span>Confidence {formatConfidence(item.preview.suggested.confidence)}</span>
            </div>
            <div className={item.status === "accept-ready" ? styles.readyPill : styles.skipPill}>
              {item.status === "accept-ready" ? "Ready" : item.skipReason}
            </div>
          </div>
        ))}
      </div>

      {plan.items.length > previewItems.length ? (
        <span className={styles.bulkReviewFoot}>
          Showing {previewItems.length.toLocaleString("en-US")} of {plan.items.length.toLocaleString("en-US")} open review items.
        </span>
      ) : null}
      {state.message ? <span className={styles.inlineSuccess}>{state.message}</span> : null}
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}
