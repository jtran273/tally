import type { AccountRecord, CategoryRecord } from "@/lib/db";
import { Download, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import {
  transactionIntentOptions,
  transactionLimitOptions,
  transactionReviewOptions,
  type TransactionFilterState
} from "./filters";
import styles from "./transactions.module.css";

interface TransactionFiltersProps {
  accounts: AccountRecord[];
  categories: CategoryRecord[];
  filters: TransactionFilterState;
}

function exportHref(filters: TransactionFilterState) {
  const params = new URLSearchParams();

  if (filters.search) params.set("q", filters.search);
  if (filters.month) params.set("month", filters.month);
  if (filters.fromDate) params.set("from", filters.fromDate);
  if (filters.toDate) params.set("to", filters.toDate);
  if (filters.accountId !== "all") params.set("account", filters.accountId);
  if (filters.categoryId !== "all") params.set("category", filters.categoryId);
  if (filters.intent !== "all") params.set("intent", filters.intent);
  if (filters.reviewStatus !== "all") params.set("review", filters.reviewStatus);
  if (filters.excludeTransfers) params.set("exclude_transfers", "1");
  params.set("limit", String(filters.limit));

  const query = params.toString();
  return `/api/export/transactions${query ? `?${query}` : ""}`;
}

export function TransactionFilters({ accounts, categories, filters }: TransactionFiltersProps) {
  return (
    <form action="/transactions" className={styles.filters}>
      <label className={`${styles.field} ${styles.searchField}`}>
        <span>Merchant</span>
        <div className={styles.textControl}>
          <Search size={14} aria-hidden />
          <input
            defaultValue={filters.search}
            name="q"
            placeholder="Search merchant, raw name, category, note..."
            type="search"
          />
        </div>
      </label>

      <label className={styles.field}>
        <span>Month</span>
        <input className={styles.inputControl} defaultValue={filters.month} name="month" type="month" />
      </label>

      <label className={styles.field}>
        <span>From</span>
        <input className={styles.inputControl} defaultValue={filters.fromDate} name="from" type="date" />
      </label>

      <label className={styles.field}>
        <span>To</span>
        <input className={styles.inputControl} defaultValue={filters.toDate} name="to" type="date" />
      </label>

      <label className={styles.field}>
        <span>Account</span>
        <select className={styles.selectControl} defaultValue={filters.accountId} name="account">
          <option value="all">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}{account.mask ? ` - ${account.mask}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Category</span>
        <select className={styles.selectControl} defaultValue={filters.categoryId} name="category">
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Intent</span>
        <select className={styles.selectControl} defaultValue={filters.intent} name="intent">
          {transactionIntentOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Review</span>
        <select className={styles.selectControl} defaultValue={filters.reviewStatus} name="review">
          {transactionReviewOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Rows</span>
        <select className={styles.selectControl} defaultValue={String(filters.limit)} name="limit">
          {transactionLimitOptions.map((limit) => (
            <option key={limit} value={limit}>{limit}</option>
          ))}
        </select>
      </label>

      <label className={styles.checkboxField}>
        <input defaultChecked={filters.excludeTransfers} name="exclude_transfers" type="checkbox" value="1" />
        <span>Exclude transfers</span>
      </label>

      <div className={styles.filterActions}>
        <button className={styles.primaryButton} type="submit">
          <SlidersHorizontal size={14} aria-hidden />
          Apply
        </button>
        <Link className={styles.secondaryButton} href={exportHref(filters)} prefetch={false}>
          <Download size={14} aria-hidden />
          Export CSV
        </Link>
        {filters.hasActiveFilters ? (
          <Link className={styles.secondaryButton} href="/transactions">
            <X size={14} aria-hidden />
            Reset
          </Link>
        ) : null}
      </div>
    </form>
  );
}
