"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getEnrichedTransactionRow,
  linkReimbursementReceivedTransaction,
  listCategories,
  listTransactions,
  recordAuditEvent,
  resolveReviewItem,
  unlinkReimbursementReceivedTransaction,
  updateTransactionEnrichment,
  upsertCategory,
  upsertMerchantRule,
  type CategoryRecord,
  type EnrichedTransactionRow,
  type FinanceSupabaseClient,
  type Json,
  type ReviewItemRow,
  type TransactionRecord,
  type TransactionIntent
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import {
  displayTransactionIntent,
  isTransferCategoryName,
  transactionIntentFromUi,
  transactionTagFromIntent,
  type TransactionTag,
  type UserTransactionIntent
} from "@/lib/finance/classification";
import { isManualTransactionEditResolvableReview } from "@/lib/review/reasons";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface TransactionEditActionState {
  error?: string;
}

export interface MerchantCleanupActionState {
  error?: string;
  message?: string;
}

export interface ReimbursementLinkActionState {
  error?: string;
  message?: string;
}

const transactionIntents = new Set<TransactionIntent>([
  "personal",
  "business",
  "shared",
  "reimbursable",
  "transfer"
]);
const userTransactionIntents = new Set<UserTransactionIntent>(["personal", "business"]);
const transactionTags = new Set<TransactionTag>(["none", "reimbursable", "transfer"]);
const NEW_CATEGORY_VALUE = "__new_category__";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanString(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeSearch(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeMerchantKey(value: string) {
  return value
    .toUpperCase()
    .replace(/['".,;:()[\]{}#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeMerchantRulePattern(value: string) {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
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

function getSelectedCategory(categories: CategoryRecord[], categoryId: string | null) {
  if (!categoryId) return null;
  return categories.find((category) => category.id === categoryId) ?? null;
}

function transactionSnapshot(row: EnrichedTransactionRow): Record<string, Json> {
  return {
    categoryId: row.category_id,
    categoryName: row.category_name,
    confidence: row.confidence,
    intent: row.intent,
    isRecurring: row.is_recurring,
    merchantName: row.merchant_name,
    note: row.note,
    reviewedAt: row.reviewed_at,
    source: row.source
  };
}

function changedEditableFields(
  before: EnrichedTransactionRow,
  after: Omit<ReturnType<typeof transactionSnapshot>, "source">
) {
  const beforeSnapshot = transactionSnapshot(before);

  return ([
    "merchantName",
    "categoryId",
    "categoryName",
    "intent",
    "note",
    "isRecurring"
  ] as const).filter((field) => beforeSnapshot[field] !== after[field]);
}

function pickFields(snapshot: Record<string, Json>, fields: readonly string[]) {
  return fields.reduce<Record<string, Json>>((picked, field) => {
    picked[field] = snapshot[field] ?? null;
    return picked;
  }, {});
}

function errorState(error: unknown): TransactionEditActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to update transaction."
  };
}

function cleanupErrorState(error: unknown): MerchantCleanupActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to apply merchant cleanup."
  };
}

function reimbursementLinkErrorState(error: unknown): ReimbursementLinkActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to update reimbursement link."
  };
}

function expectRows<T>(
  result: { data: T[] | null; error: { message: string } | null },
  label: string
) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

function cleanOptionalAmount(value: FormDataEntryValue | null) {
  const text = cleanString(value, 40);
  if (!text) return undefined;
  const amount = Number.parseFloat(text);
  return Number.isFinite(amount) ? amount : null;
}

function merchantText(transaction: TransactionRecord) {
  return [
    transaction.merchant,
    transaction.plaidMerchant,
    transaction.plaidName
  ].filter(Boolean).join(" ");
}

function merchantMatchesQuery(transaction: TransactionRecord, merchantQuery: string) {
  const query = normalizeSearch(merchantQuery);
  if (!query) return false;
  return [
    transaction.merchant,
    transaction.plaidMerchant,
    transaction.plaidName
  ].some((value) => normalizeSearch(value).includes(query));
}

