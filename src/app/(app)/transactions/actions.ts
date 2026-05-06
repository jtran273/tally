"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getEnrichedTransactionRow,
  listCategories,
  recordAuditEvent,
  updateTransactionEnrichment,
  type CategoryRecord,
  type EnrichedTransactionRow,
  type FinanceSupabaseClient,
  type Json,
  type TransactionIntent
} from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface TransactionEditActionState {
  error?: string;
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
