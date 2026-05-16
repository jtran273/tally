import type { AccountRecord, CategoryRecord } from "@/lib/db";
import {
  categoryOptionGroups,
  displayTransactionIntent,
  transactionTagFromIntent,
  transactionTagLabel
} from "@/lib/finance/classification";
import { Download, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import {
  transactionDirectionOptions,
  transactionFiltersHref,
  transactionReviewOptions,
  type TransactionFilterState
} from "./filters";
import styles from "./transactions.module.css";

interface TransactionFiltersProps {
  accounts: AccountRecord[];
  categories: CategoryRecord[];
  filters: TransactionFilterState;
}

const institutionSuffixes = new Set(["bank", "credit union", "cu", "fcu", "financial", "na", "n.a."]);
const preservedAccountWords = new Set(["ACH", "ATM", "CD", "FCU", "FSA", "HSA", "IRA", "USB"]);

function displayName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return normalized;
  if (/[a-z]/.test(normalized)) return normalized;

  return normalized
    .toLowerCase()
    .replace(/[a-z0-9]+(?:'[a-z0-9]+)?/g, (word) => {
      const upper = word.toUpperCase();
      if (preservedAccountWords.has(upper)) return upper;
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    });
}

function searchableInstitutionName(value: string) {
  return displayName(value)
    .toLowerCase()
    .replace(/[^\w\s.]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !institutionSuffixes.has(word))
    .join(" ");
}

function accountLabel(account: AccountRecord) {
  const accountName = displayName(account.name);
  const institutionName = displayName(account.institutionName);
  if (!institutionName || institutionName === "Unknown institution") return accountName;
  const normalizedAccount = accountName.toLowerCase();
  const normalizedInstitution = institutionName.toLowerCase();
  const compactInstitution = searchableInstitutionName(institutionName);
  if (
    normalizedAccount.includes(normalizedInstitution) ||
    (compactInstitution && normalizedAccount.includes(compactInstitution))
  ) {
    return accountName;
  }
  return `${institutionName} ${accountName}`;
}

interface ActiveChip {
  key: string;
  label: string;
  removeHref: string;
}

function buildActiveChips(
  filters: TransactionFilterState,
  accounts: AccountRecord[],
  categories: CategoryRecord[]
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  const categoryGroups = categoryOptionGroups(categories);

  const withoutKey = (omit: keyof TransactionFilterState): string => {
    const clone = { ...filters, [omit]: omit === "excludeTransfers" ? false : "all" } as TransactionFilterState;
    if (omit === "search") clone.search = "";
    if (omit === "month") clone.month = "";
    if (omit === "fromDate") clone.fromDate = "";
    if (omit === "toDate") clone.toDate = "";
    return transactionFiltersHref("/transactions", clone);
  };

  if (filters.search) {
    chips.push({ key: "search", label: `Search: "${filters.search}"`, removeHref: withoutKey("search") });
  }
  if (filters.month) {
    chips.push({ key: "month", label: `Month: ${filters.month}`, removeHref: withoutKey("month") });
  }
  if (filters.fromDate) {
    chips.push({ key: "from", label: `From: ${filters.fromDate}`, removeHref: withoutKey("fromDate") });
  }
  if (filters.toDate) {
    chips.push({ key: "to", label: `To: ${filters.toDate}`, removeHref: withoutKey("toDate") });
  }
  if (filters.accountId !== "all") {
    const account = accounts.find((entry) => entry.id === filters.accountId);
    chips.push({
      key: "account",
      label: `Account: ${account ? accountLabel(account) : filters.accountId}`,
      removeHref: withoutKey("accountId")
    });
  }
  if (filters.categoryId !== "all") {
    const category = categoryGroups.find((entry) => entry.value === filters.categoryId);
    chips.push({
      key: "category",
      label: `Category: ${category ? category.label : filters.categoryId}`,
      removeHref: withoutKey("categoryId")
    });
  }
  if (filters.direction !== "all") {
    const direction = transactionDirectionOptions.find((entry) => entry.value === filters.direction);
    chips.push({
      key: "direction",
      label: direction?.label ?? filters.direction,
      removeHref: withoutKey("direction")
    });
  }
  if (filters.intent !== "all") {
    const tag = transactionTagFromIntent(filters.intent);
    chips.push({
      key: "intent",
      label: tag === "none"
        ? `Intent: ${displayTransactionIntent(filters.intent)}`
        : transactionTagLabel(tag),
      removeHref: withoutKey("intent")
    });
  }
  if (filters.reviewStatus !== "all") {
    chips.push({ key: "review", label: `Review: ${filters.reviewStatus}`, removeHref: withoutKey("reviewStatus") });
  }
  if (filters.reviewReason !== "all") {
    chips.push({ key: "reason", label: `Reason: ${filters.reviewReason}`, removeHref: withoutKey("reviewReason") });
  }
  if (filters.quality !== "all") {
    chips.push({ key: "quality", label: `Quality: ${filters.quality}`, removeHref: withoutKey("quality") });
  }
  if (filters.excludeTransfers) {
    chips.push({ key: "exclude_transfers", label: "Excluding transfers", removeHref: withoutKey("excludeTransfers") });
  }

  return chips;
}

