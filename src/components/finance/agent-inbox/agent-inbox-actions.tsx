"use client";

import { Check, ExternalLink, Link2, Tag, X } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import {
  acceptReviewSuggestionAction,
  dismissReviewItemAction,
  type ReviewActionState
} from "@/components/finance/review/actions";
import {
  acceptMonthlyBudgetProposalAction,
  acceptReimbursementCandidateProposalAction,
  dismissAgentProposalAction,
  linkReimbursementMatchProposalAction,
  markUnmatchedReimbursementProposalAction,
  type AgentProposalActionState
} from "./actions";
import styles from "./agent-inbox.module.css";

interface AgentInboxActionsProps {
  canApprove: boolean;
  isDemo: boolean;
  reviewItemId: string;
  transactionLabel: string;
  transactionId: string;
}

const initialState: ReviewActionState = {};
const proposalInitialState: AgentProposalActionState = {};

export function AgentInboxActions({
  canApprove,
  isDemo,
  reviewItemId,
  transactionLabel,
  transactionId
}: AgentInboxActionsProps) {
  const [approveState, approveAction, approving] = useActionState(acceptReviewSuggestionAction, initialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissReviewItemAction, initialState);

  return (
    <div className={styles.actionRow} data-proposal-resolving={approving ? "true" : undefined}>
      {canApprove && isDemo ? (
        <>
          <button className={styles.primaryButton} disabled type="button">
            <Check size={14} aria-hidden />
            Read-only demo
          </button>
          <button className={styles.secondaryButton} disabled type="button">
            <X size={14} aria-hidden />
            Read-only demo
          </button>
        </>
      ) : null}

      {canApprove && !isDemo ? (
        <form action={approveAction}>
          <input name="reviewItemId" type="hidden" value={reviewItemId} />
          <button className={styles.primaryButton} disabled={approving || dismissing} type="submit">
            <Check size={14} aria-hidden />
            {approving ? "Approving..." : "Approve"}
          </button>
        </form>
      ) : null}

      {canApprove && !isDemo ? (
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

      {isDemo && canApprove ? (
        <div className={styles.demoActionNote}>
          Demo proposal actions are read-only. Sign in to approve or dismiss real finance changes.
        </div>
      ) : null}
    </div>
  );
}

export function ReimbursementMatchActions({
  isDemo,
  proposalId,
  transactionId
}: {
  isDemo: boolean;
  proposalId: string;
  transactionId: string;
}) {
  const [linkState, linkAction, linking] = useActionState(linkReimbursementMatchProposalAction, proposalInitialState);
  const [markState, markAction, marking] = useActionState(markUnmatchedReimbursementProposalAction, proposalInitialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissAgentProposalAction, proposalInitialState);
  const busy = linking || marking || dismissing;

  return (
    <div className={styles.actionRow} data-proposal-resolving={linking || marking ? "true" : undefined}>
      {isDemo ? (
        <>
          <button className={styles.primaryButton} disabled type="button">
            <Link2 size={14} aria-hidden />
            Read-only demo
          </button>
          <button className={styles.secondaryButton} disabled type="button">
            <Tag size={14} aria-hidden />
            Read-only demo
          </button>
          <button className={styles.secondaryButton} disabled type="button">
            <X size={14} aria-hidden />
            Read-only demo
          </button>
        </>
      ) : null}

      {!isDemo ? (
        <form action={linkAction}>
          <input name="proposalId" type="hidden" value={proposalId} />
          <button className={styles.primaryButton} disabled={busy} type="submit">
            <Link2 size={14} aria-hidden />
            {linking ? "Linking..." : "Link"}
          </button>
        </form>
      ) : null}

      {!isDemo ? (
        <form action={markAction}>
          <input name="proposalId" type="hidden" value={proposalId} />
          <input name="transactionId" type="hidden" value={transactionId} />
          <input name="restoredIntent" type="hidden" value="personal" />
          <button className={styles.secondaryButton} disabled={busy} type="submit">
            <Tag size={14} aria-hidden />
            {marking ? "Marking..." : "Mark unmatched"}
          </button>
        </form>
      ) : null}

      {!isDemo ? (
        <form action={dismissAction}>
          <input name="proposalId" type="hidden" value={proposalId} />
          <input name="feedbackReason" type="hidden" value="not_reimbursement" />
          <button className={styles.secondaryButton} disabled={busy} type="submit">
            <X size={14} aria-hidden />
            {dismissing ? "Dismissing..." : "Dismiss"}
          </button>
        </form>
      ) : null}

      <Link
        className={styles.iconLink}
        href={`/transactions/${transactionId}`}
        aria-label="Open reimbursement inflow transaction"
      >
        <ExternalLink size={14} aria-hidden />
      </Link>

      {linkState.error || markState.error || dismissState.error ? (
        <div className={styles.inlineError} role="alert">
          {linkState.error ?? markState.error ?? dismissState.error}
        </div>
      ) : null}

      {isDemo ? (
        <div className={styles.demoActionNote}>
          Demo proposal actions are read-only. Sign in to link, mark, or dismiss real reimbursement matches.
        </div>
      ) : null}
    </div>
  );
}

export function MonthlyBudgetActions({
  isDemo,
  monthLabel,
  proposalId
}: {
  isDemo: boolean;
  monthLabel: string;
  proposalId: string;
}) {
  const [acceptState, acceptAction, accepting] = useActionState(acceptMonthlyBudgetProposalAction, proposalInitialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissAgentProposalAction, proposalInitialState);
  const busy = accepting || dismissing;

  return (
    <div className={styles.actionRow}>
      {isDemo ? (
        <button className={styles.primaryButton} disabled type="button">
          <Check size={14} aria-hidden />
          Read-only demo
        </button>
      ) : (
        <form action={acceptAction}>
          <input name="proposalId" type="hidden" value={proposalId} />
          <button className={styles.primaryButton} disabled={busy} type="submit">
            <Check size={14} aria-hidden />
            {accepting ? "Confirming..." : `Confirm ${monthLabel} budget`}
          </button>
        </form>
      )}

      {isDemo ? (
        <button className={styles.secondaryButton} disabled type="button">
          <X size={14} aria-hidden />
          Read-only demo
        </button>
      ) : (
        <form action={dismissAction}>
          <input name="proposalId" type="hidden" value={proposalId} />
          <input name="feedbackReason" type="hidden" value="budget_not_wanted" />
          <button className={styles.secondaryButton} disabled={busy} type="submit">
            <X size={14} aria-hidden />
            {dismissing ? "Dismissing..." : "Dismiss"}
          </button>
        </form>
      )}

      {acceptState.error || dismissState.error ? (
        <div className={styles.inlineError} role="alert">
          {acceptState.error ?? dismissState.error}
        </div>
      ) : null}

      {isDemo ? (
        <div className={styles.demoActionNote}>
          Demo proposal actions are read-only. Sign in to confirm a real monthly budget.
        </div>
      ) : null}
    </div>
  );
}

export function ReimbursementCandidateActions({
  isDemo,
  proposalId,
  transactionId
}: {
  isDemo: boolean;
  proposalId: string;
  transactionId: string;
}) {
  const [acceptState, acceptAction, accepting] = useActionState(acceptReimbursementCandidateProposalAction, proposalInitialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissAgentProposalAction, proposalInitialState);
  const busy = accepting || dismissing;

  return (
    <div className={styles.actionRow}>
      {isDemo ? (
        <button className={styles.primaryButton} disabled type="button">
          <Check size={14} aria-hidden />
          Read-only demo
        </button>
      ) : (
        <form action={acceptAction}>
          <input name="proposalId" type="hidden" value={proposalId} />
          <input name="transactionId" type="hidden" value={transactionId} />
          <button className={styles.primaryButton} disabled={busy} type="submit">
            <Check size={14} aria-hidden />
            {accepting ? "Marking..." : "Mark reimbursable"}
          </button>
        </form>
      )}

      <Link className={styles.secondaryButton} href={`/transactions/${transactionId}`}>
        <ExternalLink size={14} aria-hidden />
        Open transaction
      </Link>

      {isDemo ? (
        <button className={styles.secondaryButton} disabled type="button">
          <X size={14} aria-hidden />
          Read-only demo
        </button>
      ) : (
        <form action={dismissAction} className={styles.dismissFeedbackForm}>
          <input name="proposalId" type="hidden" value={proposalId} />
          <select
            aria-label="Dismiss reason"
            className={styles.feedbackSelect}
            defaultValue="not_reimbursement"
            name="feedbackReason"
          >
            <option value="not_reimbursement">Not reimbursed</option>
            <option value="bad_amount">Bad amount</option>
            <option value="bad_date">Bad date</option>
            <option value="wrong_counterparty">Wrong person</option>
            <option value="duplicate_or_reused_inflow">Duplicate inflow</option>
            <option value="merchant_refund_or_income">Refund or income</option>
          </select>
          <button className={styles.secondaryButton} disabled={busy} type="submit">
            <X size={14} aria-hidden />
            {dismissing ? "Dismissing..." : "Dismiss"}
          </button>
        </form>
      )}

      {acceptState.error || dismissState.error ? (
        <div className={styles.inlineError} role="alert">
          {acceptState.error ?? dismissState.error}
        </div>
      ) : null}

      {isDemo ? (
        <div className={styles.demoActionNote}>
          Demo proposal actions are read-only. Sign in to dismiss real reimbursement candidates.
        </div>
      ) : null}
    </div>
  );
}
