import { ReviewQueueView } from "@/components/finance/review/review-queue-view";
import {
  listCategories,
  listReviewItems,
  listTransactions,
  type CategoryRecord,
  type ReviewQueueItem,
  type TransactionRecord
} from "@/lib/db";
import { getAiProviderStatus } from "@/lib/ai/server";
import { getFinanceServerContext } from "@/lib/demo/server";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted review queue.";
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
      [categories, reviewItems, transactions] = await Promise.all([
        listCategories(context.client, context.userId),
        listReviewItems(context.client, context.userId, "open"),
        listTransactions(context.client, context.userId)
      ]);
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
