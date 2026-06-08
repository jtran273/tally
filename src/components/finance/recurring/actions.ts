"use server";

import { revalidatePath } from "next/cache";
import {
  listRecurringExpenses,
  listTransactions,
  recordAuditEvent,
  updateRecurringExpense,
  upsertRecurringExpense,
  type FinanceSupabaseClient,
  type RecurringCadence,
  type RecurringExpenseRecord
} from "@/lib/db";
import { isDemoMode } from "@/lib/demo/auth";
import {
  applyConfirmRecurringPayload,
  applyDismissRecurringPayload,
  buildConfirmRecurringPayload,
  buildDismissRecurringPayload,
  calculateNextDueDate,
  detectRecurringCandidates,
  type RecurringCandidate
} from "@/lib/recurring";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const recurringStatuses = ["active", "pending", "paused", "dismissed"] as const;
const recurringTransactionLookbackDays = 1460;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecurringActionState {
  error?: string;
  message?: string;
}

const RECURRING_CADENCES: readonly RecurringCadence[] = ["weekly", "biweekly", "monthly", "quarterly", "annual"];
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function cleanString(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseRecurringAmount(value: FormDataEntryValue | null) {
  const amount = Number(String(value ?? "").trim());
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    throw new Error("Enter an amount greater than 0.");
  }
  return Math.round(amount * 100) / 100;
}

function parseRecurringCadence(value: FormDataEntryValue | null): RecurringCadence {
  const cadence = String(value ?? "").trim().toLowerCase();
  if ((RECURRING_CADENCES as readonly string[]).includes(cadence)) {
    return cadence as RecurringCadence;
  }
  throw new Error("Choose a cadence: weekly, biweekly, monthly, quarterly, or annual.");
}

function parseRecurringIsoDate(value: FormDataEntryValue | null, label: string) {
  const raw = String(value ?? "").trim();
  if (!isoDatePattern.test(raw) || Number.isNaN(Date.parse(`${raw}T12:00:00.000Z`))) {
    throw new Error(`Enter a valid ${label} (YYYY-MM-DD).`);
  }
  return raw;
}

function errorState(error: unknown): RecurringActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to update recurring row."
  };
}

function recurringTransactionFromDate(asOfDate: string) {
  const date = new Date(`${asOfDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - recurringTransactionLookbackDays);
  return date.toISOString().slice(0, 10);
}

function submittedCandidateId(formData: FormData) {
  return cleanString(formData.get("candidateId"), 260);
}

function submittedRecurringExpenseId(formData: FormData) {
  const recurringExpenseId = cleanString(formData.get("recurringExpenseId"), 80);
  return uuidPattern.test(recurringExpenseId) ? recurringExpenseId : null;
}

async function getRecurringContext() {
  if (await isDemoMode()) throw new Error("Demo mode is read-only. Sign in to update recurring rows.");

  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error) throw new Error(`Unable to verify Supabase session: ${error.message}`);
  if (!user) throw new Error("Sign in to update recurring rows.");

  const client = supabase as unknown as FinanceSupabaseClient;
  return {
    client,
    userId: user.id
  };
}

async function loadRecurringCandidateContext(client: FinanceSupabaseClient, userId: string) {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const [recurringExpenses, transactions] = await Promise.all([
    listRecurringExpenses(client, userId, [...recurringStatuses]),
    listTransactions(client, userId, {
      fromDate: recurringTransactionFromDate(asOfDate),
      includeRawContext: false
    })
  ]);
  const candidates = detectRecurringCandidates(transactions, {
    asOfDate,
    existingRecurring: recurringExpenses
  });

  return {
    candidates
  };
}

function findSubmittedCandidate(candidateId: string, candidates: RecurringCandidate[]) {
  return candidates.find((candidate) => candidate.id === candidateId) ?? null;
}

function findSubmittedRecurringExpense(recurringExpenseId: string | null, recurringExpenses: RecurringExpenseRecord[]) {
  if (!recurringExpenseId) return null;
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
  const { client, userId } = await getRecurringContext();
  const candidateId = submittedCandidateId(formData);
  const recurringExpenseId = submittedRecurringExpenseId(formData);

  if (candidateId) {
    const { candidates } = await loadRecurringCandidateContext(client, userId);
    const candidate = findSubmittedCandidate(candidateId, candidates);

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

    if (!recurringExpenseId) {
      throw new Error("Recurring candidate was not found or is no longer active.");
    }
  }

  const recurringExpenses = await listRecurringExpenses(client, userId, [...recurringStatuses]);
  const expense = findSubmittedRecurringExpense(recurringExpenseId, recurringExpenses);
  if (!expense || (expense.status !== "pending" && !expense.isNew)) {
    throw new Error("Recurring row was not found or is no longer pending.");
  }

  await markPendingRecurringExpense(client, userId, expense, "active");
  revalidateRecurringPaths();
}

export async function dismissRecurringAction(formData: FormData) {
  const { client, userId } = await getRecurringContext();
  const candidateId = submittedCandidateId(formData);
  const recurringExpenseId = submittedRecurringExpenseId(formData);

  if (candidateId) {
    const { candidates } = await loadRecurringCandidateContext(client, userId);
    const candidate = findSubmittedCandidate(candidateId, candidates);

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

    if (!recurringExpenseId) {
      throw new Error("Recurring candidate was not found or is no longer active.");
    }
  }

  const recurringExpenses = await listRecurringExpenses(client, userId, [...recurringStatuses]);
  const expense = findSubmittedRecurringExpense(recurringExpenseId, recurringExpenses);
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

export async function addRecurringExpenseAction(
  _state: RecurringActionState,
  formData: FormData
): Promise<RecurringActionState> {
  try {
    const { client, userId } = await getRecurringContext();
    const merchant = cleanString(formData.get("merchant"), 160);
    if (!merchant) throw new Error("Enter a merchant name.");

    const amount = parseRecurringAmount(formData.get("amount"));
    const cadence = parseRecurringCadence(formData.get("cadence"));
    const lastChargeDate = parseRecurringIsoDate(formData.get("lastChargeDate"), "last charge date");
    const providedNextDue = cleanString(formData.get("nextDueDate"), 10);
    const nextDueDate = providedNextDue
      ? parseRecurringIsoDate(formData.get("nextDueDate"), "next due date")
      : calculateNextDueDate(lastChargeDate, cadence, new Date().toISOString().slice(0, 10));

    // Conflict columns are user_id,merchant_name,cadence, so re-adding the same
    // merchant + cadence updates that row instead of creating a duplicate.
    const recurringExpense = await upsertRecurringExpense(client, userId, {
      user_id: userId,
      merchant_rule_id: null,
      category_id: null,
      account_id: null,
      last_transaction_id: null,
      merchant_name: merchant,
      amount,
      cadence,
      next_due_date: nextDueDate,
      last_charge_date: lastChargeDate,
      last_amount: amount,
      status: "active",
      is_new: false,
      confidence: 1
    });

    await recordAuditEvent(client, userId, {
      action: "recurring.manual_added",
      actorId: userId,
      afterData: { amount, cadence, merchant, nextDueDate, status: "active" },
      beforeData: null,
      entityId: recurringExpense.id,
      entityTable: "recurring_expenses",
      metadata: { source: "recurring_manual_add" }
    });

    revalidateRecurringPaths();
    return { message: `Added ${merchant} to recurring expenses.` };
  } catch (error) {
    return errorState(error);
  }
}
