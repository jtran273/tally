import type {
  CategoryRecord,
  Json,
  TransactionEnrichmentPatch,
  TransactionIntent
} from "@/lib/db";

export interface NormalizedReviewSuggestion {
  categoryId?: string | null;
  categoryName?: string;
  confidence?: number;
  intent?: TransactionIntent;
  merchantName?: string;
  reason?: string;
  recurring?: boolean;
  signals: string[];
}

export interface ReviewSuggestionPatchResult {
  patch: TransactionEnrichmentPatch;
  suggestion: NormalizedReviewSuggestion;
}

const transactionIntents = new Set<TransactionIntent>([
  "personal",
  "business",
  "shared",
  "reimbursable",
  "transfer"
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed));
  }
  return undefined;
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = cleanString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function normalizeIntent(value: unknown): TransactionIntent | undefined {
  const direct = cleanString(value);
  if (direct && transactionIntents.has(direct as TransactionIntent)) {
    return direct as TransactionIntent;
  }

  const nested = asRecord(value);
  if ("value" in nested) return normalizeIntent(nested.value);
  return undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;

  const text = cleanString(value)?.toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;

  const nested = asRecord(value);
  if ("value" in nested) return normalizeBoolean(nested.value);
  return undefined;
}

function normalizeCategory(value: unknown): Pick<NormalizedReviewSuggestion, "categoryId" | "categoryName"> {
  const directName = cleanString(value);
  if (directName) return { categoryName: directName };

  const field = asRecord(value);
  const fieldValue = asRecord(field.value);
  const valueName = cleanString(field.value);
  const categoryName =
    readString(fieldValue, ["name", "categoryName", "label"]) ??
    valueName ??
    readString(field, ["name", "categoryName", "label"]);

  if (!categoryName) return {};

  return {
    categoryId: cleanString(fieldValue.id) ?? cleanString(field.id) ?? null,
    categoryName
  };
}

function normalizeMerchant(value: unknown) {
  const direct = cleanString(value);
  if (direct) return direct;

  const field = asRecord(value);
  const fieldValue = asRecord(field.value);
  const valueName = cleanString(field.value);
  return (
    readString(fieldValue, ["normalized", "merchantName", "name"]) ??
    valueName ??
    readString(field, ["normalized", "merchantName", "name"])
  );
}

function normalizeSignals(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanString).filter((signal): signal is string => Boolean(signal))
    : [];
}

function nestedReason(value: unknown) {
  const field = asRecord(value);
  return readString(field, ["reason", "explanation"]);
}

export function normalizeReviewSuggestion(value: Json): NormalizedReviewSuggestion {
  const record = asRecord(value);
  const category = normalizeCategory(record.category ?? record.categoryName);
  const intent = normalizeIntent(record.intent);
  const recurring = normalizeBoolean(record.recurring ?? record.isRecurring);
  const merchantName = normalizeMerchant(record.merchantCleanup ?? record.merchantName);
  const confidence =
    cleanNumber(record.confidence) ??
    cleanNumber(asRecord(record.category).confidence) ??
    cleanNumber(asRecord(record.intent).confidence) ??
    cleanNumber(asRecord(record.recurring).confidence);
  const reason =
    readString(record, ["reason", "explanation"]) ??
    nestedReason(record.category) ??
    nestedReason(record.intent) ??
    nestedReason(record.recurring);

  return {
    ...category,
    confidence,
    intent,
    merchantName,
    reason,
    recurring,
    signals: normalizeSignals(record.signals)
  };
}

function findCategoryId(categories: CategoryRecord[], categoryName: string) {
  const normalized = categoryName.trim().toLowerCase();
  return categories.find((category) => category.name.trim().toLowerCase() === normalized)?.id ?? null;
}

export function buildAcceptedReviewSuggestionPatch(
  aiSuggestion: Json,
  categories: CategoryRecord[],
  options: { reviewedAt: string }
): ReviewSuggestionPatchResult {
  const suggestion = normalizeReviewSuggestion(aiSuggestion);
  const patch: TransactionEnrichmentPatch = {
    reviewedAt: options.reviewedAt,
    source: "ai"
  };

  if (suggestion.merchantName) {
    patch.merchantName = suggestion.merchantName;
  }
  if (suggestion.categoryName) {
    patch.categoryName = suggestion.categoryName;
    patch.categoryId = suggestion.categoryId !== undefined
      ? suggestion.categoryId
      : findCategoryId(categories, suggestion.categoryName);
  }
  if (suggestion.intent) {
    patch.intent = suggestion.intent;
  }
  if (suggestion.recurring !== undefined) {
    patch.isRecurring = suggestion.recurring;
  }
  if (suggestion.confidence !== undefined) {
    patch.confidence = suggestion.confidence;
  }

  return { patch, suggestion };
}

export function hasReviewSuggestionValue(suggestion: NormalizedReviewSuggestion) {
  return Boolean(
    suggestion.categoryName ||
    suggestion.intent ||
    suggestion.merchantName ||
    suggestion.recurring !== undefined ||
    suggestion.confidence !== undefined
  );
}
