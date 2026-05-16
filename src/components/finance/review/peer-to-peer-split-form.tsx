"use client";

import type { CategoryRecord, TransactionRecord } from "@/lib/db";
import {
  categoryOptionGroups,
  displayTransactionIntent,
  isTransferCategoryName,
  primaryCategoryIdForId,
  transactionIntentFromUi,
  transactionTagFromIntent,
  transactionTagOptions,
  userTransactionIntentOptions,
  type TransactionTag,
  type UserTransactionIntent
} from "@/lib/finance/classification";
import type { NormalizedReviewSuggestion } from "@/lib/review/suggestions";
import { Check, Plus, Trash2 } from "lucide-react";
import { useActionState, useMemo, useState, useSyncExternalStore } from "react";
import {
  resolvePeerToPeerReviewAction,
  type ReviewActionState
} from "./actions";
import styles from "./review.module.css";

interface PeerToPeerSplitFormProps {
  categories: CategoryRecord[];
  defaultExplanation: string;
  isDemo: boolean;
  reviewItemId: string;
  suggestion: NormalizedReviewSuggestion;
  transaction: TransactionRecord;
}

interface SplitRowState {
  amount: string;
  baseIntent: UserTransactionIntent;
  categoryId: string;
  id: string;
  label: string;
  notes: string;
  tag: TransactionTag;
}

const initialState: ReviewActionState = {};
const mobileViewportQuery = "(max-width: 760px)";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

function formatAmountInput(value: number) {
  return Math.abs(value).toFixed(2);
}

function amountToCents(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.abs(parsed) * 100);
}

function formatMoneyFromCents(cents: number) {
  return moneyFormatter.format(cents / 100);
}

