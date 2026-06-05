"use client";

import {
  linkReimbursementAction,
  markUnmatchedReimbursementIncomeAction,
  unlinkReimbursementAction,
  type ReimbursementLinkActionState
} from "@/app/(app)/transactions/actions";
import type { ReimbursementRecord, TransactionIntent, TransactionRecord } from "@/lib/db";
import { isUnmatchedReimbursementIncome } from "@/lib/finance/reimbursements";
import { HandCoins, Link2Off } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import styles from "./transactions.module.css";

export interface ReimbursementLinkOption {
  reimbursement: ReimbursementRecord;
  sourceTransaction: Pick<TransactionRecord, "date" | "id" | "merchant" | "amount">;
}

interface ReimbursementLinkPanelProps {
  isDemo: boolean;
  linkedReceivedReimbursements: ReimbursementLinkOption[];
  linkOptions: ReimbursementLinkOption[];
  transaction: TransactionRecord;
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const initialState: ReimbursementLinkActionState = {};
const restoredIntentOptions: Array<{ label: string; value: TransactionIntent }> = [
  { label: "Personal income", value: "personal" },
  { label: "Business income", value: "business" },
  { label: "Shared / peer-to-peer", value: "shared" }
];

function formatMoney(value: number) {
  return moneyFormatter.format(Math.abs(value));
}

function outstandingAmount(reimbursement: ReimbursementRecord) {
  return Math.round(Math.max(0, reimbursement.expectedAmount - reimbursement.receivedAmount) * 100) / 100;
}

function defaultAppliedAmount(transaction: TransactionRecord, reimbursement: ReimbursementRecord) {
  return Math.min(Math.abs(transaction.amount), outstandingAmount(reimbursement)).toFixed(2);
}

function optionLabel(option: ReimbursementLinkOption) {
  const counterparty = option.reimbursement.counterparty ? ` · ${option.reimbursement.counterparty}` : "";
  return `${option.sourceTransaction.merchant}${counterparty} · ${formatMoney(outstandingAmount(option.reimbursement))} outstanding`;
}

function LinkReimbursementForm({ isDemo, option, transaction }: {
  isDemo: boolean;
  option: ReimbursementLinkOption;
  transaction: TransactionRecord;
}) {
  const [state, formAction, isPending] = useActionState(linkReimbursementAction, initialState);
  const outstanding = outstandingAmount(option.reimbursement);

  return (
    <form
      action={formAction}
      aria-label={`Link ${transaction.merchant} to ${option.sourceTransaction.merchant} reimbursement`}
      className={styles.reimbursementLinkForm}
      onSubmit={(event) => {
        if (isDemo) event.preventDefault();
      }}
    >
      <input name="receivedTransactionId" type="hidden" value={transaction.id} />
      <input name="reimbursementId" type="hidden" value={option.reimbursement.id} />
      <div className={styles.reimbursementOptionCopy}>
        <strong>{optionLabel(option)}</strong>
        <span>
          From <Link href={`/transactions/${option.sourceTransaction.id}`}>{option.sourceTransaction.date}</Link>
          {" · "}{formatMoney(option.reimbursement.receivedAmount)} already received of {formatMoney(option.reimbursement.expectedAmount)} expected
        </span>
      </div>
      <label className={styles.field}>
        <span>Amount to apply</span>
        <input
          className={styles.inputControl}
          defaultValue={defaultAppliedAmount(transaction, option.reimbursement)}
          inputMode="decimal"
          max={Math.min(transaction.amount, outstanding)}
          min="0.01"
          name="appliedAmount"
          step="0.01"
          type="number"
        />
      </label>
      {state.error ? <div className={styles.formError} role="alert">{state.error}</div> : null}
      {state.message ? <div className={styles.formSuccess} role="status">{state.message}</div> : null}
      <button className={styles.primaryButton} disabled={isDemo || isPending} type="submit">
        <HandCoins size={14} aria-hidden />
        {isDemo ? "Preview only" : isPending ? "Linking..." : "Link inflow"}
      </button>
    </form>
  );
}

function UnlinkReimbursementForm({ isDemo, option }: { isDemo: boolean; option: ReimbursementLinkOption }) {
  const [state, formAction, isPending] = useActionState(unlinkReimbursementAction, initialState);

  return (
    <form
      action={formAction}
      aria-label={`Unlink reimbursement from ${option.sourceTransaction.merchant}`}
      className={styles.reimbursementLinkForm}
      onSubmit={(event) => {
        if (isDemo) event.preventDefault();
      }}
    >
      <input name="reimbursementId" type="hidden" value={option.reimbursement.id} />
      <div className={styles.reimbursementOptionCopy}>
        <strong>{option.sourceTransaction.merchant} reimbursement linked</strong>
        <span>
          {formatMoney(option.reimbursement.receivedAmount)} received against {formatMoney(option.reimbursement.expectedAmount)} expected.
          Unlinking restores the reimbursement to outstanding.
        </span>
      </div>
      <label className={styles.field}>
        <span>Restore inflow intent</span>
        <select className={styles.selectControl} defaultValue="personal" name="restoredReceivedTransactionIntent">
          {restoredIntentOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      {state.error ? <div className={styles.formError} role="alert">{state.error}</div> : null}
      {state.message ? <div className={styles.formSuccess} role="status">{state.message}</div> : null}
      <button className={styles.secondaryButton} disabled={isDemo || isPending} type="submit">
        <Link2Off size={14} aria-hidden />
        {isDemo ? "Preview only" : isPending ? "Unlinking..." : "Unlink reimbursement"}
      </button>
    </form>
  );
}

function UnmatchedReimbursementIncomeForm({
  isDemo,
  isUnmatched,
  transaction
}: {
  isDemo: boolean;
  isUnmatched: boolean;
  transaction: TransactionRecord;
}) {
  const [state, formAction, isPending] = useActionState(markUnmatchedReimbursementIncomeAction, initialState);

  return (
    <form
      action={formAction}
      aria-label={isUnmatched ? "Clear unmatched reimbursement income" : "Mark unmatched reimbursement income"}
      className={styles.reimbursementLinkForm}
      onSubmit={(event) => {
        if (isDemo) event.preventDefault();
      }}
    >
      <input name="transactionId" type="hidden" value={transaction.id} />
      <input name="marked" type="hidden" value={isUnmatched ? "0" : "1"} />
      <div className={styles.reimbursementOptionCopy}>
        <strong>{isUnmatched ? "Unmatched reimbursement income" : "No matching reimbursement record yet"}</strong>
        <span>
          {isUnmatched
            ? "This inflow is excluded from reportable income until it can be linked or reclassified."
            : "Mark this inflow as reimbursement income without linking it to an expected reimbursement record yet."}
        </span>
      </div>
      {isUnmatched ? (
        <label className={styles.field}>
          <span>Restore as</span>
          <select className={styles.selectControl} defaultValue="personal" name="restoredIntent">
            <option value="personal">Personal income</option>
            <option value="business">Business income</option>
          </select>
        </label>
      ) : (
        <input name="restoredIntent" type="hidden" value="personal" />
      )}
      {state.error ? <div className={styles.formError} role="alert">{state.error}</div> : null}
      {state.message ? <div className={styles.formSuccess} role="status">{state.message}</div> : null}
      <button className={isUnmatched ? styles.secondaryButton : styles.primaryButton} disabled={isDemo || isPending} type="submit">
        <HandCoins size={14} aria-hidden />
        {isDemo
          ? "Preview only"
          : isPending
            ? "Saving..."
            : isUnmatched
              ? "Clear unmatched mark"
              : "Mark unmatched"}
      </button>
    </form>
  );
}

export function ReimbursementLinkPanel({
  isDemo,
  linkedReceivedReimbursements,
  linkOptions,
  transaction
}: ReimbursementLinkPanelProps) {
  const isPositiveInflow = transaction.amount > 0;
  const hasExistingLinks = linkedReceivedReimbursements.length > 0;
  const isUnmatched = isUnmatchedReimbursementIncome(transaction);
  const showLinkChoices = isPositiveInflow && linkOptions.length > 0;

  if (!isPositiveInflow && !hasExistingLinks) return null;

  return (
    <section className={styles.reimbursementPanel} aria-label="Reimbursement linking">
      <div className={styles.reimbursementPanelHeader}>
        <span>Reimbursement approval</span>
        <strong>
          {hasExistingLinks
            ? "Linked received inflow"
            : isUnmatched
              ? "Unmatched reimbursement inflow"
              : "Link or mark this positive inflow"}
        </strong>
        <p>
          Match reimbursement income to an existing reimbursement record, or mark it unmatched when the expected record is
          missing. Partial links keep the remaining balance visible; raw provider rows stay unchanged.
        </p>
      </div>

      {isDemo ? (
        <div className={styles.formSuccess} role="status">
          Demo mode shows the approval flow as preview-only and does not call reimbursement write actions.
        </div>
      ) : null}

      {hasExistingLinks ? (
        <div className={styles.reimbursementStack}>
          {linkedReceivedReimbursements.map((option) => (
            <UnlinkReimbursementForm key={option.reimbursement.id} isDemo={isDemo} option={option} />
          ))}
        </div>
      ) : null}

      {isPositiveInflow && !hasExistingLinks ? (
        <div className={styles.reimbursementStack}>
          <UnmatchedReimbursementIncomeForm isDemo={isDemo} isUnmatched={isUnmatched} transaction={transaction} />
        </div>
      ) : null}

      {showLinkChoices ? (
        <div className={styles.reimbursementStack}>
          {linkOptions.map((option) => (
            <LinkReimbursementForm key={option.reimbursement.id} isDemo={isDemo} option={option} transaction={transaction} />
          ))}
        </div>
      ) : isPositiveInflow && !hasExistingLinks ? (
        <div className={styles.reimbursementEmpty}>
          No outstanding reimbursement records are available to link to this inflow.
        </div>
      ) : null}
    </section>
  );
}
