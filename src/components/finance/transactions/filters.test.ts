import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord, CategoryRecord } from "@/lib/db";
import {
  normalizeTransactionFilters,
  parseTransactionFilters,
  toTransactionListFilters,
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
    review: "open",
    to: "2026-05-20"
  });

  assert.equal(filters.search, "Lyft");
  assert.equal(filters.accountId, account.id);
  assert.equal(filters.categoryId, category.id);
  assert.equal(filters.intent, "business");
  assert.equal(filters.reviewStatus, "open");
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
    review: "unknown",
    to: "2026-05-05"
  });

  assert.equal(filters.intent, "all");
  assert.equal(filters.reviewStatus, "all");
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
    search: "ride shares",
    toDate: "2026-05-31"
  });

  assert.equal(
    transactionFiltersHref("/api/export/transactions", filters),
    "/api/export/transactions?q=ride+shares&from=2026-05-01&to=2026-05-31&account=account-schools-first&category=category-food&intent=personal&review=open&exclude_transfers=1&limit=100"
  );
});
