import type { TransactionSuggestionService } from "@/lib/ai/suggestion-service";
import type { TransactionAiSuggestion } from "@/lib/ai/types";
import type {
  CategoryRecord,
  EnrichedTransactionRow,
  Json,
  RawTransactionRow,
  ReviewReason
} from "@/lib/db";
import { isPeerToPeerReview } from "./reasons";

export interface ReviewAiSuggestionItem {
  ai_suggestion?: Json;
  confidence?: number | null;
  enriched_transaction_id?: string;
  reason?: ReviewReason;
}

export interface AttachAiReviewSuggestionsOptions {
  categories: readonly CategoryRecord[];
  maxSuggestions?: number;
  rawRows: readonly RawTransactionRow[];
  suggestionService: Pick<TransactionSuggestionService, "suggestTransaction">;
  transactions: readonly EnrichedTransactionRow[];
}

export interface ReviewAiSuggestionUpdate<TItem extends ReviewAiSuggestionItem> {
  item: TItem;
  original: TItem;
}

const DEFAULT_MAX_AI_REVIEW_SUGGESTIONS = 40;

function toJsonSuggestion(suggestion: TransactionAiSuggestion): Json {
  return JSON.parse(JSON.stringify(suggestion)) as Json;
}

function shouldRequestAiSuggestion(item: ReviewAiSuggestionItem) {
  return Boolean(item.enriched_transaction_id && item.reason && !isPeerToPeerReview(item.reason));
}

export async function attachAiSuggestionsToReviewItems<TItem extends ReviewAiSuggestionItem>(
  reviewItems: readonly TItem[],
  {
    categories,
    maxSuggestions = DEFAULT_MAX_AI_REVIEW_SUGGESTIONS,
    rawRows,
    suggestionService,
    transactions
  }: AttachAiReviewSuggestionsOptions
): Promise<ReviewAiSuggestionUpdate<TItem>[]> {
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const rawById = new Map(rawRows.map((raw) => [raw.id, raw]));
  const updates: ReviewAiSuggestionUpdate<TItem>[] = [];
  let generated = 0;

  for (const item of reviewItems) {
    if (generated >= maxSuggestions || !shouldRequestAiSuggestion(item)) continue;

    const transaction = transactionById.get(item.enriched_transaction_id ?? "");
    const raw = transaction ? rawById.get(transaction.raw_transaction_id) : null;
    if (!raw) continue;

    try {
      const suggestion = await suggestionService.suggestTransaction({
        categories,
        rawTransaction: raw
      });
      generated += 1;
      updates.push({
        item: {
          ...item,
          ai_suggestion: toJsonSuggestion(suggestion),
          confidence: suggestion.confidence
        },
        original: item
      });
    } catch (error) {
      console.warn("review_ai_suggestion_failed", {
        error: error instanceof Error ? error.message : "Unknown AI suggestion error",
        reviewReason: item.reason,
        transactionId: item.enriched_transaction_id
      });
    }
  }

  return updates;
}
