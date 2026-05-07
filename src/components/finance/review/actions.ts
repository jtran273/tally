"use server";

import { revalidatePath } from "next/cache";
import {
  getReviewQueueItemById,
  listReviewItems,
  listCategories,
  listMerchantRules,
  recordAuditEvent,
  replaceTransactionSplits,
  resolveReviewItem,
  updateTransactionEnrichment,
  upsertMerchantRule,
  type CategoryRecord,
  type EnrichedTransactionRow,
  type FinanceSupabaseClient,
  type Json,
  type RawTransactionRow,
  type ReviewItemRow,
  type ReviewQueueItem,
  type TransactionIntent,
  type TransactionSplitMutationInput,
  type TransactionSplitRecord
} from "@/lib/db";
import { buildAcceptedAiMerchantRuleCandidate } from "@/lib/merchant-rules";
import { createConfiguredTransactionSuggestionService } from "@/lib/ai/server";
import { attachAiSuggestionsToReviewItems } from "@/lib/review/ai-suggestions";
import { isSpendingIntent } from "@/lib/finance/spending";
import { isPeerToPeerReview } from "@/lib/review/reasons";
import { buildBulkReviewPlan } from "@/lib/review/bulk-actions";
import {
  buildAcceptedReviewSuggestionPatch,
  hasReviewSuggestionValue,
  type NormalizedReviewSuggestion
} from "@/lib/review/suggestions";
import { getFinanceServerContext } from "@/lib/demo/server";

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
  const context = await getFinanceServerContext();
  if (!context.client) throw new Error("Supabase is not configured.");
  if (!context.userId) throw new Error("Sign in to update review items.");

  return {
    client: context.client,
    userId: context.userId
  };
}

function expectRows<T>(
  result: { data: T[] | null; error: { message: string } | null },
  label: string
) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
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

function revalidateReviewListPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/review");
  revalidatePath("/transactions");
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

async function applyAcceptedReviewSuggestion(
  client: FinanceSupabaseClient,
  userId: string,
  item: ReviewQueueItem,
  categories: CategoryRecord[],
  options: { reviewedAt: string; source: "bulk" | "single" }
) {
  const { patch, suggestion } = buildAcceptedReviewSuggestionPatch(item.aiSuggestion, categories, {
    reviewedAt: options.reviewedAt
  });

  if (!hasReviewSuggestionValue(suggestion)) {
    throw new Error("This review item does not include an accept-ready suggestion.");
  }

  const rawTransaction = await getRawTransactionForReviewItem(client, userId, item);
  const ruleCandidate = buildAcceptedAiMerchantRuleCandidate({
    categories,
    rawTransaction,
    suggestion,
    transaction: {
      amount: item.transaction.amount,
      merchant_name: item.transaction.merchant
    }
  });

  await updateTransactionEnrichment(client, userId, item.transaction.id, patch);
  const merchantRule = ruleCandidate
    ? await upsertMerchantRule(client, userId, {
      categoryId: ruleCandidate.categoryId,
      intent: ruleCandidate.intent,
      isRecurring: ruleCandidate.isRecurring,
      merchantPattern: ruleCandidate.merchantPattern,
      normalizedMerchantName: ruleCandidate.normalizedMerchantName,
      notes: ruleCandidate.notes,
      priority: ruleCandidate.priority
    })
    : null;
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
      bulkAction: options.source === "bulk",
      merchantRuleId: merchantRule?.id ?? null,
      reason: item.reason,
      transactionId: item.transaction.id
    }
  });

  if (merchantRule) {
    await recordAuditEvent(client, userId, {
      action: "merchant_rule.ai_accepted_upserted",
      actorId: userId,
      afterData: merchantRule as unknown as Record<string, Json | undefined>,
      beforeData: null,
      entityId: merchantRule.id,
      entityTable: "merchant_rules",
      metadata: {
        bulkAction: options.source === "bulk",
        reviewItemId: item.id,
        transactionId: item.transaction.id
      }
    });
  }

  return {
    merchantRuleId: merchantRule?.id ?? null,
    transactionId: item.transaction.id
  };
}

