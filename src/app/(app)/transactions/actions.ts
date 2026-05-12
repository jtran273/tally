"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getEnrichedTransactionRow,
  listCategories,
  listTransactions,
  recordAuditEvent,
  updateTransactionEnrichment,
  upsertMerchantRule,
  type CategoryRecord,
  type EnrichedTransactionRow,
  type FinanceSupabaseClient,
  type Json,
  type TransactionRecord,
  type TransactionIntent
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface TransactionEditActionState {
  error?: string;
}

export interface MerchantCleanupActionState {
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

function getSelectedCategory(categories: CategoryRecord[], categoryId: string | null) {
  if (!categoryId) return null;
  return categories.find((category) => category.id === categoryId) ?? null;
}

function transactionSnapshot(row: EnrichedTransactionRow): Record<string, Json> {
  return {
    categoryId: row.category_id,
    categoryName: row.category_name,
    intent: row.intent,
    isRecurring: row.is_recurring,
    merchantName: row.merchant_name,
    note: row.note,
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

export async function applyMerchantCleanupAction(
  _state: MerchantCleanupActionState,
  formData: FormData
): Promise<MerchantCleanupActionState> {
  try {
    const merchantQuery = cleanString(formData.get("merchantQuery"), 160);
    if (normalizeSearch(merchantQuery).length < 2) {
      return { error: "Enter at least 2 searchable merchant characters." };
    }

    const requestedIntent = cleanString(formData.get("intent"), 24) as TransactionIntent;
    if (!transactionIntents.has(requestedIntent)) return { error: "Choose a valid intent." };

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

export async function updateTransactionAction(
  _state: TransactionEditActionState,
  formData: FormData
): Promise<TransactionEditActionState> {
  try {
    const transactionId = cleanString(formData.get("transactionId"), 80);
    if (!uuidPattern.test(transactionId)) return { error: "Invalid transaction id." };

    const merchantName = cleanString(formData.get("merchantName"), 160);
    if (!merchantName) return { error: "Merchant is required." };

    const categoryId = cleanOptionalUuid(formData.get("categoryId"));
    if (categoryId === undefined) return { error: "Choose a valid category." };

    const requestedIntent = cleanString(formData.get("intent"), 24) as TransactionIntent;
    if (!transactionIntents.has(requestedIntent)) return { error: "Choose a valid intent." };

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

    const selectedCategory = getSelectedCategory(categories, categoryId);
    if (categoryId && !selectedCategory) return { error: "Choose one of your categories." };

    const categoryName = cleanString(formData.get("categoryName"), 160) ||
      selectedCategory?.name ||
      "Uncategorized";
    const note = cleanString(formData.get("note"), 1000);
    const isRecurring = formData.get("isRecurring") === "1";
    const afterSnapshot = {
      categoryId,
      categoryName,
      intent: requestedIntent,
      isRecurring,
      merchantName,
      note
    };
    const changedFields = changedEditableFields(before, afterSnapshot);

    if (changedFields.length > 0) {
      await updateTransactionEnrichment(financeClient, user.id, transactionId, {
        categoryId,
        categoryName,
        intent: requestedIntent,
        isRecurring,
        merchantName,
        note,
        source: "manual"
      });

      const beforeData = pickFields(transactionSnapshot(before), changedFields);
      const afterData = pickFields({ ...afterSnapshot, source: "manual" }, changedFields);

      await recordAuditEvent(financeClient, user.id, {
        action: "transaction.enrichment_updated",
        actorId: user.id,
        afterData,
        beforeData,
        entityId: transactionId,
        entityTable: "enriched_transactions",
        metadata: {
          changedFields,
          rawTransactionId: before.raw_transaction_id,
          source: "transaction_edit_form"
        }
      });
    }

    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    revalidatePath(`/transactions/${transactionId}`);
  } catch (error) {
    return errorState(error);
  }

  redirect("/transactions");
}
