import type { CategoryRecord, TransactionRecord } from "@/lib/db";
import {
  isTransferCategoryName,
  primaryCategoryIdForId
} from "@/lib/finance/classification";
import type { NormalizedReviewSuggestion } from "./suggestions";

type CategoryDefaultTransaction = Pick<TransactionRecord, "category" | "categoryId">;

function isUncategorizedCategoryName(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase() === "uncategorized";
}

function isConcreteSpendCategory(value: string | null | undefined) {
  return Boolean(value && !isUncategorizedCategoryName(value) && !isTransferCategoryName(value));
}

function categoryById(categories: readonly CategoryRecord[], categoryId: string | null | undefined) {
  if (!categoryId) return null;
  return categories.find((category) => category.id === categoryId) ?? null;
}

function findCategoryId(categories: readonly CategoryRecord[], categoryName: string | undefined) {
  if (!isConcreteSpendCategory(categoryName)) return null;

  const normalized = String(categoryName).trim().toLowerCase();
  const category = categories.find((candidate) =>
    isConcreteSpendCategory(candidate.name) &&
    candidate.name.trim().toLowerCase() === normalized
  );
  return category?.id ?? null;
}

function concreteCategoryId(categories: readonly CategoryRecord[], categoryId: string | null | undefined) {
  const category = categoryById(categories, categoryId);
  return category && isConcreteSpendCategory(category.name) ? category.id : null;
}

export function defaultReviewCategoryId(
  categories: CategoryRecord[],
  suggestion: Pick<NormalizedReviewSuggestion, "categoryId" | "categoryName">,
  transaction: CategoryDefaultTransaction
) {
  const suggestedCategoryId = concreteCategoryId(categories, suggestion.categoryId) ??
    findCategoryId(categories, suggestion.categoryName);
  const transactionCategoryId = isConcreteSpendCategory(transaction.category)
    ? concreteCategoryId(categories, transaction.categoryId)
    : null;

  return primaryCategoryIdForId(suggestedCategoryId, categories) ??
    primaryCategoryIdForId(transactionCategoryId, categories) ??
    "none";
}
