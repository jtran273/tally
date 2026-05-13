"use client";

import { applyMerchantCleanupAction, type MerchantCleanupActionState } from "@/app/(app)/transactions/actions";
import type { CategoryRecord } from "@/lib/db";
import { WandSparkles } from "lucide-react";
import { useActionState, useState } from "react";
import { transactionIntentOptions } from "./filters";
import styles from "./transactions.module.css";

interface MerchantCleanupPanelProps {
  categories: CategoryRecord[];
  defaultQuery: string;
}

const initialState: MerchantCleanupActionState = {};

export function MerchantCleanupPanel({ categories, defaultQuery }: MerchantCleanupPanelProps) {
  const [state, formAction, isPending] = useActionState(applyMerchantCleanupAction, initialState);
  const hasDefaultQuery = defaultQuery.trim().length > 0;
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const expanded = expandedOverride ?? (hasDefaultQuery || Boolean(state.error || state.message));
  const defaultCategory = categories.find((category) => category.name === "Food / Restaurants") ?? categories[0] ?? null;

  return (
    <section className={expanded ? styles.cleanupPanel : `${styles.cleanupPanel} ${styles.cleanupCollapsed}`} aria-label="Merchant cleanup">
      <div className={styles.cleanupHeader}>
        <div>
          <span className={styles.summaryLabel}>
            <WandSparkles size={13} aria-hidden />
            Merchant cleanup
          </span>
          <span>Apply one category and intent to matching merchant rows</span>
        </div>
        <button className={styles.secondaryButton} onClick={() => setExpandedOverride(!expanded)} type="button">
          <WandSparkles size={14} aria-hidden />
          {expanded ? "Hide cleanup" : "Open cleanup"}
        </button>
      </div>
      {expanded ? (
        <>
          <form action={formAction} className={styles.cleanupForm}>
            <label className={styles.field}>
              <span>Match text</span>
              <input
                className={styles.inputControl}
                defaultValue={defaultQuery}
                maxLength={160}
                name="merchantQuery"
                placeholder="McDonald's, Retail Wash..."
                required
              />
            </label>

            <label className={styles.field}>
              <span>Category</span>
              <select className={styles.selectControl} defaultValue={defaultCategory?.id ?? "none"} name="categoryId" required>
                <option value="none">Choose category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>Intent</span>
              <select className={styles.selectControl} defaultValue="personal" name="intent">
                {transactionIntentOptions
                  .filter((option) => option.value !== "all")
                  .map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
              </select>
            </label>

            <label className={styles.checkboxField}>
              <input defaultChecked name="saveRule" type="checkbox" value="1" />
              <span>Save rule</span>
            </label>

            <button className={styles.primaryButton} disabled={isPending || categories.length === 0} type="submit">
              <WandSparkles size={14} aria-hidden />
              {isPending ? "Applying..." : "Apply cleanup"}
            </button>
          </form>

          {state.error ? <div className={styles.formError} role="alert">{state.error}</div> : null}
          {state.message ? <div className={styles.formSuccess} role="status">{state.message}</div> : null}
        </>
      ) : null}
    </section>
  );
}
