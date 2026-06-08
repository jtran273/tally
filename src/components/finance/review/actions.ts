"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import {
  getEnrichedTransactionRow,
  getReviewQueueItemById,
  listCategories,
  listMerchantRules,
  recordAuditEvent,
  replaceTransactionSplitsAndSyncReimbursements,
  resolveReviewItem,
  updateTransactionEnrichment,
  upsertMerchantRule,
  type CategoryRecord,
  type Database,
  type FinanceSupabaseClient,
  type Json,
  type RawTransactionRow,
  type ReviewItemRow,
  type ReviewQueueItem,
  type TransactionIntent,
  type TransactionSplitMutationInput,
  type TransactionSplitRecord
} from "@/lib/db";
import { createConfiguredTransactionSuggestionService } from "@/lib/ai/server";
import { buildAcceptedAiMerchantRuleCandidate } from "@/lib/merchant-rules";
import {
  displayTransactionIntent,
  transactionIntentFromUi,
  transactionTagFromIntent,
  type TransactionTag,
  type UserTransactionIntent
} from "@/lib/finance/classification";
import { isSpendingIntent } from "@/lib/finance/spending";
import { attachAiSuggestionsToReviewItems } from "@/lib/review/ai-suggestions";
import { isManualTransactionEditResolvableReview, isPeerToPeerReview } from "@/lib/review/reasons";
import {
  buildAcceptedReviewSuggestionPatch,
  describeReviewSuggestionRefresh,
  hasReviewSuggestionValue,
  normalizeReviewSuggestion,
  type NormalizedReviewSuggestion
} from "@/lib/review/suggestions";
import { loadRecentUserCorrections } from "@/lib/review/user-corrections";
import { getFinanceServerContext } from "@/lib/demo/server";
import { getSupabaseConfig } from "@/lib/supabase/env";
import {
  resolveProactiveScanHistoricalLookbackDays,
  resolveProactiveScanHistoricalMaxCandidates,
  resolveProactiveScanHistoricalMaxTransactions,
  runProactiveReimbursementScan
} from "@/lib/agents/proactive-scan";

export interface ReviewActionState {
  error?: string;
  message?: string;
}

export interface HistoricalReimbursementScanActionState extends ReviewActionState {
  createdProposalCount?: number;
  scannedTransactionCount?: number;
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
const userTransactionIntents = new Set<UserTransactionIntent>(["personal", "business"]);
const transactionTags = new Set<TransactionTag>(["none", "reimbursable", "transfer"]);
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

function requestedTagFromForm(formData: FormData, fallback: TransactionTag = "none") {
  const checkboxTags = [
    formData.get("isReimbursable") === "1" ? "reimbursable" : null,
    formData.get("isTransfer") === "1" ? "transfer" : null
  ].filter((tag): tag is Exclude<TransactionTag, "none"> => tag !== null);

  if (checkboxTags.length > 1) return { error: "Choose Reimbursable or Transfer, not both." };
  const checkboxTag = checkboxTags[0];
  if (checkboxTag) return { tag: checkboxTag };

  const requestedTag = (cleanString(formData.get("tag"), 24) || fallback) as TransactionTag;
  if (!transactionTags.has(requestedTag)) return { error: "Choose a valid transaction flag." };
  return { tag: requestedTag };
}

function errorState(error: unknown): ReviewActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to update review item."
  };
}

