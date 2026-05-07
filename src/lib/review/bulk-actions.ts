import type { ReviewQueueItem, TransactionIntent } from "@/lib/db";
import { isPeerToPeerReview } from "@/lib/review/reasons";
import {
  hasReviewSuggestionValue,
  normalizeReviewSuggestion,
  type NormalizedReviewSuggestion
} from "@/lib/review/suggestions";

export type BulkReviewPlanStatus = "accept-ready" | "skipped";

export interface BulkReviewPreview {
  current: {
    categoryName: string;
    confidence: number | null;
    intent: TransactionIntent;
    merchantName: string;
    recurring: boolean;
  };
  suggested: {
    categoryName: string | null;
    confidence: number | null;
    intent: TransactionIntent | null;
    merchantName: string | null;
    recurring: boolean | null;
  };
}

export interface BulkReviewPlanItem {
  amount: number;
  date: string;
  merchantName: string;
  preview: BulkReviewPreview;
  reason: ReviewQueueItem["reason"];
  reviewItemId: string;
  skipReason: string | null;
  status: BulkReviewPlanStatus;
  transactionId: string;
}

export interface BulkReviewPlan {
  acceptReady: BulkReviewPlanItem[];
  items: BulkReviewPlanItem[];
  skipped: BulkReviewPlanItem[];
}

function suggestedValue<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function buildPreview(item: ReviewQueueItem, suggestion: NormalizedReviewSuggestion): BulkReviewPreview {
  return {
    current: {
      categoryName: item.transaction.category,
      confidence: item.transaction.confidence,
      intent: item.transaction.intent,
      merchantName: item.transaction.merchant,
      recurring: item.transaction.recurring
    },
    suggested: {
      categoryName: suggestion.categoryName ?? null,
      confidence: suggestion.confidence ?? null,
      intent: suggestion.intent ?? null,
      merchantName: suggestion.merchantName ?? null,
      recurring: suggestedValue(suggestion.recurring)
    }
  };
}

function skipReason(item: ReviewQueueItem, suggestion: NormalizedReviewSuggestion) {
  if (item.status !== "open") return "Review item is no longer open.";
  if (isPeerToPeerReview(item.reason)) return "Manual-only peer-to-peer item.";
  if (!hasReviewSuggestionValue(suggestion)) return "No accept-ready AI suggestion.";
  return null;
}

export function buildBulkReviewPlan(reviewItems: ReviewQueueItem[], options: { limit?: number } = {}): BulkReviewPlan {
  const limit = options.limit ?? 40;
  const items = reviewItems.slice(0, limit).map((item) => {
    const suggestion = normalizeReviewSuggestion(item.aiSuggestion);
    const reason = skipReason(item, suggestion);

    const status: BulkReviewPlanStatus = reason ? "skipped" : "accept-ready";

    return {
      amount: item.transaction.amount,
      date: item.transaction.date,
      merchantName: item.transaction.merchant,
      preview: buildPreview(item, suggestion),
      reason: item.reason,
      reviewItemId: item.id,
      skipReason: reason,
      status,
      transactionId: item.transaction.id
    };
  });

  return {
    acceptReady: items.filter((item) => item.status === "accept-ready"),
    items,
    skipped: items.filter((item) => item.status === "skipped")
  };
}
