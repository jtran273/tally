import type {
  AccountRecord,
  CategoryRecord,
  TransactionDirectionFilter,
  ReviewReason,
  ReviewStatus,
  TransactionIntent,
  TransactionListFilters,
  TransactionQualityFilter
} from "@/lib/db";
import { categoryIdsFromFilterValue, categoryOptionGroups } from "@/lib/finance/classification";

export type TransactionSearchParamValue = string | string[] | undefined;
export type TransactionSearchParams = Record<string, TransactionSearchParamValue>;

export const transactionIntentOptions: Array<{ label: string; value: TransactionIntent | "all" }> = [
  { value: "all", label: "All intents" },
  { value: "personal", label: "Personal" },
  { value: "business", label: "Business" },
  { value: "reimbursable", label: "Reimbursable" },
  { value: "transfer", label: "Transfer" }
];

export const transactionDirectionOptions: Array<{ label: string; value: TransactionDirectionFilter }> = [
  { value: "all", label: "All flows" },
  { value: "spending", label: "Spending only" },
  { value: "income", label: "Income only" }
];

export const transactionReviewOptions: Array<{ label: string; value: ReviewStatus | "all" }> = [
  { value: "all", label: "All review states" },
  { value: "open", label: "Needs review" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" }
];

export const transactionReviewReasonOptions: Array<{ label: string; value: ReviewReason | "all" }> = [
  { value: "all", label: "All review reasons" },
  { value: "venmo", label: "Peer-to-peer" },
  { value: "large", label: "Large charge" },
  { value: "transfer-pair", label: "Transfer pair" },
  { value: "new-recurring", label: "New recurring" },
  { value: "low-confidence", label: "Low confidence" },
  { value: "missing-category", label: "Missing category" },
  { value: "unclear-transfer", label: "Unclear transfer" },
  { value: "recurring-candidate", label: "Recurring candidate" }
];

export const transactionQualityOptions: Array<{ label: string; value: TransactionQualityFilter }> = [
  { value: "all", label: "All quality states" },
  { value: "needs-cleanup", label: "Needs category cleanup" },
  { value: "low-confidence", label: "Low confidence" },
  { value: "uncategorized", label: "Uncategorized" }
];

export const transactionLimitOptions = [100, 250, 500] as const;

export interface TransactionFilterState {
  search: string;
  accountId: string;
  categoryId: string;
  direction: TransactionDirectionFilter;
  intent: TransactionIntent | "all";
  reviewStatus: ReviewStatus | "all";
  reviewReason: ReviewReason | "all";
  quality: TransactionQualityFilter;
  month: string;
  fromDate: string;
  toDate: string;
  effectiveFromDate?: string;
  effectiveToDate?: string;
  excludeTransfers: boolean;
  limit: number;
  isDateRangeInverted: boolean;
  hasActiveFilters: boolean;
}

const transactionIntents = new Set(transactionIntentOptions.map((option) => option.value));
const transactionDirections = new Set(transactionDirectionOptions.map((option) => option.value));
const reviewStatuses = new Set(transactionReviewOptions.map((option) => option.value));
const reviewReasons = new Set(transactionReviewReasonOptions.map((option) => option.value));
const qualityStates = new Set(transactionQualityOptions.map((option) => option.value));
const DEFAULT_LIMIT = 250;
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric"
});
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  timeZone: "UTC",
  year: "numeric"
});

