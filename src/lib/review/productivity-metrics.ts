import type {
  AuditEventRow,
  CategoryRecord,
  Json,
  ReviewQueueItem
} from "@/lib/db";
import { isPeerToPeerReview } from "./reasons";
import { hasReviewSuggestionValue, normalizeReviewSuggestion } from "./suggestions";

export type ReviewProductivityOutcome = "accepted" | "dismissed" | "edited";
export type BulkPreviewSkipReason = "peer-to-peer" | "missing-suggestion" | "stale-category";

export interface ReviewProductivityGroup {
  label: string;
  count: number;
}

export interface ReviewProductivityMetrics {
  acceptedSuggestions: number;
  dismissedSuggestions: number;
  editedReviews: number;
  repeatedReviewsAvoided: number;
  savingsScore: number;
  byCategory: ReviewProductivityGroup[];
  byMerchant: ReviewProductivityGroup[];
  byProvider: ReviewProductivityGroup[];
  byReason: ReviewProductivityGroup[];
}

export interface AiBulkPreviewMetrics {
  acceptReady: number;
  eligible: number;
  skipped: Record<BulkPreviewSkipReason, number>;
}

interface ProductivityEvent {
  category: string;
  merchant: string;
  outcome: ReviewProductivityOutcome;
  provider: string;
  reason: string;
}

const ACCEPTED_NOTE_PREFIX = "Accepted suggestion fields:";
const MAX_GROUPS = 5;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadata(event: AuditEventRow) {
  return asRecord(event.metadata);
}

function providerLabel(aiSuggestion: Json) {
  const record = asRecord(aiSuggestion);
  const provider = asRecord(record.provider);
  return text(provider.label) ?? text(provider.kind) ?? text(provider.id) ?? "Unknown provider";
}

function transactionIdFromEvent(event: AuditEventRow) {
  const meta = metadata(event);
  return text(meta.transactionId) ?? (event.entity_table === "enriched_transactions" ? event.entity_id : null);
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topGroups(values: Iterable<string>) {
  const counts = new Map<string, number>();
  for (const value of values) increment(counts, value);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_GROUPS)
    .map(([label, count]) => ({ count, label }));
}

function itemContext(item: ReviewQueueItem): Omit<ProductivityEvent, "outcome"> {
  return {
    category: item.transaction.category,
    merchant: item.transaction.merchant,
    provider: providerLabel(item.aiSuggestion),
    reason: item.reason
  };
}

export function buildAiBulkPreviewMetrics(
  reviewItems: readonly ReviewQueueItem[],
  categories: readonly CategoryRecord[]
): AiBulkPreviewMetrics {
  const knownCategoryIds = new Set(categories.map((category) => category.id));
  const knownCategoryNames = new Set(categories.map((category) => category.name.trim().toLowerCase()));
  const skipped: Record<BulkPreviewSkipReason, number> = {
    "missing-suggestion": 0,
    "peer-to-peer": 0,
    "stale-category": 0
  };
  let acceptReady = 0;
  let eligible = 0;

  for (const item of reviewItems) {
    if (isPeerToPeerReview(item.reason)) {
      skipped["peer-to-peer"] += 1;
      continue;
    }

    eligible += 1;
    const suggestion = normalizeReviewSuggestion(item.aiSuggestion);
    if (!hasReviewSuggestionValue(suggestion)) {
      skipped["missing-suggestion"] += 1;
      continue;
    }

    const categoryIdIsStale = Boolean(suggestion.categoryId && !knownCategoryIds.has(suggestion.categoryId));
    const categoryNameIsMissing = Boolean(
      suggestion.categoryName && !knownCategoryNames.has(suggestion.categoryName.trim().toLowerCase())
    );
    if (categoryIdIsStale && categoryNameIsMissing) {
      skipped["stale-category"] += 1;
      continue;
    }

    acceptReady += 1;
  }

  return { acceptReady, eligible, skipped };
}

export function deriveReviewProductivityMetrics({
  auditEvents,
  reviewItems
}: {
  auditEvents: readonly AuditEventRow[];
  reviewItems: readonly ReviewQueueItem[];
}): ReviewProductivityMetrics {
  const reviewById = new Map(reviewItems.map((item) => [item.id, item]));
  const acceptedIds = new Set<string>();
  const dismissedIds = new Set<string>();
  const events: ProductivityEvent[] = [];
  let repeatedReviewsAvoided = 0;

  for (const event of auditEvents) {
    if (event.action === "merchant_rule.ai_accepted_upserted") {
      repeatedReviewsAvoided += 1;
      continue;
    }

    if (event.action === "review.suggestion_accepted" && event.entity_id) {
      const item = reviewById.get(event.entity_id);
      acceptedIds.add(event.entity_id);
      if (item) events.push({ ...itemContext(item), outcome: "accepted" });
      continue;
    }

    if (event.action === "review.dismissed" && event.entity_id) {
      const item = reviewById.get(event.entity_id);
      dismissedIds.add(event.entity_id);
      if (item) events.push({ ...itemContext(item), outcome: "dismissed" });
      continue;
    }

    if (event.action === "transaction.enrichment_updated") {
      const transactionId = transactionIdFromEvent(event);
      const item = transactionId
        ? reviewItems.find((review) => review.transaction.id === transactionId)
        : null;
      events.push({
        category: item?.transaction.category ?? "Unknown category",
        merchant: item?.transaction.merchant ?? "Unknown merchant",
        outcome: "edited",
        provider: "Manual edit",
        reason: item?.reason ?? "manual-edit"
      });
    }
  }

  for (const item of reviewItems) {
    if (
      item.status === "resolved" &&
      item.resolutionNote?.startsWith(ACCEPTED_NOTE_PREFIX) &&
      !acceptedIds.has(item.id)
    ) {
      acceptedIds.add(item.id);
      events.push({ ...itemContext(item), outcome: "accepted" });
    }

    if (item.status === "dismissed" && !dismissedIds.has(item.id)) {
      dismissedIds.add(item.id);
      events.push({ ...itemContext(item), outcome: "dismissed" });
    }
  }

  const acceptedSuggestions = acceptedIds.size;
  const dismissedSuggestions = dismissedIds.size;
  const editedReviews = events.filter((event) => event.outcome === "edited").length;

  return {
    acceptedSuggestions,
    byCategory: topGroups(events.map((event) => event.category)),
    byMerchant: topGroups(events.map((event) => event.merchant)),
    byProvider: topGroups(events.map((event) => event.provider)),
    byReason: topGroups(events.map((event) => event.reason)),
    dismissedSuggestions,
    editedReviews,
    repeatedReviewsAvoided,
    savingsScore: acceptedSuggestions + repeatedReviewsAvoided
  };
}
