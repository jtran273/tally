import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord, CategoryRecord } from "@/lib/db";
import {
  normalizeTransactionFilters,
  parseTransactionFilters,
  toTransactionListFilters,
  transactionPeriodTitle,
  transactionFiltersHref
} from "./filters";

const account = {
  availableBalance: null,
  balance: 100,
  color: null,
  creditLimit: null,
  currency: "USD",
  id: "account-schools-first",
  institutionId: "institution-schools-first",
  institutionName: "Schools First FCU",
  isActive: true,
  lastSyncedAt: null,
  mask: "9876",
  name: "Schools First Checking",
  officialName: null,
  plaidAccountId: "plaid-account",
  subtype: "checking",
  type: "depository",
  userId: "user-1"
} satisfies AccountRecord;

const category = {
  color: null,
  icon: null,
  id: "category-food",
  isSystem: false,
  name: "Food / Restaurants",
  parentId: null,
  userId: "user-1"
} satisfies CategoryRecord;

test("parseTransactionFilters sanitizes input and combines month/date bounds", () => {
  const filters = parseTransactionFilters({
    account: account.id,
    category: category.id,
    exclude_transfers: "1",
    from: "2026-05-12",
    intent: "business",
    limit: "500",
    month: "2026-05",
    q: "  Lyft  ",
    quality: "needs-cleanup",
    review: "open",
    to: "2026-05-20"
  });

  assert.equal(filters.search, "Lyft");
  assert.equal(filters.accountId, account.id);
  assert.equal(filters.categoryId, category.id);
  assert.equal(filters.intent, "business");
  assert.equal(filters.reviewStatus, "open");
  assert.equal(filters.quality, "needs-cleanup");
  assert.equal(filters.effectiveFromDate, "2026-05-12");
  assert.equal(filters.effectiveToDate, "2026-05-20");
  assert.equal(filters.excludeTransfers, true);
  assert.equal(filters.limit, 500);
  assert.equal(filters.hasActiveFilters, true);
});

test("parseTransactionFilters rejects invalid options and inverted ranges", () => {
  const filters = parseTransactionFilters({
    from: "2026-06-01",
    intent: "bad",
    limit: "999",
    month: "2026-05",
    quality: "bad",
    review: "unknown",
    to: "2026-05-05"
  });

  assert.equal(filters.intent, "all");
  assert.equal(filters.reviewStatus, "all");
  assert.equal(filters.quality, "all");
  assert.equal(filters.limit, 250);
  assert.equal(filters.effectiveFromDate, "2026-06-01");
  assert.equal(filters.effectiveToDate, "2026-05-05");
  assert.equal(filters.isDateRangeInverted, true);
});

test("normalizeTransactionFilters clears stale account/category ids", () => {
  const filters = parseTransactionFilters({
    account: "missing-account",
    category: "missing-category",
    q: "coffee"
  });
  const normalized = normalizeTransactionFilters(filters, [account], [category]);

  assert.equal(normalized.accountId, "all");
  assert.equal(normalized.categoryId, "all");
  assert.equal(normalized.search, "coffee");
});

test("toTransactionListFilters and export href preserve the same filter fields", () => {
  const filters = normalizeTransactionFilters(
    parseTransactionFilters({
      account: account.id,
      category: category.id,
      exclude_transfers: "1",
      from: "2026-05-01",
      intent: "personal",
      limit: "100",
      q: "ride shares",
      quality: "low-confidence",
      review: "open",
      to: "2026-05-31"
    }),
    [account],
    [category]
  );

  assert.deepEqual(toTransactionListFilters(filters), {
    accountIds: [account.id],
    categoryIds: [category.id],
    excludeTransfers: true,
    fromDate: "2026-05-01",
    intent: "personal",
    limit: 100,
    reviewStatus: "open",
    quality: "low-confidence",
    search: "ride shares",
    toDate: "2026-05-31"
  });

  assert.equal(
    transactionFiltersHref("/api/export/transactions", filters),
    "/api/export/transactions?q=ride+shares&from=2026-05-01&to=2026-05-31&account=account-schools-first&category=category-food&intent=personal&review=open&quality=low-confidence&exclude_transfers=1&limit=100"
  );
});

test("transactionPeriodTitle summarizes all, monthly, bounded, and inverted periods", () => {
  assert.equal(transactionPeriodTitle(parseTransactionFilters({})), "All transactions");
  assert.equal(transactionPeriodTitle(parseTransactionFilters({ month: "2026-05" })), "May 2026");
  assert.equal(
    transactionPeriodTitle(parseTransactionFilters({ from: "2026-05-12", month: "2026-05", to: "2026-05-20" })),
    "May 12-20, 2026"
  );
  assert.equal(
    transactionPeriodTitle(parseTransactionFilters({ from: "2025-12-28", to: "2026-01-04" })),
    "December 28, 2025-January 4, 2026"
  );
  assert.equal(transactionPeriodTitle(parseTransactionFilters({ from: "2026-05-12" })), "Since May 12, 2026");
  assert.equal(transactionPeriodTitle(parseTransactionFilters({ to: "2026-05-20" })), "Through May 20, 2026");
  assert.equal(
    transactionPeriodTitle(parseTransactionFilters({ from: "2026-06-01", month: "2026-05", to: "2026-05-20" })),
    "No matching period"
  );
});
