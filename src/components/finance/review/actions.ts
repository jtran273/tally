"use server";

import { revalidatePath } from "next/cache";
import {
  getReviewQueueItemById,
  listCategories,
  recordAuditEvent,
  resolveReviewItem,
  updateTransactionEnrichment,
  type FinanceSupabaseClient,
  type Json,
  type ReviewQueueItem
} from "@/lib/db";
import { isPeerToPeerReview } from "@/lib/review/reasons";
import {
  buildAcceptedReviewSuggestionPatch,
  hasReviewSuggestionValue,
  type NormalizedReviewSuggestion
} from "@/lib/review/suggestions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ReviewActionState {
  error?: string;
  message?: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanString(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function errorState(error: unknown): ReviewActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to update review item."
  };
}

async function getFinanceContext() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error) throw new Error(`Unable to verify Supabase session: ${error.message}`);
  if (!user) throw new Error("Sign in to update review items.");

  return {
    client: supabase as unknown as FinanceSupabaseClient,
    userId: user.id
  };
}

async function getOpenReviewItem(
  client: FinanceSupabaseClient,
  userId: string,
  reviewItemId: string
): Promise<ReviewQueueItem> {
  const item = await getReviewQueueItemById(client, userId, reviewItemId);
  if (!item) throw new Error("Review item was not found.");
  if (item.status !== "open") throw new Error("This review item is no longer open.");
  return item;
}

function revalidateReviewPaths(transactionId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/review");
  revalidatePath("/transactions");
  revalidatePath(`/transactions/${transactionId}`);
}

function suggestionFieldSummary(suggestion: NormalizedReviewSuggestion) {
  return [
    suggestion.merchantName ? "merchant" : null,
    suggestion.categoryName ? "category" : null,
    suggestion.intent ? "intent" : null,
    suggestion.recurring !== undefined ? "recurring" : null,
    suggestion.confidence !== undefined ? "confidence" : null
  ].filter((field): field is string => Boolean(field));
}

function reviewItemAuditData(item: ReviewQueueItem): Record<string, Json | undefined> {
  return {
    aiSuggestion: item.aiSuggestion,
    confidence: item.confidence,
    reason: item.reason,
    status: item.status,
    transactionId: item.transaction.id
  };
}

export async function acceptReviewSuggestionAction(
  _state: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const reviewItemId = cleanString(formData.get("reviewItemId"), 80);
    if (!uuidPattern.test(reviewItemId)) return { error: "Invalid review item id." };

    const { client, userId } = await getFinanceContext();
    const item = await getOpenReviewItem(client, userId, reviewItemId);

    if (isPeerToPeerReview(item.reason)) {
      return { error: "Peer-to-peer items stay open until the split/explanation workflow from issue #13 exists." };
    }

    const reviewedAt = new Date().toISOString();
    const categories = await listCategories(client, userId);
    const { patch, suggestion } = buildAcceptedReviewSuggestionPatch(item.aiSuggestion, categories, { reviewedAt });

    if (!hasReviewSuggestionValue(suggestion)) {
      return { error: "This review item does not include an accept-ready suggestion." };
    }

    await updateTransactionEnrichment(client, userId, item.transaction.id, patch);
    const resolved = await resolveReviewItem(
      client,
      userId,
      item.id,
      "resolved",
      `Accepted suggestion fields: ${suggestionFieldSummary(suggestion).join(", ")}.`
    );

    await recordAuditEvent(client, userId, {
      action: "review.suggestion_accepted",
      actorId: userId,
      afterData: {
        ...reviewItemAuditData(item),
        appliedPatch: patch as Record<string, Json | undefined>,
        resolvedAt: resolved.resolvedAt,
        status: resolved.status
      },
      beforeData: reviewItemAuditData(item),
      entityId: item.id,
      entityTable: "review_items",
      metadata: {
        reason: item.reason,
        transactionId: item.transaction.id
      }
    });

    revalidateReviewPaths(item.transaction.id);
    return { message: "Suggestion accepted." };
  } catch (error) {
    return errorState(error);
  }
}

export async function dismissReviewItemAction(
  _state: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const reviewItemId = cleanString(formData.get("reviewItemId"), 80);
    if (!uuidPattern.test(reviewItemId)) return { error: "Invalid review item id." };

    const { client, userId } = await getFinanceContext();
    const item = await getOpenReviewItem(client, userId, reviewItemId);

    if (isPeerToPeerReview(item.reason)) {
      return { error: "Peer-to-peer items stay open until they are explained." };
    }

    const note = cleanString(formData.get("resolutionNote"), 240) || "Dismissed from review queue.";
    const dismissed = await resolveReviewItem(client, userId, item.id, "dismissed", note);

    await recordAuditEvent(client, userId, {
      action: "review.dismissed",
      actorId: userId,
      afterData: {
        ...reviewItemAuditData(item),
        resolvedAt: dismissed.resolvedAt,
        resolutionNote: dismissed.resolutionNote,
        status: dismissed.status
      },
      beforeData: reviewItemAuditData(item),
      entityId: item.id,
      entityTable: "review_items",
      metadata: {
        reason: item.reason,
        transactionId: item.transaction.id
      }
    });

    revalidateReviewPaths(item.transaction.id);
    return { message: "Review item dismissed." };
  } catch (error) {
    return errorState(error);
  }
}
