import type { CategoryRecord, ReviewQueueItem } from "@/lib/db";

export interface MissingCategoryAutofixPlan {
  categoryId: string;
  categoryName: string;
  needsCategoryLink: boolean;
  reviewItemId: string;
  transactionId: string;
}

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isRealCategoryName(value: string | null | undefined) {
  const normalized = normalize(value);
  return Boolean(normalized && normalized !== "uncategorized");
}

export function planMissingCategoryAutofixes(
  reviewItems: readonly ReviewQueueItem[],
  categories: readonly CategoryRecord[]
): MissingCategoryAutofixPlan[] {
  const categoryByName = new Map(categories.map((category) => [normalize(category.name), category]));

  return reviewItems.flatMap((item) => {
    if (item.status !== "open" || item.reason !== "missing-category") return [];
    if (!isRealCategoryName(item.transaction.category)) return [];

    if (item.transaction.categoryId) {
      const plan: MissingCategoryAutofixPlan = {
        categoryId: item.transaction.categoryId,
        categoryName: item.transaction.category,
        needsCategoryLink: false,
        reviewItemId: item.id,
        transactionId: item.transaction.id
      };
      return [plan];
    }

    const matchedCategory = categoryByName.get(normalize(item.transaction.category));
    if (!matchedCategory || !isRealCategoryName(matchedCategory.name)) return [];

    const plan: MissingCategoryAutofixPlan = {
      categoryId: matchedCategory.id,
      categoryName: matchedCategory.name,
      needsCategoryLink: true,
      reviewItemId: item.id,
      transactionId: item.transaction.id
    };
    return [plan];
  });
}
