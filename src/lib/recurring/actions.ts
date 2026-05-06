import type {
  BuildConfirmRecurringActionOptions,
  BuildDismissRecurringActionOptions,
  ConfirmRecurringCandidatePayload,
  DismissRecurringCandidatePayload,
  RecurringCandidate,
  RecurringReviewResolutionPayload,
  RecurringTransactionPatchPayload
} from "./types";

const RECURRING_REVIEW_REASONS = new Set(["new-recurring", "recurring-candidate"]);
const RECURRING_EXPENSE_CONFLICT_COLUMNS = ["user_id", "merchant_name", "cadence"] as const;

export function buildConfirmRecurringPayload(
  candidate: RecurringCandidate,
  options: BuildConfirmRecurringActionOptions = {}
): ConfirmRecurringCandidatePayload {
  return {
    action: "confirm-recurring",
    candidateId: candidate.id,
    recurringExpense: {
      table: "recurring_expenses",
      conflictColumns: RECURRING_EXPENSE_CONFLICT_COLUMNS,
      values: {
        user_id: candidate.userId,
        merchant_rule_id: null,
        category_id: candidate.categoryId,
        account_id: candidate.accountId,
        last_transaction_id: candidate.lastTransactionId,
        merchant_name: candidate.merchant,
        amount: candidate.amount,
        cadence: candidate.cadence,
        next_due_date: candidate.nextDueDate,
        last_charge_date: candidate.lastChargeDate,
        last_amount: candidate.lastAmount,
        status: options.status ?? "active",
        is_new: false,
        confidence: candidate.confidence
      }
    },
    transactionUpdates: candidate.transactions.map((transaction) =>
      transactionPatch(transaction.id, true, options.reviewedAt)
    ),
    reviewResolutions: reviewResolutions(
      candidate,
      "resolved",
      options.resolutionNote ?? "Confirmed recurring expense candidate."
    )
  };
}

export function buildDismissRecurringPayload(
  candidate: RecurringCandidate,
  options: BuildDismissRecurringActionOptions = {}
): DismissRecurringCandidatePayload {
  const markTransactionsNonRecurring = options.markTransactionsNonRecurring ?? candidate.isNew;
  const payload: DismissRecurringCandidatePayload = {
    action: "dismiss-recurring",
    candidateId: candidate.id,
    transactionUpdates: markTransactionsNonRecurring
      ? candidate.transactions.map((transaction) => transactionPatch(transaction.id, false, options.reviewedAt))
      : [],
    reviewResolutions: reviewResolutions(
      candidate,
      "dismissed",
      options.resolutionNote ?? "Dismissed recurring expense candidate."
    )
  };

  if (candidate.existingRecurringId && candidate.isNew) {
    payload.recurringExpenseUpdate = {
      table: "recurring_expenses",
      id: candidate.existingRecurringId,
      values: {
        status: "dismissed",
        is_new: false
      }
    };
  }

  return payload;
}

function transactionPatch(
  transactionId: string,
  isRecurring: boolean,
  reviewedAt: string | null | undefined
): RecurringTransactionPatchPayload {
  const patch: RecurringTransactionPatchPayload["patch"] = { isRecurring };
  if (reviewedAt !== undefined) patch.reviewedAt = reviewedAt;

  return {
    transactionId,
    patch
  };
}

function reviewResolutions(
  candidate: RecurringCandidate,
  status: RecurringReviewResolutionPayload["status"],
  resolutionNote: string
): RecurringReviewResolutionPayload[] {
  return candidate.transactions.flatMap((transaction) =>
    transaction.reviewItems
      .filter((review) => review.status === "open" && RECURRING_REVIEW_REASONS.has(review.reason))
      .map((review) => ({
        reviewItemId: review.id,
        status,
        resolutionNote
      }))
  );
}