function merchantRulePattern(merchantQuery: string) {
  const key = normalizeMerchantKey(merchantQuery);
  const parts = key.split(" ").filter(Boolean);
  const patternKey = parts.length === 2 && parts[1].length === 1 ? parts[0] : key;
  if (patternKey.length < 3) return null;
  return `${escapeMerchantRulePattern(patternKey)}%`;
}

function transactionCleanupSnapshot(transaction: TransactionRecord): Record<string, Json> {
  return {
    categoryId: transaction.categoryId,
    categoryName: transaction.category,
    confidence: transaction.confidence,
    intent: transaction.intent,
    merchantName: transaction.merchant,
    reviewStatus: transaction.reviewStatus
  };
}

function canResolveReviewWithManualTransactionEdit(
  review: ReviewItemRow,
  edit: { categoryId: string | null; intent: TransactionIntent }
) {
  if (!isManualTransactionEditResolvableReview(review.reason)) return false;
  if (review.reason === "missing-category") {
    return Boolean(edit.categoryId) || edit.intent === "transfer";
  }
  return true;
}

async function listResolvableReviewItemsForTransaction(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string,
  edit: { categoryId: string | null; intent: TransactionIntent }
) {
  const rows = expectRows<ReviewItemRow>(
    await client
      .from("review_items")
      .select("*")
      .eq("user_id", userId)
      .eq("enriched_transaction_id", transactionId)
      .eq("status", "open"),
    "Load open review items for transaction edit"
  );

  return rows.filter((row) => canResolveReviewWithManualTransactionEdit(row, edit));
}

async function resolveManualEditReviewItemsForTransaction({
  client,
  reviewedAt,
  reviewItems,
  transactionId,
  userId
}: {
  client: FinanceSupabaseClient;
  reviewedAt: string;
  reviewItems: ReviewItemRow[];
  transactionId: string;
  userId: string;
}) {
  for (const item of reviewItems) {
    const resolved = await resolveReviewItem(
      client,
      userId,
      item.id,
      "resolved",
      "edited",
      "Edited transaction details and finalized review."
    );

    await recordAuditEvent(client, userId, {
      action: "review.transaction_edit_resolved",
      actorId: userId,
      afterData: {
        reason: item.reason,
        resolvedAt: resolved.resolvedAt ?? reviewedAt,
        status: resolved.status,
        transactionId
      },
      beforeData: {
        reason: item.reason,
        status: item.status,
        transactionId
      },
      entityId: item.id,
      entityTable: "review_items",
      metadata: {
        source: "transaction_edit_form",
        transactionId
      }
    });
  }

  return reviewItems.length;
}

