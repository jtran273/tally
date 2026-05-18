"use client";

import { CheckCircle2, ChevronRight, TriangleAlert } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import {
  bulkAcceptReviewSuggestionsAction,
  type BulkAcceptReviewState
} from "./actions";
import styles from "./bulk-accept-form.module.css";

import type { TransactionIntent } from "@/lib/db";

export interface BulkAcceptCandidate {
  id: string;
  transactionId: string;
  merchant: string;
  amount: number;
  currentCategory: string;
  proposedCategory: string | null;
  proposedMerchant: string | null;
  proposedIntent: TransactionIntent | null;
  confidence: number | null;
}

interface BulkAcceptFormProps {
  candidates: BulkAcceptCandidate[];
  isDemo: boolean;
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

function formatMoney(value: number) {
  const formatted = moneyFormatter.format(Math.abs(value));
  if (value < 0) return `-${formatted}`;
  if (value > 0) return `+${formatted}`;
  return formatted;
}

function formatConfidence(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function BulkAcceptForm({ candidates, isDemo }: BulkAcceptFormProps) {
  const [state, formAction, isPending] = useActionState<BulkAcceptReviewState, FormData>(
    bulkAcceptReviewSuggestionsAction,
    {}
  );
  const allIds = useMemo(() => candidates.map((c) => c.id), [candidates]);
  const initialIdsKey = allIds.join("|");
  const [selectedIdsState, setSelectedIds] = useState<{ key: string; ids: Set<string> }>(() => ({
    key: initialIdsKey,
    ids: new Set(allIds)
  }));
  const selectedIds = selectedIdsState.key === initialIdsKey
    ? selectedIdsState.ids
    : new Set(allIds);
  const [expanded, setExpanded] = useState(false);

  if (candidates.length === 0) return null;

  const allSelected = selectedIds.size === candidates.length;
  const noneSelected = selectedIds.size === 0;

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const baseIds = prev.key === initialIdsKey ? prev.ids : new Set(allIds);
      const next = new Set(baseIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { key: initialIdsKey, ids: next };
    });
  }

  function toggleAll() {
    setSelectedIds({ key: initialIdsKey, ids: allSelected ? new Set() : new Set(allIds) });
  }

  return (
    <section className={styles.panel} aria-label="Bulk accept AI suggestions">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>
            <CheckCircle2 size={13} aria-hidden /> Bulk accept
          </span>
          <h2>{candidates.length} accept-ready suggestion{candidates.length === 1 ? "" : "s"}</h2>
          <p>
            Review the proposed merchant/category/intent below, uncheck anything you&apos;d rather handle one by one,
            then apply them all.
          </p>
        </div>
        <button
          type="button"
          className={styles.expandButton}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRight
            size={14}
            aria-hidden
            className={expanded ? styles.iconOpen : styles.iconClosed}
          />
          {expanded ? "Hide preview" : "Show preview"}
        </button>
      </header>

      <form action={formAction}>
        {expanded ? (
          <div className={styles.previewList}>
            <label className={styles.previewSelectAll}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>{allSelected ? "Deselect all" : "Select all"}</span>
            </label>
            {candidates.map((candidate) => {
              const selected = selectedIds.has(candidate.id);
              return (
                <label key={candidate.id} className={styles.previewRow}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggle(candidate.id)}
                  />
                  {selected ? <input type="hidden" name="reviewItemId" value={candidate.id} /> : null}
                  <div className={styles.previewMain}>
                    <strong>{candidate.merchant}</strong>
                    <span>
                      {candidate.currentCategory}
                      {candidate.proposedCategory ? ` → ${candidate.proposedCategory}` : ""}
                      {candidate.proposedIntent ? ` · ${candidate.proposedIntent}` : ""}
                    </span>
                  </div>
                  <span className={styles.previewMeta}>
                    {formatConfidence(candidate.confidence)}
                  </span>
                  <span className={styles.previewAmount}>{formatMoney(candidate.amount)}</span>
                </label>
              );
            })}
          </div>
        ) : (
          candidates.map((candidate) => (
            <input
              key={candidate.id}
              type="hidden"
              name="reviewItemId"
              value={selectedIds.has(candidate.id) ? candidate.id : ""}
            />
          ))
        )}

        <div className={styles.footer}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={isDemo || isPending || noneSelected}
            aria-busy={isPending}
          >
            {isPending ? "Applying…" : `Accept ${selectedIds.size}`}
          </button>
          {isDemo ? <span className={styles.subMuted}>Demo mode is read-only.</span> : null}
        </div>

        {state.message ? (
          <p className={styles.success} role="status">{state.message}</p>
        ) : null}

        {state.error && !state.message ? (
          <p className={styles.error} role="alert">
            <TriangleAlert size={13} aria-hidden /> {state.error}
          </p>
        ) : null}

        {state.failures && state.failures.length > 0 ? (
          <ul className={styles.failureList}>
            {state.failures.map((failure) => (
              <li key={failure.reviewItemId}>{failure.reason}</li>
            ))}
          </ul>
        ) : null}
      </form>
    </section>
  );
}
