"use server";

import { revalidatePath } from "next/cache";
import {
  getReviewQueueItemById,
  listCategories,
  recordAuditEvent,
  replaceTransactionSplits,
  resolveReviewItem,
  updateTransactionEnrichment,
  type CategoryRecord,
  type FinanceSupabaseClient,
  type Json,
  type ReviewQueueItem,
  type TransactionIntent,
  type TransactionSplitMutationInput,
  type TransactionSplitRecord
} from "@/lib/db";
import { isSpendingIntent } from "@/lib/finance/spending";
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

interface ParsedSplit {
  amountCents: number;
  category: CategoryRecord;
  input: TransactionSplitMutationInput;
}

const splitRowLimit = 8;
const transactionIntents = new Set<TransactionIntent>([
  "personal",
  "business",
  "shared",
  "reimbursable",
  "transfer"
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

function cleanString(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanOptionalUuid(value: FormDataEntryValue | null) {
  const text = cleanString(value, 80);
  if (!text || text === "none") return null;
  return uuidPattern.test(text) ? text : undefined;
}

function errorState(error: unknown): ReviewActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to update review item."
  };
}

function parseMoneyCents(value: FormDataEntryValue | null) {
  const text = cleanString(value, 32).replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;

  const [dollars, cents = ""] = text.split(".");
  const parsed = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatMoneyFromCents(cents: number) {
  return moneyFormatter.format(cents / 100);
}

function transactionAmountCents(amount: number) {
  return Math.round(Math.abs(amount) * 100);
}

function parseSplitRows(formData: FormData, categories: CategoryRecord[], totalCents: number) {
  const labels = formData.getAll("splitLabel");
  const amounts = formData.getAll("splitAmount");
  const categoryIds = formData.getAll("splitCategoryId");
  const intents = formData.getAll("splitIntent");
  const notes = formData.getAll("splitNotes");
  const rowCount = Math.max(labels.length, amounts.length, categoryIds.length, intents.length, notes.length);

  if (rowCount === 0) throw new Error("Add at least one split row.");
  if (rowCount > splitRowLimit) throw new Error(`Use ${splitRowLimit} or fewer split rows.`);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const parsed: ParsedSplit[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const rawCategoryId = categoryIds[index] ?? null;
    const rawIntent = intents[index] ?? null;
    const categoryId = cleanOptionalUuid(rawCategoryId);
    const label = cleanString(labels[index] ?? null, 80);
    const amountCents = parseMoneyCents(amounts[index] ?? null);
    const intent = cleanString(rawIntent, 24) as TransactionIntent;
    const note = cleanString(notes[index] ?? null, 240);

    if (!label && amountCents === null && !cleanString(rawCategoryId, 80) && !cleanString(rawIntent, 24) && !note) {
      continue;
    }

    if (!label) throw new Error(`Split row ${index + 1} needs a label.`);
    if (amountCents === null || amountCents <= 0) {
      throw new Error(`Split row ${index + 1} needs a positive dollar amount.`);
    }
    if (categoryId === undefined || categoryId === null) {
      throw new Error(`Split row ${index + 1} needs one of your categories.`);
    }
    if (!transactionIntents.has(intent)) {
      throw new Error(`Split row ${index + 1} needs a valid intent.`);
    }

    const category = categoryById.get(categoryId);
    if (!category) throw new Error(`Split row ${index + 1} needs one of your categories.`);

    parsed.push({
      amountCents,
      category,
      input: {
        amount: amountCents / 100,
        categoryId,
        intent,
        label,
        notes: note || null
      }
    });
  }

  if (parsed.length === 0) throw new Error("Add at least one split row.");

  const allocatedCents = parsed.reduce((sum, split) => sum + split.amountCents, 0);
  if (allocatedCents !== totalCents) {
    throw new Error(
      `Split rows must total ${formatMoneyFromCents(totalCents)}. They currently total ${formatMoneyFromCents(allocatedCents)}.`
    );
  }

  return parsed;
}

function primarySplit(splits: ParsedSplit[]) {
  return splits.find((split) => isSpendingIntent(split.input.intent)) ?? splits[0];
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
    explanation: item.explanation,
    reason: item.reason,
    status: item.status,
    transactionId: item.transaction.id
  };
}

function splitAuditData(split: TransactionSplitRecord): Record<string, Json> {
  return {
    amount: split.amount,
    categoryId: split.categoryId,
    categoryName: split.categoryName,
    id: split.id,
    intent: split.intent,
    label: split.label,
    notes: split.notes
  };
}

function transactionAuditData(item: ReviewQueueItem): Record<string, Json> {
  return {
    categoryId: item.transaction.categoryId,
    categoryName: item.transaction.category,
    intent: item.transaction.intent,
    note: item.transaction.note,
    reviewedAt: item.transaction.reviewedAt
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
      return { error: "Use the peer-to-peer split form to resolve this item." };
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

export async function resolvePeerToPeerReviewAction(
  _state: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const reviewItemId = cleanString(formData.get("reviewItemId"), 80);
    if (!uuidPattern.test(reviewItemId)) return { error: "Invalid review item id." };

    const explanation = cleanString(formData.get("explanation"), 800);
    if (explanation.length < 6) {
      return { error: "Explain what this peer-to-peer transaction was for." };
    }

    const { client, userId } = await getFinanceContext();
    const item = await getOpenReviewItem(client, userId, reviewItemId);

    if (!isPeerToPeerReview(item.reason)) {
      return { error: "Use the standard review actions for this item." };
    }

    const categories = await listCategories(client, userId);
    const totalCents = transactionAmountCents(item.transaction.amount);
    const parsedSplits = parseSplitRows(formData, categories, totalCents);
    const primary = primarySplit(parsedSplits);
    const reviewedAt = new Date().toISOString();
    const transactionPatch = {
      categoryId: primary.input.categoryId,
      categoryName: primary.category.name,
      confidence: 1,
      intent: primary.input.intent,
      note: explanation,
      reviewedAt,
      source: "manual" as const
    };

    const savedSplits = await replaceTransactionSplits(
      client,
      userId,
      item.transaction.id,
      parsedSplits.map((split) => split.input)
    );
    await updateTransactionEnrichment(client, userId, item.transaction.id, transactionPatch);

    const resolutionNote =
      `Peer-to-peer explained and split into ${savedSplits.length} portion${savedSplits.length === 1 ? "" : "s"}.`;
    const resolved = await resolveReviewItem(
      client,
      userId,
      item.id,
      "resolved",
      resolutionNote,
      { explanation }
    );

    await recordAuditEvent(client, userId, {
      action: "review.peer_to_peer_resolved",
      actorId: userId,
      afterData: {
        ...reviewItemAuditData(item),
        explanation,
        resolvedAt: resolved.resolvedAt,
        resolutionNote: resolved.resolutionNote,
        splits: savedSplits.map(splitAuditData),
        status: resolved.status,
        transactionPatch
      },
      beforeData: {
        ...reviewItemAuditData(item),
        splits: item.transaction.splits.map(splitAuditData),
        transaction: transactionAuditData(item)
      },
      entityId: item.id,
      entityTable: "review_items",
      metadata: {
        reason: item.reason,
        splitCount: savedSplits.length,
        transactionId: item.transaction.id
      }
    });

    revalidateReviewPaths(item.transaction.id);
    return { message: "Peer-to-peer review resolved." };
  } catch (error) {
    return errorState(error);
  }
}
