import { ReviewQueueView } from "@/components/finance/review/review-queue-view";
import {
  listCategories,
  recordAuditEvent,
  resolveReviewItem,
  listReviewItems,
  updateTransactionEnrichment,
  type CategoryRecord,
  type EnrichedTransactionRow,
  type FinanceSupabaseClient,
  type Json,
  type ReviewQueueItem
} from "@/lib/db";
import { getAiProviderStatus } from "@/lib/ai/server";
import { getFinanceServerContext } from "@/lib/demo/server";
import { runAiReviewCleanup } from "@/lib/review/auto-cleanup";
import { planMissingCategoryAutofixes } from "@/lib/review/missing-category-autofix";
import { isRecurringReview } from "@/lib/review/reasons";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted review queue.";
}

function reviewAuditData(item: ReviewQueueItem): Record<string, Json> {
  return {
    categoryId: item.transaction.categoryId,
    categoryName: item.transaction.category,
    confidence: item.transaction.confidence,
    reason: item.reason,
    reviewStatus: item.status,
    transactionId: item.transaction.id
  };
}

function expectRows<T>(
  result: { data: T[] | null; error: { message: string } | null },
  label: string
) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

function transactionNeedsCategoryReview(
  transaction: Pick<EnrichedTransactionRow, "category_id" | "category_name" | "intent">
) {
  const categoryName = transaction.category_name.trim().toLowerCase();
  return transaction.intent !== "transfer" &&
    categoryName !== "transfer" &&
    (!transaction.category_id || !categoryName || categoryName === "uncategorized");
}

function actionableReviewItems(reviewItems: readonly ReviewQueueItem[]) {
  return reviewItems.filter((item) => !isRecurringReview(item.reason));
}

async function ensureMissingCategoryReviews(client: FinanceSupabaseClient, userId: string) {
  const [transactionsResult, existingReviewsResult] = await Promise.all([
    client
      .from("enriched_transactions")
      .select("id,user_id,category_id,category_name,confidence,intent")
      .eq("user_id", userId),
    client
      .from("review_items")
      .select("enriched_transaction_id,reason,status")
      .eq("user_id", userId)
      .eq("reason", "missing-category")
  ]);

  const existingReviewByTransactionId = new Map(
    expectRows<{ enriched_transaction_id: string; status: string }>(
      existingReviewsResult,
      "Load missing-category review coverage"
    ).map((row) => [row.enriched_transaction_id, row])
  );
  const missingCategoryRows = expectRows<Pick<
    EnrichedTransactionRow,
    "category_id" | "category_name" | "confidence" | "id" | "intent" | "user_id"
  >>(
    transactionsResult,
    "Load uncategorized transactions"
  ).filter((transaction) => transactionNeedsCategoryReview(transaction));

  const reviewItems = missingCategoryRows
    .filter((transaction) => !existingReviewByTransactionId.has(transaction.id))
    .map((transaction) => ({
      ai_suggestion: {
        reason: "Choose the right category before trusting this transaction in totals.",
        signals: ["category-missing-or-unlinked"]
      },
      confidence: transaction.confidence,
      enriched_transaction_id: transaction.id,
      explanation: "This transaction is missing a trusted category.",
      reason: "missing-category" as const,
      status: "open" as const,
      user_id: transaction.user_id
    }));
  const reopenTransactionIds = missingCategoryRows
    .filter((transaction) => existingReviewByTransactionId.get(transaction.id)?.status !== "open")
    .filter((transaction) => existingReviewByTransactionId.has(transaction.id))
    .map((transaction) => transaction.id);

  if (reviewItems.length > 0) {
    const result = await client
      .from("review_items")
      .upsert(reviewItems, {
        onConflict: "user_id,enriched_transaction_id,reason"
      })
      .select("id");

    expectRows(result, "Create missing-category review items");
  }

  if (reopenTransactionIds.length > 0) {
    const result = await client
      .from("review_items")
      .update({
        resolution_note: null,
        resolved_at: null,
        status: "open"
      })
      .eq("user_id", userId)
      .eq("reason", "missing-category")
      .in("enriched_transaction_id", reopenTransactionIds)
      .select("id");

    expectRows(result, "Reopen missing-category review items");
  }

  return reviewItems.length + reopenTransactionIds.length;
}

async function autoFixMissingCategoryReviews(
  client: FinanceSupabaseClient,
  userId: string,
  reviewItems: readonly ReviewQueueItem[],
  categories: readonly CategoryRecord[]
) {
  const plans = planMissingCategoryAutofixes(reviewItems, categories);
  if (plans.length === 0) return 0;

  const itemById = new Map(reviewItems.map((item) => [item.id, item]));

  for (const plan of plans) {
    const item = itemById.get(plan.reviewItemId);
    if (!item) continue;

    if (plan.needsCategoryLink) {
      await updateTransactionEnrichment(client, userId, plan.transactionId, {
        categoryId: plan.categoryId,
        categoryName: plan.categoryName
      });
    }

    const resolved = await resolveReviewItem(
      client,
      userId,
      plan.reviewItemId,
      "resolved",
      plan.needsCategoryLink
        ? `Auto-linked exact category match: ${plan.categoryName}.`
        : "Auto-resolved stale missing-category review."
    );

    await recordAuditEvent(client, userId, {
      action: "review.missing_category_auto_fixed",
      actorId: null,
      afterData: {
        ...reviewAuditData(item),
        autoFix: plan as unknown as Record<string, Json>,
        resolvedAt: resolved.resolvedAt,
        reviewStatus: resolved.status
      },
      beforeData: reviewAuditData(item),
      entityId: item.id,
      entityTable: "review_items",
      metadata: {
        linkedCategory: plan.needsCategoryLink,
        source: "review_page_autofix",
        transactionId: plan.transactionId
      }
    });
  }

  return plans.length;
}

export default async function ReviewPage() {
  let dataError: string | undefined;
  let isConfigured = false;
  let isDemo = false;
  let isSignedIn = false;
  let categories: CategoryRecord[] = [];
  let reviewItems: ReviewQueueItem[] = [];
  const aiStatus = getAiProviderStatus();

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isDemo = context.isDemo;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      if (!context.isDemo) {
        await ensureMissingCategoryReviews(context.client, context.userId);
      }

      [categories, reviewItems] = await Promise.all([
        listCategories(context.client, context.userId),
        listReviewItems(context.client, context.userId, "open")
      ]);

      const autoFixedCount = context.isDemo
        ? 0
        : await autoFixMissingCategoryReviews(
          context.client,
          context.userId,
          reviewItems,
          categories
        );

      let cleanupTouched = false;
      if (!context.isDemo && aiStatus.activeKind === "openai" && aiStatus.autoReviewEnabled) {
        try {
          const cleanup = await runAiReviewCleanup({
            client: context.client,
            userId: context.userId
          });
          cleanupTouched = cleanup.suggestionsStored > 0 || cleanup.autoApplied > 0;
        } catch (cleanupError) {
          console.warn("ai_review_cleanup_failed", {
            error: cleanupError instanceof Error ? cleanupError.message : "Unknown"
          });
        }
      }

      if (autoFixedCount > 0 || cleanupTouched) {
        reviewItems = await listReviewItems(context.client, context.userId, "open");
      }

      reviewItems = actionableReviewItems(reviewItems);
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  return (
    <ReviewQueueView
      aiProviderKind={aiStatus.activeKind}
      categories={categories}
      dataError={dataError}
      isConfigured={isConfigured}
      isDemo={isDemo}
      isSignedIn={isSignedIn}
      reviewItems={reviewItems}
    />
  );
}