export async function applyMerchantCleanupAction(
  _state: MerchantCleanupActionState,
  formData: FormData
): Promise<MerchantCleanupActionState> {
  try {
    const merchantQuery = cleanString(formData.get("merchantQuery"), 160);
    if (normalizeSearch(merchantQuery).length < 2) {
      return { error: "Enter at least 2 searchable merchant characters." };
    }

    const requestedBaseIntent = cleanString(formData.get("baseIntent") ?? formData.get("intent"), 24) as UserTransactionIntent;
    if (!userTransactionIntents.has(requestedBaseIntent)) return { error: "Choose Personal or Business." };

    const tagResult = requestedTagFromForm(formData);
    if ("error" in tagResult) return { error: tagResult.error };

    const requestedIntent = transactionIntentFromUi(requestedBaseIntent, tagResult.tag);

    const context = await getFinanceServerContext();
    if (!context.client) return { error: "Supabase is not configured." };
    if (!context.userId) return { error: "Sign in to clean up transactions." };
    if (context.isDemo) return { error: "Demo mode is read-only. Sign in to clean up real transactions." };

    const categoryId = cleanOptionalUuid(formData.get("categoryId"));
    if (categoryId === undefined || categoryId === null) return { error: "Choose one of your categories." };

    const categories = await listCategories(context.client, context.userId);
    const selectedCategory = getSelectedCategory(categories, categoryId);
    if (!selectedCategory) return { error: "Choose one of your categories." };

    const matchedTransactions = (await listTransactions(context.client, context.userId, {
      limit: 500,
      search: merchantQuery
    })).filter((transaction) => merchantMatchesQuery(transaction, merchantQuery));

    if (matchedTransactions.length === 0) {
      return { error: `No merchant rows matched "${merchantQuery}".` };
    }

    const confidence = 0.98;
    let changedCount = 0;

    for (const transaction of matchedTransactions) {
      const willChange =
        transaction.categoryId !== selectedCategory.id ||
        transaction.category !== selectedCategory.name ||
        transaction.intent !== requestedIntent ||
        transaction.confidence < confidence;

      if (!willChange) continue;

      await updateTransactionEnrichment(context.client, context.userId, transaction.id, {
        categoryId: selectedCategory.id,
        categoryName: selectedCategory.name,
        confidence: Math.max(transaction.confidence, confidence),
        intent: requestedIntent,
        source: "manual"
      });

      await recordAuditEvent(context.client, context.userId, {
        action: "transaction.merchant_cleanup_applied",
        actorId: context.userId,
        afterData: {
          categoryId: selectedCategory.id,
          categoryName: selectedCategory.name,
          confidence: Math.max(transaction.confidence, confidence),
          intent: requestedIntent,
          merchantName: transaction.merchant
        },
        beforeData: transactionCleanupSnapshot(transaction),
        entityId: transaction.id,
        entityTable: "enriched_transactions",
        metadata: {
          merchantQuery,
          matchedText: merchantText(transaction),
          source: "transactions_merchant_cleanup"
        }
      });

      changedCount += 1;
    }

    const saveRule = formData.get("saveRule") === "1";
    const pattern = saveRule ? merchantRulePattern(merchantQuery) : null;
    const merchantRule = pattern
      ? await upsertMerchantRule(context.client, context.userId, {
        categoryId: selectedCategory.id,
        intent: requestedIntent,
        isRecurring: null,
        merchantPattern: pattern,
        normalizedMerchantName: merchantQuery,
        notes: `Saved from transaction merchant cleanup on ${new Date().toISOString().slice(0, 10)}.`,
        priority: 50
      })
      : null;

    if (merchantRule) {
      await recordAuditEvent(context.client, context.userId, {
        action: "merchant_rule.saved_from_transaction_cleanup",
        actorId: context.userId,
        afterData: merchantRule as unknown as Record<string, Json | undefined>,
        beforeData: null,
        entityId: merchantRule.id,
        entityTable: "merchant_rules",
        metadata: {
          changedCount,
          matchedCount: matchedTransactions.length,
          merchantQuery,
          source: "transactions_merchant_cleanup"
        }
      });
    }

    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    revalidatePath("/settings");

    const changedLabel = changedCount.toLocaleString("en-US");
    const matchedLabel = matchedTransactions.length.toLocaleString("en-US");
    const ruleLabel = merchantRule ? " Saved a merchant rule for future imports." : "";
    return {
      message: `Updated ${changedLabel} of ${matchedLabel} matching rows to ${selectedCategory.name}.${ruleLabel}`
    };
  } catch (error) {
    return cleanupErrorState(error);
  }
}

