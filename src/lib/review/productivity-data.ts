import {
  FinanceDbError,
  type AuditEventRow,
  type FinanceSupabaseClient
} from "@/lib/db";

export async function listReviewProductivityAuditEvents(
  client: FinanceSupabaseClient,
  userId: string,
  options: { limit?: number } = {}
): Promise<AuditEventRow[]> {
  let query = client
    .from("audit_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }

  const result = await query;
  if (result.error) {
    throw new FinanceDbError("List review productivity audit events", result.error);
  }

  return result.data ?? [];
}
