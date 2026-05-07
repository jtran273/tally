import {
  recordAuditEvent,
  resolveReviewItem,
  updateRecurringExpense,
  updateTransactionEnrichment,
  upsertRecurringExpense,
  type FinanceSupabaseClient,
  type Json
} from "../db";
import type {
  BuildConfirmRecurringActionOptions,
  BuildDismissRecurringActionOptions,
  ConfirmRecurringCandidatePayload,
  DismissRecurringCandidatePayload,
  RecurringCandidate,
  RecurringExpenseUpsertPayload,
  RecurringReviewResolutionPayload,
  RecurringTransactionPatchPayload
} from "./types";

const RECURRING_REVIEW_REASONS = new Set(["new-recurring", "recurring-candidate"]);
const RECURRING_EXPENSE_CONFLICT_COLUMNS = ["user_id", "merchant_name", "cadence"] as const;

function recurringExpensePayload(
  candidate: RecurringCandidate,
  status: RecurringExpenseUpsertPayload["values"]["status"],
  isNew: boolean
): RecurringExpenseUpsertPayload {
  return {
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
      status,
      is_new: isNew,
      confidence: candidate.confidence
    }
  };
}

export function buildConfirmRecurringPayload(
  candidate: RecurringCandidate,
  options: BuildConfirmRecurringActionOptions = {}
): ConfirmRecurringCandidatePayload {
  return {
    action: "confirm-recurring",
    candidateId: candidate.id,
    recurringExpense: recurringExpensePayload(candidate, options.status ?? "active", false),
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

  if (!candidate.existingRecurringId) {
    payload.recurringExpense = recurringExpensePayload(candidate, "dismissed", false);
  } else if (candidate.isNew) {
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

export async function applyConfirmRecurringPayload(
  client: FinanceSupabaseClient,
  userId: string,
  payload: ConfirmRecurringCandidatePayload,
  options: { actorId?: string | null } = {}
) {
  const recurringExpense = await upsertRecurringExpense(
    client,
    userId,
    payload.recurringExpense.values,
    payload.recurringExpense.conflictColumns.join(",")
  );

  await applyTransactionUpdates(client, userId, payload.transactionUpdates);
  await applyReviewResolutions(client, userId, payload.reviewResolutions);

  await recordAuditEvent(client, userId, {
    action: "recurring.candidate_confirmed",
    actorId: options.actorId ?? userId,
    afterData: recurringAuditData(payload),
    beforeData: null,
    entityId: recurringExpense.id,
    entityTable: payload.recurringExpense.table,
    metadata: recurringAuditMetadata(payload)
  });

  return recurringExpense;
}

export async function applyDismissRecurringPayload(
  client: FinanceSupabaseClient,
  userId: string,
  payload: DismissRecurringCandidatePayload,
  options: { actorId?: string | null } = {}
) {
  const recurringExpense = payload.recurringExpenseUpdate
    ? await updateRecurringExpense(client, userId, payload.recurringExpenseUpdate.id, payload.recurringExpenseUpdate.values)
    : payload.recurringExpense
      ? await upsertRecurringExpense(
        client,
        userId,
        payload.recurringExpense.values,
        payload.recurringExpense.conflictColumns.join(",")
      )
      : null;

  await applyTransactionUpdates(client, userId, payload.transactionUpdates);
  await applyReviewResolutions(client, userId, payload.reviewResolutions);

  await recordAuditEvent(client, userId, {
    action: "recurring.candidate_dismissed",
    actorId: options.actorId ?? userId,
    afterData: recurringAuditData(payload),
    beforeData: null,
    entityId: recurringExpense?.id ?? null,
    entityTable: payload.recurringExpenseUpdate?.table ?? payload.recurringExpense?.table ?? "recurring_expenses",
    metadata: recurringAuditMetadata(payload)
  });

  return recurringExpense;
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

async function applyTransactionUpdates(
  client: FinanceSupabaseClient,
  userId: string,
  updates: RecurringTransactionPatchPayload[]
) {
  await Promise.all(
    updates.map((update) =>
      updateTransactionEnrichment(client, userId, update.transactionId, update.patch)
    )
  );
}

async function applyReviewResolutions(
  client: FinanceSupabaseClient,
  userId: string,
  resolutions: RecurringReviewResolutionPayload[]
) {
  await Promise.all(
    resolutions.map((resolution) =>
      resolveReviewItem(client, userId, resolution.reviewItemId, resolution.status, resolution.resolutionNote)
    )
  );
}

function recurringAuditData(payload: ConfirmRecurringCandidatePayload | DismissRecurringCandidatePayload): Json {
  const recurringStatus = payload.action === "confirm-recurring"
    ? payload.recurringExpense.values.status
    : payload.recurringExpense?.values.status ?? payload.recurringExpenseUpdate?.values.status ?? null;

  return {
    action: payload.action,
    candidateId: payload.candidateId,
    recurringStatus,
    reviewResolutionCount: payload.reviewResolutions.length,
    transactionUpdateCount: payload.transactionUpdates.length
  };
}

function recurringAuditMetadata(payload: ConfirmRecurringCandidatePayload | DismissRecurringCandidatePayload) {
  return {
    candidateId: payload.candidateId,
    reviewItemIds: payload.reviewResolutions.map((resolution) => resolution.reviewItemId),
    transactionIds: payload.transactionUpdates.map((update) => update.transactionId)
  };
}
