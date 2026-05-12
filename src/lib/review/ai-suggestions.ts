import type { TransactionSuggestionService } from "@/lib/ai/suggestion-service";
import type { TransactionAiSuggestion, UserCorrectionExample } from "@/lib/ai/types";
import type {
  CategoryRecord,
  EnrichedTransactionRow,
  Json,
  MerchantRuleRow,
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
  cacheKey?: string;
  categories: readonly CategoryRecord[];
  concurrency?: number;
  maxSuggestions?: number;
  merchantRules?: readonly MerchantRuleRow[];
  rawRows: readonly RawTransactionRow[];
  suggestionService: Pick<TransactionSuggestionService, "suggestTransaction">;
  transactions: readonly EnrichedTransactionRow[];
  userCorrections?: readonly UserCorrectionExample[];
}

export interface ReviewAiSuggestionUpdate<TItem extends ReviewAiSuggestionItem> {
  item: TItem;
  original: TItem;
}

const DEFAULT_MAX_AI_REVIEW_SUGGESTIONS = 40;
const DEFAULT_AI_REVIEW_SUGGESTION_CONCURRENCY = 4;

function toJsonSuggestion(suggestion: TransactionAiSuggestion): Json {
  return JSON.parse(JSON.stringify(suggestion)) as Json;
}

function shouldRequestAiSuggestion(item: ReviewAiSuggestionItem) {
  return Boolean(item.enriched_transaction_id && item.reason && !isPeerToPeerReview(item.reason));
}

async function mapWithConcurrency<TInput, TOutput>(
  values: readonly TInput[],
  concurrency: number,
  mapper: (value: TInput) => Promise<TOutput>
) {
  const results = new Array<TOutput>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, values.length);

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export async function attachAiSuggestionsToReviewItems<TItem extends ReviewAiSuggestionItem>(
  reviewItems: readonly TItem[],
  {
    cacheKey,
    categories,
    concurrency = DEFAULT_AI_REVIEW_SUGGESTION_CONCURRENCY,
    maxSuggestions = DEFAULT_MAX_AI_REVIEW_SUGGESTIONS,
    merchantRules,
    rawRows,
    suggestionService,
    transactions,
    userCorrections
  }: AttachAiReviewSuggestionsOptions
): Promise<ReviewAiSuggestionUpdate<TItem>[]> {
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const rawById = new Map(rawRows.map((raw) => [raw.id, raw]));
  const candidates: Array<{ item: TItem; raw: RawTransactionRow }> = [];

  for (const item of reviewItems) {
    if (candidates.length >= maxSuggestions || !shouldRequestAiSuggestion(item)) continue;

    const transaction = transactionById.get(item.enriched_transaction_id ?? "");
    const raw = transaction ? rawById.get(transaction.raw_transaction_id) : null;
    if (!raw) continue;
    candidates.push({ item, raw });
  }

  const safeConcurrency = Math.max(1, Math.min(8, Math.floor(concurrency)));
  const updates = await mapWithConcurrency<
    { item: TItem; raw: RawTransactionRow },
    ReviewAiSuggestionUpdate<TItem> | null
  >(candidates, safeConcurrency, async ({ item, raw }) => {
    try {
      const suggestion = await suggestionService.suggestTransaction({
        cacheKey,
        categories,
        merchantRules,
        rawTransaction: raw,
        userCorrections
      });
      const updatedItem = {
        ...item,
        ai_suggestion: toJsonSuggestion(suggestion),
        confidence: suggestion.confidence
      } as TItem;
      return {
        item: updatedItem,
        original: item
      };
    } catch (error) {
      console.warn("review_ai_suggestion_failed", {
        error: error instanceof Error ? error.message : "Unknown AI suggestion error",
        reviewReason: item.reason,
        transactionId: item.enriched_transaction_id
      });
      return null;
    }
  });

  return updates.flatMap((update) => update ? [update] : []);
}
