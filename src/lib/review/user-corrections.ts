import type { AuditEventRow, FinanceSupabaseClient, TransactionIntent } from "@/lib/db";
import type { UserCorrectionExample } from "@/lib/ai/types";

const CORRECTION_ACTIONS = [
  "review.transaction_edited_resolved",
  "review.suggestion_accepted",
  "review.peer_to_peer_resolved"
] as const;

const VALID_INTENTS = new Set<TransactionIntent>(["business", "personal", "reimbursable", "shared", "transfer"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractCorrection(event: AuditEventRow): UserCorrectionExample | null {
  const after = asRecord(event.after_data);
  const txnPatch = asRecord(after.transaction ?? after.appliedPatch);

  const merchant = readString(txnPatch.merchantName) ?? readString(txnPatch.merchant_name);
  const categoryName = readString(txnPatch.categoryName) ?? readString(txnPatch.category_name);
  const intent = readString(txnPatch.intent);
  if (!merchant || !categoryName || !intent) return null;
  if (!VALID_INTENTS.has(intent as TransactionIntent)) return null;
  if (categoryName.toLowerCase() === "uncategorized") return null;

  const recurringRaw = txnPatch.isRecurring ?? txnPatch.is_recurring ?? null;
  const recurring = typeof recurringRaw === "boolean" ? recurringRaw : null;

  return {
    merchant,
    categoryName,
    intent: intent as TransactionIntent,
    recurring
  };
}

/**
 * Load the user's most recent label corrections to use as few-shot examples
 * for the AI. Deduplicates by merchant (most recent wins) so the prompt stays
 * compact and the model sees a diverse set of merchants.
 */
export async function loadRecentUserCorrections(
  client: FinanceSupabaseClient,
  userId: string,
  limit = 20
): Promise<UserCorrectionExample[]> {
  const { data, error } = await client
    .from("audit_events")
    .select("*")
    .eq("user_id", userId)
    .in("action", [...CORRECTION_ACTIONS])
    .order("created_at", { ascending: false })
    .limit(150);

  if (error || !data) return [];

  const byMerchant = new Map<string, UserCorrectionExample>();
  for (const event of data as AuditEventRow[]) {
    const correction = extractCorrection(event);
    if (!correction) continue;
    const key = correction.merchant.toLowerCase();
    if (byMerchant.has(key)) continue;
    byMerchant.set(key, correction);
    if (byMerchant.size >= limit) break;
  }

  return [...byMerchant.values()];
}
