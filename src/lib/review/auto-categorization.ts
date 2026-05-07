import type {
  CategoryRecord,
  EnrichedTransactionRow,
  Json,
  RawTransactionRow,
  ReviewReason,
  TransactionEnrichmentPatch,
  TransactionIntent
} from "@/lib/db";
import {
  buildAcceptedReviewSuggestionPatch,
  hasReviewSuggestionValue,
  normalizeReviewSuggestion,
  type NormalizedReviewSuggestion
} from "./suggestions";

export const AUTO_CATEGORIZATION_CONFIDENCE_THRESHOLD = 0.93;
export const AUTO_CATEGORIZATION_LARGE_AMOUNT_LIMIT = 500;

const AUTO_APPLY_REVIEW_REASONS = new Set<ReviewReason>(["missing-category", "low-confidence"]);
const MANUAL_INTENTS = new Set<TransactionIntent>(["shared", "reimbursable", "transfer"]);
const PEER_TO_PEER_PATTERN = /\b(apple cash|cash app|cashapp|paypal|venmo|zelle)\b/i;

export interface AutoCategorizationInput {
  categories: readonly CategoryRecord[];
  rawTransaction: Pick<RawTransactionRow, "merchant_name" | "name" | "status"> | null;
  reviewReason: ReviewReason;
  reviewedAt: string;
  suggestion: Json;
  transaction: Pick<
    EnrichedTransactionRow,
    "amount" | "id" | "merchant_name" | "status" | "user_id"
  >;
}

export interface AutoCategorizationDecision {
  patch: TransactionEnrichmentPatch | null;
  reason: string;
  shouldApply: boolean;
  suggestion: NormalizedReviewSuggestion;
}

function knownCategory(categories: readonly CategoryRecord[], suggestion: NormalizedReviewSuggestion) {
  if (suggestion.categoryId) {
    const byId = categories.find((category) => category.id === suggestion.categoryId);
    if (byId) return byId;
  }

  const categoryName = suggestion.categoryName?.trim().toLowerCase();
  if (!categoryName) return null;

  return categories.find((category) => category.name.trim().toLowerCase() === categoryName) ?? null;
}

function isUncategorized(categoryName: string | undefined) {
  return !categoryName || categoryName.trim().toLowerCase() === "uncategorized";
}

function peerToPeerEvidence(input: AutoCategorizationInput) {
  return [
    input.transaction.merchant_name,
    input.rawTransaction?.merchant_name,
    input.rawTransaction?.name
  ].filter(Boolean).join(" ");
}

export function evaluateAutoCategorization(input: AutoCategorizationInput): AutoCategorizationDecision {
  const suggestion = normalizeReviewSuggestion(input.suggestion);
  const fail = (reason: string): AutoCategorizationDecision => ({
    patch: null,
    reason,
    shouldApply: false,
    suggestion
  });

  if (!AUTO_APPLY_REVIEW_REASONS.has(input.reviewReason)) return fail("manual-review-reason");
  if (!hasReviewSuggestionValue(suggestion)) return fail("no-accept-ready-suggestion");
  if (input.transaction.status !== "posted" || input.rawTransaction?.status !== "posted") return fail("pending-transaction");
  if (PEER_TO_PEER_PATTERN.test(peerToPeerEvidence(input))) return fail("peer-to-peer");
  if (Math.abs(input.transaction.amount) >= AUTO_CATEGORIZATION_LARGE_AMOUNT_LIMIT) return fail("large-amount");
  if (suggestion.confidence === undefined || suggestion.confidence < AUTO_CATEGORIZATION_CONFIDENCE_THRESHOLD) {
    return fail("low-confidence");
  }
  if (isUncategorized(suggestion.categoryName)) return fail("missing-category");

  const category = knownCategory(input.categories, suggestion);
  if (!category || category.name.trim().toLowerCase() === "uncategorized") return fail("unknown-category");
  if (!suggestion.intent) return fail("missing-intent");
  if (MANUAL_INTENTS.has(suggestion.intent)) return fail("manual-intent");

  const { patch } = buildAcceptedReviewSuggestionPatch(input.suggestion, [...input.categories], {
    reviewedAt: input.reviewedAt
  });

  if (!patch.categoryId || isUncategorized(patch.categoryName)) return fail("unresolved-category");
  if (!patch.intent || MANUAL_INTENTS.has(patch.intent)) return fail("unresolved-intent");

  return {
    patch,
    reason: "auto-applied-high-confidence-categorization",
    shouldApply: true,
    suggestion
  };
}