function subscribeToMobileViewport(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const mediaQuery = window.matchMedia(mobileViewportQuery);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getMobileViewportSnapshot() {
  return typeof window !== "undefined" && window.matchMedia(mobileViewportQuery).matches;
}

function getServerMobileViewportSnapshot() {
  return false;
}

function findCategoryId(categories: CategoryRecord[], categoryName: string | undefined) {
  if (!categoryName) return null;
  if (isTransferCategoryName(categoryName)) return null;

  const normalized = categoryName.trim().toLowerCase();
  return categories.find((category) => category.name.trim().toLowerCase() === normalized)?.id ?? null;
}

function defaultCategoryId(
  categories: CategoryRecord[],
  suggestion: NormalizedReviewSuggestion,
  transaction: TransactionRecord
) {
  const suggestedCategoryId = suggestion.categoryId && categories.some((category) => category.id === suggestion.categoryId)
    ? suggestion.categoryId
    : findCategoryId(categories, suggestion.categoryName);

  return primaryCategoryIdForId(suggestedCategoryId, categories) ??
    (isTransferCategoryName(transaction.category) ? null : primaryCategoryIdForId(transaction.categoryId, categories)) ??
    categories.find((category) => category.name === "Uncategorized")?.id ??
    "none";
}

function defaultBaseIntent(suggestion: NormalizedReviewSuggestion, transaction: TransactionRecord): UserTransactionIntent {
  const intent = suggestion.intent ?? transaction.intent;
  return displayTransactionIntent(intent);
}

function defaultTag(suggestion: NormalizedReviewSuggestion, transaction: TransactionRecord): TransactionTag {
  return transactionTagFromIntent(suggestion.intent ?? transaction.intent);
}

function buildInitialRows({
  categories,
  suggestion,
  transaction
}: Pick<PeerToPeerSplitFormProps, "categories" | "suggestion" | "transaction">): SplitRowState[] {
  if (transaction.splits.length > 0) {
    return transaction.splits.map((split) => ({
      amount: formatAmountInput(split.amount),
      baseIntent: displayTransactionIntent(split.intent),
      categoryId: primaryCategoryIdForId(split.categoryId, categories) ?? "none",
      id: split.id,
      label: split.label,
      notes: split.notes ?? "",
      tag: transactionTagFromIntent(split.intent)
    }));
  }

  return [
    {
      amount: formatAmountInput(transaction.amount),
      baseIntent: defaultBaseIntent(suggestion, transaction),
      categoryId: defaultCategoryId(categories, suggestion, transaction),
      id: "split-initial",
      label: "My share",
      notes: "",
      tag: defaultTag(suggestion, transaction)
    }
  ];
}

export function PeerToPeerSplitForm({
  categories,
  defaultExplanation,
  isDemo,
  reviewItemId,
  suggestion,
  transaction
}: PeerToPeerSplitFormProps) {
  const [state, formAction, isPending] = useActionState(resolvePeerToPeerReviewAction, initialState);
  const [isMobileFormExpanded, setIsMobileFormExpanded] = useState(false);
  const [explanation, setExplanation] = useState(defaultExplanation);
  const [rows, setRows] = useState(() => buildInitialRows({ categories, suggestion, transaction }));
  const totalCents = useMemo(() => amountToCents(String(transaction.amount)), [transaction.amount]);
  const allocatedCents = rows.reduce((sum, row) => sum + amountToCents(row.amount), 0);
  const remainingCents = totalCents - allocatedCents;
  const fullyAllocated = remainingCents === 0;
  const fallbackCategoryId = defaultCategoryId(categories, suggestion, transaction);
  const categoryGroups = categoryOptionGroups(categories);
  const isMobileViewport = useSyncExternalStore(
    subscribeToMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot
  );

  function updateRow(id: string, patch: Partial<SplitRowState>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        amount: formatAmountInput(Math.max(0, remainingCents) / 100),
        categoryId: fallbackCategoryId,
        id: `split-${Date.now()}`,
        baseIntent: "personal",
        label: "New portion",
        notes: "",
        tag: "none"
      }
    ]);
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  if (isMobileViewport && !isMobileFormExpanded) {
    return (
      <div className={styles.peerSummaryPanel} aria-label="Peer-to-peer split editor">
        <div>
          <strong>Split needed</strong>
          <span>{fullyAllocated ? "Fully allocated preview" : `${formatMoneyFromCents(Math.abs(remainingCents))} ${remainingCents > 0 ? "left" : "over"}`}</span>
        </div>
        <button className={styles.secondaryButton} onClick={() => setIsMobileFormExpanded(true)} type="button">
          <Plus size={14} aria-hidden />
          Edit split
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className={styles.peerForm}
      onSubmit={(event) => {
        if (isDemo) event.preventDefault();
      }}
    >
      <input name="reviewItemId" type="hidden" value={reviewItemId} />

      {isDemo ? (
        <div className={styles.inlineSuccess} role="status">
          Peer-to-peer split editing is preview-only in demo mode.
        </div>
      ) : null}

      <label className={styles.field}>
        <span>Explanation</span>
        <textarea
          className={styles.textareaControl}
          maxLength={800}
          name="explanation"
          onChange={(event) => setExplanation(event.target.value)}
          rows={3}
          value={explanation}
        />
      </label>

      <div className={styles.splitHeader}>
        <span>Split rows</span>
        <strong className={fullyAllocated ? styles.allocationOk : styles.allocationWarn}>
          {fullyAllocated ? "Fully allocated" : `${formatMoneyFromCents(Math.abs(remainingCents))} ${remainingCents > 0 ? "left" : "over"}`}
        </strong>
      </div>

      <div className={styles.splitRows}>
        {rows.map((row, index) => (
          <div className={styles.splitRow} key={row.id}>
            <label className={styles.splitLabelField}>
              <span>Label</span>
              <input
                className={styles.inputControl}
                maxLength={80}
                name="splitLabel"
                onChange={(event) => updateRow(row.id, { label: event.target.value })}
                required
                value={row.label}
              />
            </label>

            <label className={styles.splitIntentField}>
              <span>Intent</span>
              <select
                className={styles.selectControl}
                onChange={(event) => updateRow(row.id, { baseIntent: event.target.value as UserTransactionIntent })}
                value={row.baseIntent}
              >
                {userTransactionIntentOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.splitTagField}>
              <span>Tag</span>
              <select
                className={styles.selectControl}
                onChange={(event) => updateRow(row.id, { tag: event.target.value as TransactionTag })}
                value={row.tag}
              >
                {transactionTagOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input name="splitIntent" type="hidden" value={transactionIntentFromUi(row.baseIntent, row.tag)} />
            </label>

            <label className={styles.splitCategoryField}>
              <span>Category</span>
              <select
                className={styles.selectControl}
                name="splitCategoryId"
                onChange={(event) => updateRow(row.id, { categoryId: event.target.value })}
                required
                value={row.categoryId}
              >
                <option value="none">Select category</option>
                {categoryGroups.map((category) => (
                  <option key={category.primaryCategoryId} value={category.primaryCategoryId}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.splitAmountField}>
              <span>Amount</span>
              <input
                className={styles.inputControl}
                min="0.01"
                name="splitAmount"
                onChange={(event) => updateRow(row.id, { amount: event.target.value })}
                required
                step="0.01"
                type="number"
                value={row.amount}
              />
            </label>

            <label className={styles.splitNotesField}>
              <span>Notes</span>
              <input
                className={styles.inputControl}
                maxLength={240}
                name="splitNotes"
                onChange={(event) => updateRow(row.id, { notes: event.target.value })}
                value={row.notes}
              />
            </label>

            <button
              aria-label={`Remove split row ${index + 1}`}
              className={styles.iconButton}
              disabled={rows.length === 1}
              onClick={() => removeRow(row.id)}
              type="button"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>

      {state.error ? (
        <div className={styles.inlineError} role="alert">
          {state.error}
        </div>
      ) : null}
      {state.message ? (
        <div className={styles.inlineSuccess} role="status">
          {state.message}
        </div>
      ) : null}

      <div className={styles.splitActions}>
        <button className={styles.secondaryButton} onClick={addRow} type="button">
          <Plus size={14} aria-hidden />
          Add split
        </button>
        <button
          className={styles.primaryButton}
          disabled={isDemo || isPending || !fullyAllocated || explanation.trim().length < 6}
          type="submit"
        >
          <Check size={14} aria-hidden />
          {isDemo ? "Read-only demo" : isPending ? "Saving..." : "Save and resolve"}
        </button>
      </div>
    </form>
  );
}
