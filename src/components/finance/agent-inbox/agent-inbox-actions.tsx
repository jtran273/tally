"use client";

import { Check, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import {
  acceptReviewSuggestionAction,
  dismissReviewItemAction,
  type ReviewActionState
} from "@/components/finance/review/actions";
import styles from "./agent-inbox.module.css";

interface AgentInboxActionsProps {
  canApprove: boolean;
  reviewItemId: string;
  transactionLabel: string;
  transactionId: string;
}

const initialState: ReviewActionState = {};

export function AgentInboxActions({ canApprove, reviewItemId, transactionLabel, transactionId }: AgentInboxActionsProps) {
  const [approveState, approveAction, approving] = useActionState(acceptReviewSuggestionAction, initialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissReviewItemAction, initialState);

  return (
    <div className={styles.actionRow} data-proposal-resolving={approving ? "true" : undefined}>
      {canApprove ? (
        <form action={approveAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <button className={styles.primaryButton} disabled={approving || dismissing} type="submit">
            <Check size={14} aria-hidden />
            {approving ? "Approving..." : "Approve"}
          </button>
        </form>
      ) : null}

      {canApprove ? (
        <form action={dismissAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <input name="resolutionNote" type="hidden" value="Dismissed from agent inbox." />
          <button className={styles.secondaryButton} disabled={approving || dismissing} type="submit">
            <X size={14} aria-hidden />
            {dismissing ? "Dismissing..." : "Dismiss"}
          </button>
        </form>
      ) : null}

      <Link className={styles.secondaryButton} href={`/review#review-${reviewItemId}`}>
        <ExternalLink size={14} aria-hidden />
        Review
      </Link>

      <Link
        className={styles.iconLink}
        href={`/transactions/${transactionId}`}
        aria-label={`Open transaction for ${transactionLabel}`}
      >
        <ExternalLink size={14} aria-hidden />
      </Link>

      {approveState.error || dismissState.error ? (
        <div className={styles.inlineError} role="alert">
          {approveState.error ?? dismissState.error}
        </div>
      ) : null}
    </div>
  );
}
