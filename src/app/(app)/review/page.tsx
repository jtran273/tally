import { ReviewQueueView } from "@/components/finance/review/review-queue-view";
import {
  listReviewItems,
  listTransactions,
  type FinanceSupabaseClient,
  type ReviewQueueItem,
  type TransactionRecord
} from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted review queue.";
}

export default async function ReviewPage() {
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;
  let reviewItems: ReviewQueueItem[] = [];
  let transactions: TransactionRecord[] = [];

  const supabase = await createSupabaseServerClient();
  isConfigured = Boolean(supabase);

  if (supabase) {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    if (error) {
      dataError = `Unable to verify Supabase session: ${error.message}`;
    }

    if (user) {
      isSignedIn = true;
      const financeClient = supabase as unknown as FinanceSupabaseClient;

      try {
        [reviewItems, transactions] = await Promise.all([
          listReviewItems(financeClient, user.id, "open"),
          listTransactions(financeClient, user.id)
        ]);
      } catch (loadError) {
        dataError = errorMessage(loadError);
      }
    }
  }

  return (
    <ReviewQueueView
      dataError={dataError}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      reviewItems={reviewItems}
      transactions={transactions}
    />
  );
}