export async function linkReimbursementAction(
  _state: ReimbursementLinkActionState,
  formData: FormData
): Promise<ReimbursementLinkActionState> {
  try {
    const reimbursementId = cleanString(formData.get("reimbursementId"), 80);
    if (!uuidPattern.test(reimbursementId)) return { error: "Invalid reimbursement id." };

    const receivedTransactionId = cleanString(formData.get("receivedTransactionId"), 80);
    if (!uuidPattern.test(receivedTransactionId)) return { error: "Invalid received transaction id." };

    const appliedAmount = cleanOptionalAmount(formData.get("appliedAmount"));
    if (appliedAmount === null) return { error: "Enter a valid reimbursement amount." };

    const context = await getFinanceServerContext();
    if (!context.client) return { error: "Supabase is not configured." };
    if (!context.userId) return { error: "Sign in to link reimbursements." };
    if (context.isDemo) return { error: "Demo mode is read-only. Sign in to link real reimbursements." };

    const reimbursement = await linkReimbursementReceivedTransaction(context.client, context.userId, {
      actorId: context.userId,
      appliedAmount,
      receivedTransactionId,
      reimbursementId,
      source: "transactions_reimbursement_link_action"
    });

    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    revalidatePath(`/transactions/${reimbursement.transactionId}`);
    revalidatePath(`/transactions/${receivedTransactionId}`);

    return {
      message: reimbursement.status === "received"
        ? "Reimbursement linked and marked received."
        : "Partial reimbursement linked with the outstanding balance preserved."
    };
  } catch (error) {
    return reimbursementLinkErrorState(error);
  }
}

export async function unlinkReimbursementAction(
  _state: ReimbursementLinkActionState,
  formData: FormData
): Promise<ReimbursementLinkActionState> {
  try {
    const reimbursementId = cleanString(formData.get("reimbursementId"), 80);
    if (!uuidPattern.test(reimbursementId)) return { error: "Invalid reimbursement id." };

    const restoredIntentValue = cleanString(formData.get("restoredReceivedTransactionIntent"), 24) as TransactionIntent;
    const restoredReceivedTransactionIntent = restoredIntentValue
      ? restoredIntentValue
      : undefined;
    if (restoredReceivedTransactionIntent && !transactionIntents.has(restoredReceivedTransactionIntent)) {
      return { error: "Choose a valid restored transaction intent." };
    }

    const context = await getFinanceServerContext();
    if (!context.client) return { error: "Supabase is not configured." };
    if (!context.userId) return { error: "Sign in to unlink reimbursements." };
    if (context.isDemo) return { error: "Demo mode is read-only. Sign in to unlink real reimbursements." };

    const reimbursement = await unlinkReimbursementReceivedTransaction(context.client, context.userId, {
      actorId: context.userId,
      reimbursementId,
      restoredReceivedTransactionIntent,
      source: "transactions_reimbursement_unlink_action"
    });

    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    revalidatePath(`/transactions/${reimbursement.transactionId}`);

    return { message: "Reimbursement link removed and audit history recorded." };
  } catch (error) {
    return reimbursementLinkErrorState(error);
  }
}