export function TransactionFilters({ accounts, categories, filters }: TransactionFiltersProps) {
  const visibleReviewOptions = transactionReviewOptions.filter((option) => (
    option.value === "all" || option.value === "open"
  ));
  const activeChips = buildActiveChips(filters, accounts, categories);
  const categoryGroups = categoryOptionGroups(categories);

  return (
    <form action="/transactions" className={styles.filters} role="search" aria-label="Transaction filters">
      {/* Preserve URL params not exposed in this form so submission does not drop them. */}
      {filters.direction !== "all" ? <input name="direction" type="hidden" value={filters.direction} /> : null}
      {filters.intent !== "all" ? <input name="intent" type="hidden" value={filters.intent} /> : null}
      {filters.reviewReason !== "all" ? <input name="reason" type="hidden" value={filters.reviewReason} /> : null}
      {filters.quality !== "all" ? <input name="quality" type="hidden" value={filters.quality} /> : null}
      {filters.fromDate ? <input name="from" type="hidden" value={filters.fromDate} /> : null}
      {filters.toDate ? <input name="to" type="hidden" value={filters.toDate} /> : null}
      {filters.excludeTransfers ? <input name="exclude_transfers" type="hidden" value="1" /> : null}
      <input name="limit" type="hidden" value={String(filters.limit)} />

      <label className={`${styles.field} ${styles.searchField}`}>
        <span>Search</span>
        <div className={styles.textControl}>
          <Search size={14} aria-hidden />
          <input
            defaultValue={filters.search}
            name="q"
            placeholder="Search merchant..."
            type="search"
          />
        </div>
      </label>

      <label className={styles.field}>
        <span>Month</span>
        <input className={styles.inputControl} defaultValue={filters.month} name="month" type="month" />
      </label>

      <label className={styles.field}>
        <span>Account</span>
        <select className={styles.selectControl} defaultValue={filters.accountId} name="account">
          <option value="all">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {accountLabel(account)}
            </option>
          ))}
        </select>
      </label>

      <label className={`${styles.field} ${styles.mobileOptionalFilter}`}>
        <span>Category</span>
        <select className={styles.selectControl} defaultValue={filters.categoryId} name="category">
          <option value="all">All categories</option>
          {categoryGroups.map((category) => (
            <option key={category.value} value={category.value}>{category.label}</option>
          ))}
        </select>
      </label>

      <label className={`${styles.field} ${styles.mobileOptionalFilter}`}>
        <span>Review</span>
        <select className={styles.selectControl} defaultValue={filters.reviewStatus} name="review">
          {visibleReviewOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <div className={styles.filterActions}>
        <button className={styles.primaryButton} type="submit">
          <SlidersHorizontal size={14} aria-hidden />
          Apply
        </button>
        <Link className={styles.secondaryButton} href={transactionFiltersHref("/api/export/transactions", filters)} prefetch={false}>
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

      {activeChips.length > 0 ? (
        <div className={styles.activeChips} aria-label="Active filters">
          <span className={styles.activeChipsLabel}>Active:</span>
          {activeChips.map((chip) => (
            <Link
              aria-label={`Remove filter ${chip.label}`}
              className={styles.activeChip}
              href={chip.removeHref}
              key={chip.key}
              prefetch={false}
            >
              <span>{chip.label}</span>
              <X size={11} aria-hidden />
            </Link>
          ))}
        </div>
      ) : null}
    </form>
  );
}
