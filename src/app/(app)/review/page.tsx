import { ReviewQueueView } from "@/components/finance/review/review-queue-view";
import {
  listCategories,
  listReviewItems,
  listTransactions,
  type AuditEventRow,
  type CategoryRecord,
  type ReviewQueueItem,
  type TransactionRecord
} from "@/lib/db";
import { getAiProviderStatus } from "@/lib/ai/server";
import { getFinanceServerContext } from "@/lib/demo/server";
import { listReviewProductivityAuditEvents } from "@/lib/review/productivity-data";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted review queue.";
}

export default async function ReviewPage() {
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;
  let auditEvents: AuditEventRow[] = [];
  let categories: CategoryRecord[] = [];
  let allReviewItems: ReviewQueueItem[] = [];
  let reviewItems: ReviewQueueItem[] = [];
  let transactions: TransactionRecord[] = [];
  const aiStatus = getAiProviderStatus();

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      [auditEvents, categories, allReviewItems, transactions] = await Promise.all([
        listReviewProductivityAuditEvents(context.client, context.userId, { limit: 500 }),
        listCategories(context.client, context.userId),
        listReviewItems(context.client, context.userId, "all"),
        listTransactions(context.client, context.userId)
      ]);
      reviewItems = allReviewItems.filter((item) => item.status === "open");
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  return (
    <ReviewQueueView
      aiProviderKind={aiStatus.activeKind}
      allReviewItems={allReviewItems}
      auditEvents={auditEvents}
      categories={categories}
      dataError={dataError}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      reviewItems={reviewItems}
      transactions={transactions}
    />
  );
}
