"use server";

import { revalidatePath } from "next/cache";
import {
  listRecurringExpenses,
  listTransactions,
  recordAuditEvent,
  updateRecurringExpense,
  type FinanceSupabaseClient,
  type RecurringExpenseRecord
} from "@/lib/db";
import {
  applyConfirmRecurringPayload,
  applyDismissRecurringPayload,
  buildConfirmRecurringPayload,
  buildDismissRecurringPayload,
  detectRecurringCandidates,
  type RecurringCandidate
} from "@/lib/recurring";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const recurringStatuses = ["active", "pending", "paused", "dismissed"] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecurringActionState {
  error?: string;
  message?: string;
}

function cleanString(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function errorState(error: unknown): RecurringActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to update recurring row."
  };
}

async function getRecurringContext() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error) throw new Error(`Unable to verify Supabase session: ${error.message}`);
  if (!user) throw new Error("Sign in to update recurring rows.");

  const client = supabase as unknown as FinanceSupabaseClient;
  const [recurringExpenses, transactions] = await Promise.all([
    listRecurringExpenses(client, user.id, [...recurringStatuses]),
    listTransactions(client, user.id, { limit: 5000 })
  ]);
  const candidates = detectRecurringCandidates(transactions, {
    asOfDate: new Date().toISOString().slice(0, 10),
    existingRecurring: recurringExpenses
  });

  return {
    candidates,
    client,
    recurringExpenses,
    userId: user.id
  };
}

function findSubmittedCandidate(formData: FormData, candidates: RecurringCandidate[]) {
  const candidateId = cleanString(formData.get("candidateId"), 260);
  const recurringExpenseId = cleanString(formData.get("recurringExpenseId"), 80);

  if (candidateId) {
    return candidates.find((candidate) => candidate.id === candidateId) ?? null;
  }

  if (uuidPattern.test(recurringExpenseId)) {
    return candidates.find((candidate) => candidate.existingRecurringId === recurringExpenseId) ?? null;
  }

  return null;
}

function findSubmittedRecurringExpense(formData: FormData, recurringExpenses: RecurringExpenseRecord[]) {
  const recurringExpenseId = cleanString(formData.get("recurringExpenseId"), 80);
  if (!uuidPattern.test(recurringExpenseId)) return null;
  return recurringExpenses.find((expense) => expense.id === recurringExpenseId) ?? null;
}

async function markPendingRecurringExpense(
  client: FinanceSupabaseClient,
  userId: string,
  expense: RecurringExpenseRecord,
  status: "active" | "dismissed"
) {
  const updated = await updateRecurringExpense(client, userId, expense.id, {
    is_new: false,
    status
  });

  await recordAuditEvent(client, userId, {
    action: status === "active" ? "recurring.pending_confirmed" : "recurring.pending_dismissed",
    actorId: userId,
    afterData: {
      isNew: updated.is_new,
      status: updated.status
    },
    beforeData: {
      isNew: expense.isNew,
      status: expense.status
    },
    entityId: expense.id,
    entityTable: "recurring_expenses",
    metadata: {
      source: "recurring_table_action"
    }
  });
}

function revalidateRecurringPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/recurring");
  revalidatePath("/review");
  revalidatePath("/settings");
  revalidatePath("/transactions");
}

export async function confirmRecurringAction(formData: FormData) {
  const { candidates, client, recurringExpenses, userId } = await getRecurringContext();
  const candidate = findSubmittedCandidate(formData, candidates);

  if (candidate) {
    await applyConfirmRecurringPayload(
      client,
      userId,
      buildConfirmRecurringPayload(candidate, { reviewedAt: new Date().toISOString() }),
      { actorId: userId }
    );
    revalidateRecurringPaths();
    return;
  }

  const expense = findSubmittedRecurringExpense(formData, recurringExpenses);
  if (!expense || (expense.status !== "pending" && !expense.isNew)) {
    throw new Error("Recurring row was not found or is no longer pending.");
  }

  await markPendingRecurringExpense(client, userId, expense, "active");
  revalidateRecurringPaths();
}

export async function dismissRecurringAction(formData: FormData) {
  const { candidates, client, recurringExpenses, userId } = await getRecurringContext();
  const candidate = findSubmittedCandidate(formData, candidates);

  if (candidate) {
    await applyDismissRecurringPayload(
      client,
      userId,
      buildDismissRecurringPayload(candidate, { reviewedAt: new Date().toISOString() }),
      { actorId: userId }
    );
    revalidateRecurringPaths();
    return;
  }

  const expense = findSubmittedRecurringExpense(formData, recurringExpenses);
  if (!expense || (expense.status !== "pending" && !expense.isNew)) {
    throw new Error("Recurring row was not found or is no longer pending.");
  }

  await markPendingRecurringExpense(client, userId, expense, "dismissed");
  revalidateRecurringPaths();
}

export async function confirmRecurringCandidateAction(
  _state: RecurringActionState,
  formData: FormData
): Promise<RecurringActionState> {
  try {
    await confirmRecurringAction(formData);
    return { message: "Recurring row confirmed." };
  } catch (error) {
    return errorState(error);
  }
}

export async function dismissRecurringCandidateAction(
  _state: RecurringActionState,
  formData: FormData
): Promise<RecurringActionState> {
  try {
    await dismissRecurringAction(formData);
    return { message: "Recurring row dismissed." };
  } catch (error) {
    return errorState(error);
  }
}
