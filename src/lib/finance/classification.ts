import type { CategoryRecord, TransactionIntent } from "@/lib/db";

export type UserTransactionIntent = Extract<TransactionIntent, "business" | "personal">;
export type TransactionTag = "none" | "reimbursable" | "transfer";

export const userTransactionIntentOptions: Array<{ label: string; value: UserTransactionIntent }> = [
  { value: "personal", label: "Personal" },
  { value: "business", label: "Business" }
];

export const transactionTagOptions: Array<{ label: string; value: TransactionTag }> = [
  { value: "none", label: "None" },
  { value: "reimbursable", label: "Reimbursable" },
  { value: "transfer", label: "Transfer" }
];

export interface CategoryOptionGroup {
  categoryIds: string[];
  label: string;
  primaryCategoryId: string;
  value: string;
}

function normalized(value: string) {
  return value.trim().toLowerCase();
}

export function isTransferCategoryName(value: string | null | undefined) {
  return normalized(value ?? "") === "transfer";
}

export function displayCategoryName(value: string | null | undefined) {
  const name = (value ?? "").replace(/\s+/g, " ").trim();
  const key = normalized(name);
  if (!name || key === "uncategorized" || key === "transfer") return "Uncategorized";
  if (key === "food / restaurants") return "Food";
  if (key === "software" || key.startsWith("software /")) return "Software";
  if (key === "health" || key === "health / fitness" || key.startsWith("health /")) return "Health & Fitness";
  if (key === "transportation" || key.startsWith("transport /")) return "Transportation";
  if (key === "travel / flights") return "Travel";
  if (key === "auto / car maintenance") return "Auto";
  return name;
}

export function displayTransactionIntent(intent: TransactionIntent): UserTransactionIntent {
  return intent === "business" ? "business" : "personal";
}

export function transactionTagFromIntent(intent: TransactionIntent): TransactionTag {
  if (intent === "transfer") return "transfer";
  if (intent === "reimbursable") return "reimbursable";
  return "none";
}

export function transactionIntentFromUi(baseIntent: UserTransactionIntent, tag: TransactionTag): TransactionIntent {
  if (tag === "transfer" || tag === "reimbursable") return tag;
  return baseIntent;
}

export function transactionTagLabel(tag: TransactionTag) {
  return transactionTagOptions.find((option) => option.value === tag)?.label ?? "None";
}

function compareCategoryLabels(left: string, right: string) {
  if (left === "Uncategorized") return -1;
  if (right === "Uncategorized") return 1;
  return left.localeCompare(right);
}

function categoryFilterValue(categoryIds: string[]) {
  return categoryIds.join(",");
}

function preferredCategory(current: CategoryRecord, candidate: CategoryRecord, label: string) {
  const currentExact = displayCategoryName(current.name) === current.name && current.name === label;
  const candidateExact = displayCategoryName(candidate.name) === candidate.name && candidate.name === label;
  if (candidateExact !== currentExact) return candidateExact;
  if (candidate.isSystem !== current.isSystem) return candidate.isSystem;
  return candidate.name.localeCompare(current.name) < 0;
}

export function categoryOptionGroups(categories: CategoryRecord[]): CategoryOptionGroup[] {
  const groups = new Map<string, { categoryIds: string[]; label: string; primary: CategoryRecord }>();

  categories.forEach((category) => {
    if (isTransferCategoryName(category.name)) return;

    const label = displayCategoryName(category.name);
    const current = groups.get(label);
    if (!current) {
      groups.set(label, { categoryIds: [category.id], label, primary: category });
      return;
    }

    current.categoryIds.push(category.id);
    if (preferredCategory(current.primary, category, label)) current.primary = category;
  });

  return [...groups.values()]
    .map((group) => {
      const categoryIds = [...new Set(group.categoryIds)].sort();
      return {
        categoryIds,
        label: group.label,
        primaryCategoryId: group.primary.id,
        value: categoryFilterValue(categoryIds)
      };
    })
    .sort((left, right) => compareCategoryLabels(left.label, right.label));
}

export function categoryIdsFromFilterValue(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function categoryFilterValueForId(categoryId: string, categories: CategoryRecord[]) {
  const group = categoryOptionGroups(categories).find((option) => option.categoryIds.includes(categoryId));
  return group?.value ?? categoryId;
}

export function primaryCategoryIdForId(categoryId: string | null, categories: CategoryRecord[]) {
  if (!categoryId) return null;
  const group = categoryOptionGroups(categories).find((option) => option.categoryIds.includes(categoryId));
  return group?.primaryCategoryId ?? categoryId;
}
