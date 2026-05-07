"use client";

import { useActionState } from "react";
import { ArrowRight, GraduationCap, Plus } from "lucide-react";
import Link from "next/link";
import type { CategoryRecord } from "@/lib/db";
import { createCategoryAction, type CategoryActionState } from "./actions";
import styles from "./settings.module.css";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const initialState: CategoryActionState = {};

export interface CategorySpendingRow {
  amount: number;
  categoryId: string | null;
  categoryName: string;
  color: string | null;
  count: number;
  href: string;
}

interface CategoryManagerProps {
  categories: CategoryRecord[];
  spendingRows: CategorySpendingRow[];
}

export function CategoryManager({ categories, spendingRows }: CategoryManagerProps) {
  const [state, formAction, isPending] = useActionState(createCategoryAction, initialState);
  const hasEducation = categories.some((category) => category.name.toLowerCase() === "education");
  const maxAmount = Math.max(...spendingRows.map((row) => row.amount), 1);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.eyebrow}>Categories</div>
          <h2>Spending categories</h2>
        </div>
        <span className={styles.progressPill}>{categories.length.toLocaleString("en-US")} saved</span>
      </div>

      <div className={styles.categoryTools}>
        <form action={formAction} className={styles.categoryQuickForm}>
          <input name="categoryName" type="hidden" defaultValue="Education" />
          <input name="color" type="hidden" defaultValue="#435fb6" />
          <input name="icon" type="hidden" defaultValue="graduation-cap" />
          <button className={styles.primaryButton} disabled={hasEducation || isPending} type="submit">
            <GraduationCap size={14} aria-hidden />
            {hasEducation ? "Education ready" : "Add Education"}
          </button>
        </form>

        <form action={formAction} className={styles.categoryForm}>
          <label className={styles.field}>
            <span>Name</span>
            <input
              className={styles.inputControl}
              maxLength={80}
              name="categoryName"
              placeholder="Custom category"
              required
              type="text"
            />
          </label>
          <label className={styles.field}>
            <span>Color</span>
            <input className={styles.colorControl} defaultValue="#2f6f4e" name="color" type="color" />
          </label>
          <input name="icon" type="hidden" defaultValue="tag" />
          <button className={styles.secondaryButton} disabled={isPending} type="submit">
            <Plus size={14} aria-hidden />
            Create
          </button>
        </form>

        {state.error ? (
          <div className={styles.inlineError} role="alert">{state.error}</div>
        ) : state.message ? (
          <div className={styles.inlineNotice} role="status">{state.message}</div>
        ) : null}
      </div>

      <div className={styles.categorySpendList}>
        {spendingRows.length === 0 ? (
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingTitle}>No spending categories yet</div>
              <div className={styles.settingSub}>Categories appear here once transactions are loaded.</div>
            </div>
          </div>
        ) : (
          spendingRows.map((row) => {
            const width = `${Math.max(3, Math.round((row.amount / maxAmount) * 100))}%`;
            return (
              <Link className={styles.categorySpendRow} href={row.href} key={`${row.categoryId ?? row.categoryName}`}>
                <span
                  className={styles.categoryDot}
                  style={{ backgroundColor: row.color ?? "var(--muted-2)" }}
                  aria-hidden
                />
                <div className={styles.categorySpendCopy}>
                  <div className={styles.categorySpendTop}>
                    <span className={styles.settingTitle}>{row.categoryName}</span>
                    <strong>{moneyFormatter.format(row.amount)}</strong>
                  </div>
                  <div className={styles.spendBar} aria-hidden>
                    <span className={styles.spendBarFill} style={{ width }} />
                  </div>
                  <div className={styles.settingSub}>
                    {row.count.toLocaleString("en-US")} {row.count === 1 ? "transaction" : "transactions"} this month
                  </div>
                </div>
                <ArrowRight className={styles.categoryArrow} size={14} aria-hidden />
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
