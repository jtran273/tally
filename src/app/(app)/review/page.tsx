import { ReviewQueueView } from "@/components/finance/review/review-queue-view";
import {
  listCategories,
  recordAuditEvent,
  resolveReviewItem,
  listReviewItems,
  listTransactions,
  updateTransactionEnrichment,
  type CategoryRecord,
  type FinanceSupabaseClient,
  type Json,
  type ReviewQueueItem,
  type TransactionRecord
} from "@/lib/db";
import { getAiProviderStatus } from "@/lib/ai/server";
import { getFinanceServerContext } from "@/lib/demo/server";
import { runAiReviewCleanup } from "@/lib/review/auto-cleanup";
import { planMissingCategoryAutofixes } from "@/lib/review/missing-category-autofix";

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
  let isSignedIn = false;
  let categories: CategoryRecord[] = [];
  let reviewItems: ReviewQueueItem[] = [];
  let transactions: TransactionRecord[] = [];
  const aiStatus = getAiProviderStatus();

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      let allReviewItems: ReviewQueueItem[];
      [categories, allReviewItems, transactions] = await Promise.all([
        listCategories(context.client, context.userId),
        listReviewItems(context.client, context.userId, "all"),
        listTransactions(context.client, context.userId)
      ]);

      const autoFixedCount = await autoFixMissingCategoryReviews(
        context.client,
        context.userId,
        allReviewItems,
        categories
      );

      let cleanupTouched = false;
      if (aiStatus.activeKind === "openai") {
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
        [allReviewItems, transactions] = await Promise.all([
          listReviewItems(context.client, context.userId, "all"),
          listTransactions(context.client, context.userId)
        ]);
      }
      reviewItems = allReviewItems.filter((item) => item.status === "open");
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
      isSignedIn={isSignedIn}
      reviewItems={reviewItems}
      transactions={transactions}
    />
  );
}