async function getRawTransactionForReviewItem(
  client: FinanceSupabaseClient,
  userId: string,
  item: ReviewQueueItem
) {
  const result = await client
    .from("raw_transactions")
    .select("*")
    .eq("user_id", userId)
    .eq("id", item.transaction.rawTransactionId)
    .limit(1);
  return expectRows<RawTransactionRow>(result, "Load raw transaction for accepted AI rule")[0] ?? null;
}

export async function generateAiReviewSuggestionsAction(
  _state: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const requestedLimit = Number(cleanString(formData.get("limit"), 8) || "40");
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(80, Math.floor(requestedLimit)))
      : 40;
    const { client, userId } = await getFinanceContext();
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
        .limit(limit),
      "Load open review items for AI cleanup"
    );

    const reviewTargets = reviewRows.filter((row) => !isPeerToPeerReview(row.reason));
    if (reviewTargets.length === 0) {
      return { message: "No AI-ready review items are open." };
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
      maxSuggestions: limit,
      merchantRules,
      rawRows,
      suggestionService: createConfiguredTransactionSuggestionService(),
      transactions
    });

    let updatedCount = 0;
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

      updatedCount += expectRows<{ id: string }>(result, "Store AI review suggestion").length;
    }

    revalidateReviewListPaths();
    return {
      message: updatedCount === 0
        ? "No new AI suggestions were stored."
        : `Stored ${updatedCount.toLocaleString("en-US")} AI cleanup ${updatedCount === 1 ? "suggestion" : "suggestions"}.`
    };
  } catch (error) {
    return errorState(error);
  }
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
    const { suggestion } = buildAcceptedReviewSuggestionPatch(item.aiSuggestion, categories, { reviewedAt });

    if (!hasReviewSuggestionValue(suggestion)) {
      return { error: "This review item does not include an accept-ready suggestion." };
    }

    await applyAcceptedReviewSuggestion(client, userId, item, categories, { reviewedAt, source: "single" });

    revalidateReviewPaths(item.transaction.id);
    return { message: "Suggestion accepted." };
  } catch (error) {
    return errorState(error);
  }
}

export async function bulkAcceptReviewSuggestionsAction(
  _state: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const requestedIds = formData
      .getAll("reviewItemId")
      .map((value) => cleanString(value, 80))
      .filter((value) => uuidPattern.test(value))
      .slice(0, 40);

    if (requestedIds.length === 0) return { error: "No accept-ready review items were selected." };

    const { client, userId } = await getFinanceContext();
    const requestedIdSet = new Set(requestedIds);
    const [categories, openItems] = await Promise.all([
      listCategories(client, userId),
      listReviewItems(client, userId, "open")
    ]);
    const targets = openItems.filter((item) => requestedIdSet.has(item.id));
    const plan = buildBulkReviewPlan(targets, { limit: 40 });

    let acceptedCount = 0;
    const touchedTransactionIds = new Set<string>();
    const reviewedAt = new Date().toISOString();

    for (const item of plan.acceptReady) {
      const target = targets.find((candidate) => candidate.id === item.reviewItemId);
      if (!target) continue;

      await applyAcceptedReviewSuggestion(client, userId, target, categories, {
        reviewedAt,
        source: "bulk"
      });
      acceptedCount += 1;
      touchedTransactionIds.add(target.transaction.id);
    }

    for (const transactionId of touchedTransactionIds) {
      revalidateReviewPaths(transactionId);
    }
    revalidateReviewListPaths();

    const missingCount = requestedIds.length - targets.length;
    const skippedCount = plan.skipped.length + Math.max(0, missingCount);
    const skippedSuffix = skippedCount > 0
      ? ` Skipped ${skippedCount.toLocaleString("en-US")} item${skippedCount === 1 ? "" : "s"} that were no longer eligible.`
      : "";

    return {
      message: acceptedCount === 0
        ? `No suggestions were accepted.${skippedSuffix}`
        : `Accepted ${acceptedCount.toLocaleString("en-US")} AI suggestion${acceptedCount === 1 ? "" : "s"}.${skippedSuffix}`
    };
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
