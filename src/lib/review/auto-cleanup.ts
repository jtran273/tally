import {
  listCategories,
  listMerchantRules,
  recordAuditEvent,
  resolveReviewItem,
  updateTransactionEnrichment,
  type EnrichedTransactionRow,
  type FinanceSupabaseClient,
  type Json,
  type RawTransactionRow,
  type ReviewItemRow
} from "@/lib/db";
import { createConfiguredTransactionSuggestionService } from "@/lib/ai/server";
import { attachAiSuggestionsToReviewItems } from "./ai-suggestions";
import { evaluateAutoCategorization } from "./auto-categorization";
import { isPeerToPeerReview } from "./reasons";
import { hasReviewSuggestionValue, normalizeReviewSuggestion } from "./suggestions";

interface RunAiCleanupOptions {
  client: FinanceSupabaseClient;
  userId: string;
  limit?: number;
}

export interface AiCleanupResult {
  suggestionsStored: number;
  autoApplied: number;
}

function expectRows<T>(
  result: { data: T[] | null; error: { message: string } | null },
  label: string
) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

export async function runAiReviewCleanup({
  client,
  userId,
  limit = 40
}: RunAiCleanupOptions): Promise<AiCleanupResult> {
  const safeLimit = Math.max(1, Math.min(80, Math.floor(limit)));
  const [categories, merchantRules] = await Promise.all([
    listCategories(client, userId),
    listMerchantRules(client, userId)
  ]);
  const reviewRows = expectRows<ReviewItemRow>(
    await client
      .from("review_items")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(safeLimit),
    "Load open review items for AI cleanup"
  );

  const reviewTargets = reviewRows.filter((row) => {
    if (isPeerToPeerReview(row.reason)) return false;
    const existing = normalizeReviewSuggestion(row.ai_suggestion);
    return !hasReviewSuggestionValue(existing);
  });

  if (reviewTargets.length === 0) {
    return { suggestionsStored: 0, autoApplied: 0 };
  }

  const transactionIds = [...new Set(reviewTargets.map((row) => row.enriched_transaction_id))];
  const transactions = expectRows<EnrichedTransactionRow>(
    await client
      .from("enriched_transactions")
      .select("*")
      .eq("user_id", userId)
      .in("id", transactionIds),
    "Load review transactions for AI cleanup"
  );
  const rawIds = [...new Set(transactions.map((transaction) => transaction.raw_transaction_id))];
  const rawRows = rawIds.length > 0
    ? expectRows<RawTransactionRow>(
      await client
        .from("raw_transactions")
        .select("*")
        .eq("user_id", userId)
        .in("id", rawIds),
      "Load raw Plaid rows for AI cleanup"
    )
    : [];

  const updates = await attachAiSuggestionsToReviewItems(reviewTargets, {
    categories,
    maxSuggestions: safeLimit,
    merchantRules,
    rawRows,
    suggestionService: createConfiguredTransactionSuggestionService(),
    transactions
  });

  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const rawById = new Map(rawRows.map((raw) => [raw.id, raw]));
  const reviewedAt = new Date().toISOString();
  let suggestionsStored = 0;
  let autoApplied = 0;

  for (const { item } of updates) {
    if (!item.id) continue;

    const result = await client
      .from("review_items")
      .update({
        ai_suggestion: item.ai_suggestion,
        confidence: item.confidence ?? null
      })
      .eq("user_id", userId)
      .eq("id", item.id)
      .eq("status", "open")
      .select("id");

    const storedRows = expectRows<{ id: string }>(result, "Store AI review suggestion");
    suggestionsStored += storedRows.length;
    if (storedRows.length === 0) continue;

    const transaction = transactionById.get(item.enriched_transaction_id);
    const raw = transaction ? rawById.get(transaction.raw_transaction_id) ?? null : null;
    if (!transaction) continue;

    const decision = evaluateAutoCategorization({
      categories,
      rawTransaction: raw,
      reviewReason: item.reason,
      reviewedAt,
      suggestion: item.ai_suggestion,
      transaction
    });

    if (!decision.shouldApply || !decision.patch) continue;

    await updateTransactionEnrichment(client, userId, transaction.id, decision.patch);
    const resolved = await resolveReviewItem(
      client,
      userId,
      item.id,
      "resolved",
      "Auto-applied high-confidence AI categorization."
    );

    await recordAuditEvent(client, userId, {
      action: "review.suggestion_auto_applied",
      actorId: null,
      afterData: {
        appliedPatch: decision.patch as Record<string, Json | undefined>,
        aiSuggestion: item.ai_suggestion,
        resolvedAt: resolved.resolvedAt,
        status: resolved.status
      },
      beforeData: {
        aiSuggestion: item.ai_suggestion,
        confidence: item.confidence,
        reason: item.reason,
        status: item.status
      },
      entityId: item.id,
      entityTable: "review_items",
      metadata: {
        reason: decision.reason,
        transactionId: transaction.id
      }
    });

    autoApplied += 1;
  }

  return { suggestionsStored, autoApplied };
}
