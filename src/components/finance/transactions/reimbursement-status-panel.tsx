"use client";

import {
  updateReimbursementStatusAction,
  type ReimbursementLinkActionState
} from "@/app/(app)/transactions/actions";
import type { ReimbursementRecord, ReimbursementStatus, TransactionRecord } from "@/lib/db";
import { RotateCcw, Send, XCircle, type LucideIcon } from "lucide-react";
import { useActionState } from "react";
import styles from "./transactions.module.css";

interface ReimbursementStatusPanelProps {
  isDemo: boolean;
  transaction: TransactionRecord;
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const initialState: ReimbursementLinkActionState = {};

const statusLabels: Record<ReimbursementStatus, string> = {
  expected: "Expected",
  received: "Received",
  requested: "Requested",
  "written-off": "Written off"
};

type ManualStatus = "expected" | "requested" | "written-off";

interface StatusActionConfig {
  icon: LucideIcon;
  label: string;
  pendingLabel: string;
  status: ManualStatus;
  variant: "primary" | "secondary";
}

function formatMoney(value: number) {
  return moneyFormatter.format(Math.abs(value));
}

function availableActions(status: ReimbursementStatus): StatusActionConfig[] {
  switch (status) {
    case "expected":
      return [
        { icon: Send, label: "Mark requested", pendingLabel: "Saving...", status: "requested", variant: "primary" },
        { icon: XCircle, label: "Write off", pendingLabel: "Saving...", status: "written-off", variant: "secondary" }
      ];
    case "requested":
      return [
        { icon: RotateCcw, label: "Reopen as expected", pendingLabel: "Saving...", status: "expected", variant: "secondary" },
        { icon: XCircle, label: "Write off", pendingLabel: "Saving...", status: "written-off", variant: "secondary" }
      ];
    case "written-off":
      return [
        { icon: RotateCcw, label: "Reopen as expected", pendingLabel: "Saving...", status: "expected", variant: "primary" }
      ];
    case "received":
      return [];
  }
}

function StatusActionForm({ action, isDemo, reimbursement }: {
  action: StatusActionConfig;
  isDemo: boolean;
  reimbursement: ReimbursementRecord;
}) {
  const [state, formAction, isPending] = useActionState(updateReimbursementStatusAction, initialState);
  const Icon = action.icon;

  return (
    <form
      action={formAction}
      aria-label={`${action.label} reimbursement`}
      onSubmit={(event) => {
        if (isDemo) event.preventDefault();
      }}
    >
      <input name="reimbursementId" type="hidden" value={reimbursement.id} />
      <input name="status" type="hidden" value={action.status} />
      <button
        className={action.variant === "primary" ? styles.primaryButton : styles.secondaryButton}
        disabled={isDemo || isPending}
        type="submit"
      >
        <Icon size={14} aria-hidden />
        {isDemo ? "Preview only" : isPending ? action.pendingLabel : action.label}
      </button>
      {state.error ? <div className={styles.formError} role="alert">{state.error}</div> : null}
      {state.message ? <div className={styles.formSuccess} role="status">{state.message}</div> : null}
    </form>
  );
}

export function ReimbursementStatusPanel({ isDemo, transaction }: ReimbursementStatusPanelProps) {
  const records = transaction.reimbursements;
  if (records.length === 0) return null;

  return (
    <section className={styles.reimbursementPanel} aria-label="Reimbursement lifecycle">
      <div className={styles.reimbursementPanelHeader}>
        <span>Reimbursement lifecycle</span>
        <strong>Track expected, requested, and written-off reimbursements</strong>
        <p>
          Mark a reimbursement as requested when you have asked for the money back, or write it off when you no longer
          expect repayment. Received status is set automatically when you link an inflow.
        </p>
      </div>

      {isDemo ? (
        <div className={styles.formSuccess} role="status">
          Demo mode shows lifecycle controls as preview-only and does not call reimbursement write actions.
        </div>
      ) : null}

      <div className={styles.reimbursementStack}>
        {records.map((reimbursement) => {
          const actions = availableActions(reimbursement.status);
          return (
            <div key={reimbursement.id} className={styles.reimbursementStatusCard}>
              <div className={styles.reimbursementOptionCopy}>
                <strong>
                  {reimbursement.counterparty ? `${reimbursement.counterparty} · ` : ""}
                  {formatMoney(reimbursement.expectedAmount)} expected · {statusLabels[reimbursement.status]}
                </strong>
                <span>
                  {formatMoney(reimbursement.receivedAmount)} received of {formatMoney(reimbursement.expectedAmount)} expected
                  {reimbursement.notes ? ` · ${reimbursement.notes}` : ""}
                </span>
              </div>
              {actions.length > 0 ? (
                <div className={styles.reimbursementStatusActions}>
                  {actions.map((action) => (
                    <StatusActionForm key={action.status} action={action} isDemo={isDemo} reimbursement={reimbursement} />
                  ))}
                </div>
              ) : (
                <div className={styles.reimbursementEmpty}>
                  Linked to a received inflow. Unlink it from the received transaction to change the status.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