function firstParam(value: TransactionSearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanText(value: TransactionSearchParamValue, maxLength: number) {
  return (firstParam(value) ?? "").trim().slice(0, maxLength);
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isIsoMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthBounds(value: string) {
  const [yearText, monthText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const start = `${value}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  return { start, end };
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00.000Z`));
}

function formatRange(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T12:00:00.000Z`);
  const to = new Date(`${toDate}T12:00:00.000Z`);

  if (from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()) {
    return `${from.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${from.getUTCDate()}-${to.getUTCDate()}, ${to.getUTCFullYear()}`;
  }

  return `${formatDate(fromDate)}-${formatDate(toDate)}`;
}

function maxDate(left?: string, right?: string) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function minDate(left?: string, right?: string) {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function parseLimit(value: TransactionSearchParamValue) {
  const parsed = Number(firstParam(value));
  return transactionLimitOptions.includes(parsed as (typeof transactionLimitOptions)[number])
    ? parsed
    : DEFAULT_LIMIT;
}

function deriveState(input: Omit<TransactionFilterState, "isDateRangeInverted" | "hasActiveFilters">): TransactionFilterState {
  const isDateRangeInverted = Boolean(input.effectiveFromDate && input.effectiveToDate && input.effectiveFromDate > input.effectiveToDate);

  return {
    ...input,
    isDateRangeInverted,
    hasActiveFilters: Boolean(
      input.search ||
      input.accountId !== "all" ||
      input.categoryId !== "all" ||
      input.direction !== "all" ||
      input.intent !== "all" ||
      input.reviewStatus !== "all" ||
      input.reviewReason !== "all" ||
      input.quality !== "all" ||
      input.month ||
      input.fromDate ||
      input.toDate ||
      input.excludeTransfers
    )
  };
}

export function parseTransactionFilters(params: TransactionSearchParams): TransactionFilterState {
  const search = cleanText(params.q, 120);
  const requestedAccountId = cleanText(params.account, 80);
  const requestedCategoryId = cleanText(params.category, 600);
  const requestedDirection = cleanText(params.direction, 24);
  const requestedIntent = cleanText(params.intent, 24);
  const requestedReviewStatus = cleanText(params.review, 24);
  const requestedReviewReason = cleanText(params.reason, 32);
  const requestedQuality = cleanText(params.quality, 24);
  const requestedMonth = cleanText(params.month, 7);
  const requestedFromDate = cleanText(params.from, 10);
  const requestedToDate = cleanText(params.to, 10);
  const month = isIsoMonth(requestedMonth) ? requestedMonth : "";
  const fromDate = isIsoDate(requestedFromDate) ? requestedFromDate : "";
  const toDate = isIsoDate(requestedToDate) ? requestedToDate : "";
  const bounds = month ? monthBounds(month) : null;
  const effectiveFromDate = maxDate(fromDate || undefined, bounds?.start);
  const effectiveToDate = minDate(toDate || undefined, bounds?.end);

  return deriveState({
    search,
    accountId: requestedAccountId || "all",
    categoryId: requestedCategoryId || "all",
    direction: transactionDirections.has(requestedDirection as TransactionDirectionFilter)
      ? requestedDirection as TransactionDirectionFilter
      : "all",
    intent: transactionIntents.has(requestedIntent as TransactionIntent | "all")
      ? requestedIntent as TransactionIntent | "all"
      : "all",
    reviewStatus: reviewStatuses.has(requestedReviewStatus as ReviewStatus | "all")
      ? requestedReviewStatus as ReviewStatus | "all"
      : "all",
    reviewReason: reviewReasons.has(requestedReviewReason as ReviewReason | "all")
      ? requestedReviewReason as ReviewReason | "all"
      : "all",
    quality: qualityStates.has(requestedQuality as TransactionQualityFilter)
      ? requestedQuality as TransactionQualityFilter
      : "all",
    month,
    fromDate,
    toDate,
    effectiveFromDate,
    effectiveToDate,
    excludeTransfers: firstParam(params.exclude_transfers) === "1",
    limit: parseLimit(params.limit)
  });
}

export function normalizeTransactionFilters(
  filters: TransactionFilterState,
  accounts: AccountRecord[],
  categories: CategoryRecord[]
) {
  const categoryGroups = categoryOptionGroups(categories);
  const requestedCategoryIds = categoryIdsFromFilterValue(filters.categoryId);
  const categoryGroup = filters.categoryId === "all"
    ? null
    : categoryGroups.find((group) => (
      group.value === filters.categoryId ||
      requestedCategoryIds.some((id) => group.categoryIds.includes(id))
    ));

  return deriveState({
    ...filters,
    accountId: filters.accountId === "all" || accounts.some((account) => account.id === filters.accountId)
      ? filters.accountId
      : "all",
    categoryId: filters.categoryId === "all"
      ? "all"
      : categoryGroup?.value ?? "all"
  });
}

export function toTransactionListFilters(filters: TransactionFilterState): TransactionListFilters {
  return {
    accountIds: filters.accountId === "all" ? undefined : [filters.accountId],
    categoryIds: filters.categoryId === "all" ? undefined : categoryIdsFromFilterValue(filters.categoryId),
    direction: filters.direction,
    intent: filters.intent,
    reviewReason: filters.reviewReason,
    reviewStatus: filters.reviewStatus,
    quality: filters.quality,
    fromDate: filters.effectiveFromDate,
    toDate: filters.effectiveToDate,
    excludeTransfers: filters.excludeTransfers,
    search: filters.search,
    limit: filters.limit
  };
}

export function hasOnlyAccountFilter(filters: TransactionFilterState) {
  return Boolean(
    filters.accountId !== "all" &&
    !filters.search &&
    filters.categoryId === "all" &&
    filters.direction === "all" &&
    filters.intent === "all" &&
    filters.reviewStatus === "all" &&
    filters.reviewReason === "all" &&
    filters.quality === "all" &&
    !filters.month &&
    !filters.fromDate &&
    !filters.toDate &&
    !filters.excludeTransfers
  );
}

export function transactionFiltersToSearchParams(filters: TransactionFilterState) {
  const params = new URLSearchParams();

  if (filters.search) params.set("q", filters.search);
  if (filters.month) params.set("month", filters.month);
  if (filters.fromDate) params.set("from", filters.fromDate);
  if (filters.toDate) params.set("to", filters.toDate);
  if (filters.accountId !== "all") params.set("account", filters.accountId);
  if (filters.categoryId !== "all") params.set("category", filters.categoryId);
  if (filters.direction !== "all") params.set("direction", filters.direction);
  if (filters.intent !== "all") params.set("intent", filters.intent);
  if (filters.reviewStatus !== "all") params.set("review", filters.reviewStatus);
  if (filters.reviewReason !== "all") params.set("reason", filters.reviewReason);
  if (filters.quality !== "all") params.set("quality", filters.quality);
  if (filters.excludeTransfers) params.set("exclude_transfers", "1");
  params.set("limit", String(filters.limit));

  return params;
}

export function transactionFiltersHref(pathname: string, filters: TransactionFilterState) {
  const params = transactionFiltersToSearchParams(filters);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

export function transactionPeriodTitle(
  filters: Pick<TransactionFilterState, "effectiveFromDate" | "effectiveToDate" | "isDateRangeInverted" | "month">
) {
  if (filters.isDateRangeInverted) return "No matching period";

  if (filters.effectiveFromDate && filters.effectiveToDate) {
    const bounds = filters.month ? monthBounds(filters.month) : null;

    if (
      bounds &&
      filters.effectiveFromDate === bounds.start &&
      filters.effectiveToDate === bounds.end
    ) {
      return monthFormatter.format(new Date(`${filters.month}-01T12:00:00.000Z`));
    }

    return formatRange(filters.effectiveFromDate, filters.effectiveToDate);
  }

  if (filters.effectiveFromDate) return `Since ${formatDate(filters.effectiveFromDate)}`;
  if (filters.effectiveToDate) return `Through ${formatDate(filters.effectiveToDate)}`;

  return "All transactions";
}