function serviceRoleFinanceClient(): FinanceSupabaseClient | null {
  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !serviceRoleKey) return null;

  return createClient<Database>(config.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }) as unknown as FinanceSupabaseClient;
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
  const splitIds = formData.getAll("splitId");
  const rowCount = Math.max(labels.length, amounts.length, categoryIds.length, intents.length, notes.length, splitIds.length);

  if (rowCount === 0) throw new Error("Add at least one split row.");
  if (rowCount > splitRowLimit) throw new Error(`Use ${splitRowLimit} or fewer split rows.`);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const parsed: ParsedSplit[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const rawCategoryId = categoryIds[index] ?? null;
    const rawIntent = intents[index] ?? null;
    const rawSplitId = splitIds[index] ?? null;
    const categoryId = cleanOptionalUuid(rawCategoryId);
    const label = cleanString(labels[index] ?? null, 80);
    const amountCents = parseMoneyCents(amounts[index] ?? null);
    const intent = cleanString(rawIntent, 24) as TransactionIntent;
    const note = cleanString(notes[index] ?? null, 240);
    const splitId = cleanOptionalUuid(rawSplitId);

    if (!label && amountCents === null && !cleanString(rawCategoryId, 80) && !cleanString(rawIntent, 24) && !note && !cleanString(rawSplitId, 80)) {
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
    if (splitId === undefined) {
      throw new Error(`Split row ${index + 1} has an invalid split id.`);
    }

    const category = categoryById.get(categoryId);
    if (!category) throw new Error(`Split row ${index + 1} needs one of your categories.`);

    parsed.push({
      amountCents,
      category,
      input: {
        amount: amountCents / 100,
        categoryId,
        id: splitId,
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
    isDemo: context.isDemo,
    userId: context.userId
  };
}

async function getWritableFinanceContext(action: string) {
  const context = await getFinanceContext();
  if (context.isDemo) {
    throw new Error(`Demo mode is read-only. Sign in to ${action} real review items.`);
  }
  return context;
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

function transactionEditableAuditData(item: ReviewQueueItem): Record<string, Json> {
  return {
    ...transactionAuditData(item),
    isRecurring: item.transaction.recurring,
    merchantName: item.transaction.merchant
  };
}

function getSelectedCategory(categories: CategoryRecord[], categoryId: string | null) {
  if (!categoryId) return null;
  return categories.find((category) => category.id === categoryId) ?? null;
}

async function listOpenReviewItemsForTransaction(
  client: FinanceSupabaseClient,
  userId: string,
  item: ReviewQueueItem
): Promise<ReviewQueueItem[]> {
  const rows = expectRows<ReviewItemRow>(
    await client
      .from("review_items")
      .select("*")
      .eq("user_id", userId)
      .eq("enriched_transaction_id", item.transaction.id)
      .eq("status", "open"),
    "Load related open review items"
  );

  return rows.map((row) => ({
    aiSuggestion: row.ai_suggestion,
    confidence: row.confidence,
    createdAt: row.created_at,
    explanation: row.explanation,
    id: row.id,
    reason: row.reason,
    resolutionKind: row.resolution_kind,
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at,
    status: row.status,
    transaction: item.transaction,
    transactionId: row.enriched_transaction_id
  }));
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
    "accepted_ai",
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

export async function acceptReviewSuggestionAction(
  _state: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const reviewItemId = cleanString(formData.get("reviewItemId"), 80);
    const { client, userId } = await getWritableFinanceContext("accept suggestions for");
    if (!uuidPattern.test(reviewItemId)) return { error: "Invalid review item id." };

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

    const result = await applyAcceptedReviewSuggestion(client, userId, item, categories, { reviewedAt, source: "single" });

    revalidateReviewPaths(item.transaction.id);
    return {
      message: result.merchantRuleId
        ? "Suggestion accepted and merchant rule saved for future matching."
        : "Suggestion accepted."
    };
  } catch (error) {
    return errorState(error);
  }
}

export async function runHistoricalReimbursementScanAction(
  _state: HistoricalReimbursementScanActionState
): Promise<HistoricalReimbursementScanActionState> {
  try {
    const context = await getWritableFinanceContext("scan historical reimbursements for");
    const maxTransactions = resolveProactiveScanHistoricalMaxTransactions();
    const maxCandidateProposals = resolveProactiveScanHistoricalMaxCandidates();
    const lookbackDays = resolveProactiveScanHistoricalLookbackDays();
    const scanClient = serviceRoleFinanceClient() ?? context.client;
    const scan = await runProactiveReimbursementScan(scanClient, context.userId, {
      includeDisconnectedAccounts: true,
      lookbackDays,
      maxCandidateProposals,
      maxTransactions,
      mode: "historical_backfill"
    });

    if (scan.status === "failed") {
      return { error: "Historical reimbursement scan failed before creating proposals." };
    }

    revalidatePath("/agent-inbox");
    revalidatePath("/dashboard");
    revalidatePath("/review");
    revalidatePath("/transactions");

    return {
      createdProposalCount: scan.createdProposalCount,
      message: `Historical scan checked ${scan.scannedTransactionCount.toLocaleString("en-US")} transactions and queued ${scan.createdProposalCount.toLocaleString("en-US")} proposal${scan.createdProposalCount === 1 ? "" : "s"}.`,
      scannedTransactionCount: scan.scannedTransactionCount
    };
  } catch (error) {
    return errorState(error);
  }
}

export interface BulkAcceptReviewState extends ReviewActionState {
  accepted?: number;
  skipped?: number;
  failed?: number;
  failures?: Array<{ reviewItemId: string; reason: string }>;
}

const BULK_ACCEPT_LIMIT = 25;

export async function bulkAcceptReviewSuggestionsAction(
  _state: BulkAcceptReviewState,
  formData: FormData
): Promise<BulkAcceptReviewState> {
  try {
    const rawIds = formData.getAll("reviewItemId").map((value) => String(value));
    const reviewItemIds = Array.from(
      new Set(rawIds.filter((id) => uuidPattern.test(id)))
    ).slice(0, BULK_ACCEPT_LIMIT);

    if (reviewItemIds.length === 0) {
      return { error: "Select at least one accept-ready review item." };
    }

    const { client, userId } = await getWritableFinanceContext("bulk-accept suggestions for");
    const reviewedAt = new Date().toISOString();
    const categories = await listCategories(client, userId);

    let accepted = 0;
    let skipped = 0;
    const failures: Array<{ reviewItemId: string; reason: string }> = [];
    const touchedTransactionIds: string[] = [];

    for (const reviewItemId of reviewItemIds) {
      try {
        const item = await getOpenReviewItem(client, userId, reviewItemId);
        if (isPeerToPeerReview(item.reason)) {
          skipped += 1;
          failures.push({ reviewItemId, reason: "Peer-to-peer items must be resolved one by one." });
          continue;
        }
        const { suggestion } = buildAcceptedReviewSuggestionPatch(item.aiSuggestion, categories, {
          reviewedAt
        });
        if (!hasReviewSuggestionValue(suggestion)) {
          skipped += 1;
          failures.push({ reviewItemId, reason: "No accept-ready suggestion attached." });
          continue;
        }

        const result = await applyAcceptedReviewSuggestion(client, userId, item, categories, {
          reviewedAt,
          source: "bulk"
        });
        accepted += 1;
        touchedTransactionIds.push(result.transactionId);
      } catch (itemError) {
        failures.push({
          reviewItemId,
          reason: itemError instanceof Error ? itemError.message : "Unknown error."
        });
      }
    }

    if (touchedTransactionIds.length > 0) {
      revalidateReviewListPaths();
      Array.from(new Set(touchedTransactionIds)).forEach((id) => {
        revalidatePath(`/transactions/${id}`);
      });
    }

    const failedCount = failures.length - skipped;
    const summaryParts = [
      `${accepted} accepted`,
      skipped > 0 ? `${skipped} skipped` : null,
      failedCount > 0 ? `${failedCount} failed` : null
    ].filter((part): part is string => Boolean(part));

    return {
      accepted,
      skipped,
      failed: Math.max(0, failedCount),
      failures: failures.length > 0 ? failures.slice(0, 5) : undefined,
      message: accepted > 0 ? `Bulk apply complete: ${summaryParts.join(", ")}.` : undefined,
      error: accepted === 0 ? summaryParts.join(", ") : undefined
    };
  } catch (error) {
    return errorState(error) as BulkAcceptReviewState;
  }
}

export async function dismissReviewItemAction(
  _state: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const reviewItemId = cleanString(formData.get("reviewItemId"), 80);
    const { client, userId } = await getWritableFinanceContext("dismiss");
    if (!uuidPattern.test(reviewItemId)) return { error: "Invalid review item id." };

    const item = await getOpenReviewItem(client, userId, reviewItemId);

    if (isPeerToPeerReview(item.reason)) {
      return { error: "Peer-to-peer items stay open until they are explained." };
    }

    const note = cleanString(formData.get("resolutionNote"), 240) || "Dismissed from review queue.";
    const dismissed = await resolveReviewItem(client, userId, item.id, "dismissed", "dismissed", note);

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

export async function generateReviewSuggestionAction(
  _state: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const reviewItemId = cleanString(formData.get("reviewItemId"), 80);
    const { client, userId } = await getWritableFinanceContext("generate suggestions for");
    if (!uuidPattern.test(reviewItemId)) return { error: "Invalid review item id." };

    const item = await getOpenReviewItem(client, userId, reviewItemId);

    if (isPeerToPeerReview(item.reason)) {
      return { error: "Use the peer-to-peer split form to explain this item." };
    }

    const [categories, merchantRules, transactionRow, rawTransaction, userCorrections] = await Promise.all([
      listCategories(client, userId),
      listMerchantRules(client, userId),
      getEnrichedTransactionRow(client, userId, item.transaction.id),
      getRawTransactionForReviewItem(client, userId, item),
      loadRecentUserCorrections(client, userId, 20)
    ]);

    if (!transactionRow || !rawTransaction) {
      return { error: "Unable to load the transaction context for this suggestion." };
    }

    const previousSuggestion = normalizeReviewSuggestion(item.aiSuggestion);
    const targets = [{
      ai_suggestion: item.aiSuggestion,
      confidence: item.confidence,
      enriched_transaction_id: item.transaction.id,
      id: item.id,
      reason: item.reason,
      status: item.status,
      user_id: userId
    }];
    const updates = await attachAiSuggestionsToReviewItems(targets, {
      cacheKey: `user:${userId}`,
      categories,
      concurrency: 1,
      maxSuggestions: 1,
      merchantRules,
      rawRows: [rawTransaction],
      suggestionService: createConfiguredTransactionSuggestionService(),
      transactions: [transactionRow],
      userCorrections
    });
    const suggestion = updates[0]?.item;

    if (!suggestion) {
      return { error: "Unable to generate a suggestion for this review item." };
    }

    const storedRows = expectRows<{ id: string }>(
      await client
        .from("review_items")
        .update({
          ai_suggestion: suggestion.ai_suggestion,
          confidence: suggestion.confidence ?? null
        })
        .eq("user_id", userId)
        .eq("id", item.id)
        .eq("status", "open")
        .select("id"),
      "Store generated review suggestion"
    );

    if (storedRows.length === 0) {
      return { error: "This review item is no longer open." };
    }

    await recordAuditEvent(client, userId, {
      action: "review.suggestion_generated",
      actorId: userId,
      afterData: {
        ...reviewItemAuditData(item),
        aiSuggestion: suggestion.ai_suggestion,
        confidence: suggestion.confidence
      },
      beforeData: reviewItemAuditData(item),
      entityId: item.id,
      entityTable: "review_items",
      metadata: {
        reason: item.reason,
        source: "manual_review_action",
        transactionId: item.transaction.id
      }
    });

    revalidateReviewPaths(item.transaction.id);
    return {
      message: describeReviewSuggestionRefresh(
        previousSuggestion,
        normalizeReviewSuggestion(suggestion.ai_suggestion)
      )
    };
  } catch (error) {
    return errorState(error);
  }
}

export async function editReviewTransactionAction(
  _state: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  try {
    const reviewItemId = cleanString(formData.get("reviewItemId"), 80);
    const { client, userId } = await getWritableFinanceContext("edit");
    if (!uuidPattern.test(reviewItemId)) return { error: "Invalid review item id." };

    const merchantName = cleanString(formData.get("merchantName"), 160);
    if (!merchantName) return { error: "Merchant is required." };

    const categoryId = cleanOptionalUuid(formData.get("categoryId"));
    if (categoryId === undefined || categoryId === null) {
      return { error: "Choose a category to finalize this review." };
    }

    const legacyIntent = cleanString(formData.get("intent"), 24) as TransactionIntent;
    const requestedBaseIntent = (cleanString(formData.get("baseIntent"), 24) || displayTransactionIntent(legacyIntent)) as UserTransactionIntent;
    if (!userTransactionIntents.has(requestedBaseIntent)) return { error: "Choose Personal or Business." };

    const tagResult = requestedTagFromForm(formData, transactionTagFromIntent(legacyIntent));
    if ("error" in tagResult) return { error: tagResult.error };

    const requestedIntent = transactionIntentFromUi(requestedBaseIntent, tagResult.tag);

    const [item, categories] = await Promise.all([
      getOpenReviewItem(client, userId, reviewItemId),
      listCategories(client, userId)
    ]);

    if (isPeerToPeerReview(item.reason)) {
      return { error: "Use the peer-to-peer split form to finalize this item." };
    }

    const selectedCategory = getSelectedCategory(categories, categoryId);
    if (!selectedCategory) return { error: "Choose one of your categories." };

    const categoryName = cleanString(formData.get("categoryName"), 160) || selectedCategory.name;
    const note = cleanString(formData.get("note"), 1000);
    const reviewedAt = new Date().toISOString();
    const transactionPatch = {
      categoryId,
      categoryName,
      confidence: 1,
      intent: requestedIntent,
      isRecurring: formData.get("isRecurring") === "1",
      merchantName,
      note,
      reviewedAt,
      source: "manual" as const
    };
    const relatedItems = (await listOpenReviewItemsForTransaction(client, userId, item))
      .filter((candidate) => isManualTransactionEditResolvableReview(candidate.reason));
    const itemsToResolve = relatedItems.length > 0 ? relatedItems : [item];
    const resolvedItems = [];

    await updateTransactionEnrichment(client, userId, item.transaction.id, transactionPatch);

    const editSuggestion: NormalizedReviewSuggestion = {
      categoryId,
      categoryName,
      confidence: 1,
      intent: requestedIntent,
      merchantName,
      recurring: transactionPatch.isRecurring,
      signals: []
    };
    const rawTransaction = await getRawTransactionForReviewItem(client, userId, item);
    const ruleCandidate = buildAcceptedAiMerchantRuleCandidate({
      categories,
      rawTransaction,
      suggestion: editSuggestion,
      transaction: {
        amount: item.transaction.amount,
        merchant_name: item.transaction.merchant
      }
    });
    const merchantRule = ruleCandidate
      ? await upsertMerchantRule(client, userId, {
        categoryId: ruleCandidate.categoryId,
        intent: ruleCandidate.intent,
        isRecurring: ruleCandidate.isRecurring,
        merchantPattern: ruleCandidate.merchantPattern,
        normalizedMerchantName: ruleCandidate.normalizedMerchantName,
        notes: `Learned from manual edit on ${new Date().toISOString().slice(0, 10)}.`,
        priority: ruleCandidate.priority
      })
      : null;

    if (merchantRule) {
      await recordAuditEvent(client, userId, {
        action: "merchant_rule.learned_from_edit",
        actorId: userId,
        afterData: merchantRule as unknown as Record<string, Json | undefined>,
        beforeData: null,
        entityId: merchantRule.id,
        entityTable: "merchant_rules",
        metadata: {
          source: "review_inline_edit",
          transactionId: item.transaction.id
        }
      });
    }

    for (const target of itemsToResolve) {
      const resolved = await resolveReviewItem(
        client,
        userId,
        target.id,
        "resolved",
        "edited",
        merchantRule
          ? "Edited transaction in review queue and saved merchant rule."
          : "Edited transaction in review queue and finalized."
      );
      resolvedItems.push(resolved);

      await recordAuditEvent(client, userId, {
        action: "review.transaction_edited_resolved",
        actorId: userId,
        afterData: {
          ...reviewItemAuditData(target),
          appliedPatch: transactionPatch as Record<string, Json | undefined>,
          resolvedAt: resolved.resolvedAt,
          status: resolved.status,
          transaction: {
            ...transactionEditableAuditData(target),
            ...transactionPatch
          }
        },
        beforeData: {
          ...reviewItemAuditData(target),
          transaction: transactionEditableAuditData(target)
        },
        entityId: target.id,
        entityTable: "review_items",
        metadata: {
          resolvedRelatedCount: itemsToResolve.length,
          source: "review_inline_edit",
          transactionId: item.transaction.id
        }
      });
    }

    revalidateReviewPaths(item.transaction.id);
    return {
      message: resolvedItems.length > 1
        ? `Transaction saved and ${resolvedItems.length.toLocaleString("en-US")} review items finalized.`
        : "Transaction saved and review finalized."
    };
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
    const { client, userId } = await getWritableFinanceContext("resolve");
    if (!uuidPattern.test(reviewItemId)) return { error: "Invalid review item id." };

    const explanation = cleanString(formData.get("explanation"), 800);
    if (explanation.length < 6) {
      return { error: "Explain what this peer-to-peer transaction was for." };
    }

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

    const savedSplits = await replaceTransactionSplitsAndSyncReimbursements(
      client,
      userId,
      item.transaction.id,
      parsedSplits.map((split) => split.input),
      {
        actorId: userId,
        source: "review_peer_to_peer_split_resolution"
      }
    );
    await updateTransactionEnrichment(client, userId, item.transaction.id, transactionPatch);

    const resolutionNote =
      `Peer-to-peer explained and split into ${savedSplits.length} portion${savedSplits.length === 1 ? "" : "s"}.`;
    const resolved = await resolveReviewItem(
      client,
      userId,
      item.id,
      "resolved",
      "accepted_manual",
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