export async function updateTransactionAction(
  _state: TransactionEditActionState,
  formData: FormData
): Promise<TransactionEditActionState> {
  try {
    const context = await getFinanceServerContext();
    if (context.isDemo) return { error: "Demo mode is read-only. Sign in to edit real transactions." };

    const transactionId = cleanString(formData.get("transactionId"), 80);
    if (!uuidPattern.test(transactionId)) return { error: "Invalid transaction id." };

    const merchantName = cleanString(formData.get("merchantName"), 160);
    if (!merchantName) return { error: "Merchant is required." };

    const rawCategoryId = cleanString(formData.get("categoryId"), 80);
    const wantsNewCategory = rawCategoryId === NEW_CATEGORY_VALUE;
    let categoryId = wantsNewCategory ? null : cleanOptionalUuid(formData.get("categoryId"));
    if (categoryId === undefined) return { error: "Choose a valid category." };

    const legacyIntent = cleanString(formData.get("intent"), 24) as TransactionIntent;
    const requestedBaseIntent = (cleanString(formData.get("baseIntent"), 24) || displayTransactionIntent(legacyIntent)) as UserTransactionIntent;
    if (!userTransactionIntents.has(requestedBaseIntent)) return { error: "Choose Personal or Business." };

    const tagResult = requestedTagFromForm(formData, transactionTagFromIntent(legacyIntent));
    if ("error" in tagResult) return { error: tagResult.error };

    const requestedIntent = transactionIntentFromUi(requestedBaseIntent, tagResult.tag);

    const supabase = await createSupabaseServerClient();
    if (!supabase) return { error: "Supabase is not configured." };

    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    if (error) return { error: `Unable to verify Supabase session: ${error.message}` };
    if (!user) return { error: "Sign in to edit transactions." };

    const financeClient = supabase as unknown as FinanceSupabaseClient;
    const [before, categories] = await Promise.all([
      getEnrichedTransactionRow(financeClient, user.id, transactionId),
      listCategories(financeClient, user.id)
    ]);

    if (!before) return { error: "Transaction was not found." };

    let selectedCategory = getSelectedCategory(categories, categoryId);
    if (wantsNewCategory) {
      const newCategoryName = cleanString(formData.get("newCategoryName"), 160);
      if (!newCategoryName) return { error: "Name the new category." };
      if (isTransferCategoryName(newCategoryName)) return { error: "Transfer is a tag, not a category." };

      selectedCategory = categories.find((category) => category.name.toLowerCase() === newCategoryName.toLowerCase()) ??
        await upsertCategory(financeClient, user.id, { name: newCategoryName });
      categoryId = selectedCategory.id;
    }
    if (categoryId && !selectedCategory) return { error: "Choose one of your categories." };

    const categoryName = selectedCategory?.name ?? "Uncategorized";
    const note = cleanString(formData.get("note"), 1000);
    const isRecurring = formData.get("isRecurring") === "1";
    const reviewedAt = new Date().toISOString();
    const afterSnapshot = {
      categoryId,
      categoryName,
      intent: requestedIntent,
      isRecurring,
      merchantName,
      note
    };
    const changedFields = changedEditableFields(before, afterSnapshot);
    const reviewItemsToResolve = await listResolvableReviewItemsForTransaction(
      financeClient,
      user.id,
      transactionId,
      { categoryId, intent: requestedIntent }
    );
    const shouldMarkTrusted = reviewItemsToResolve.length > 0;
    const transactionPatch = {
      ...afterSnapshot,
      ...(shouldMarkTrusted ? { confidence: 1, reviewedAt } : {}),
      source: "manual" as const
    };
    const trustFields = shouldMarkTrusted
      ? ([
        before.confidence === 1 ? null : "confidence",
        before.reviewed_at === reviewedAt ? null : "reviewedAt"
      ].filter((field): field is "confidence" | "reviewedAt" => Boolean(field)))
      : [];
    const auditFields = [...changedFields, ...trustFields];

    if (changedFields.length > 0 || shouldMarkTrusted) {
      await updateTransactionEnrichment(financeClient, user.id, transactionId, transactionPatch);

      const beforeData = pickFields(transactionSnapshot(before), auditFields);
      const afterData = pickFields(transactionPatch, auditFields);

      await recordAuditEvent(financeClient, user.id, {
        action: changedFields.length > 0
          ? "transaction.enrichment_updated"
          : "transaction.enrichment_reviewed",
        actorId: user.id,
        afterData,
        beforeData,
        entityId: transactionId,
        entityTable: "enriched_transactions",
        metadata: {
          changedFields: auditFields,
          resolvedReviewCount: reviewItemsToResolve.length,
          rawTransactionId: before.raw_transaction_id,
          source: "transaction_edit_form"
        }
      });
    }

    if (reviewItemsToResolve.length > 0) {
      await resolveManualEditReviewItemsForTransaction({
        client: financeClient,
        reviewedAt,
        reviewItems: reviewItemsToResolve,
        transactionId,
        userId: user.id
      });
    }

    revalidatePath("/dashboard");
    revalidatePath("/review");
    revalidatePath("/transactions");
    revalidatePath(`/transactions/${transactionId}`);
  } catch (error) {
    return errorState(error);
  }

  redirect("/transactions");
}
