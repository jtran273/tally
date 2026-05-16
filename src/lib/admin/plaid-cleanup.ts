import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";
import { deletePlaidItemLedgerData } from "../plaid/service";

export const PLAID_CLEANUP_CONFIRMATION = "DELETE_PLAID_ITEM_DATA";

export interface PlaidCleanupOptions {
  confirm?: string;
  execute: boolean;
  institutionId?: string;
  institutionName?: string;
  itemId?: string;
  plaidInstitutionId?: string;
  userId: string;
}

export interface PlaidCleanupCounts {
  accounts: number;
  balanceSnapshots: number;
  enrichedTransactions: number;
  plaidItems: number;
  plaidSyncRunItems: number;
  rawTransactions: number;
  reimbursementReceivedRefsToNull: number;
  reimbursementRecords: number;
  reimbursementSplitRefsToNull: number;
  recurringAccountRefsToNull: number;
  recurringLastTransactionRefsToNull: number;
  reviewItems: number;
  transactionSplits: number;
}

type AdminClient = SupabaseClient<Database>;
type SelectorKey = "itemId" | "institutionId" | "institutionName" | "plaidInstitutionId";

const EMPTY_COUNTS: PlaidCleanupCounts = {
  accounts: 0,
  balanceSnapshots: 0,
  enrichedTransactions: 0,
  plaidItems: 0,
  plaidSyncRunItems: 0,
  rawTransactions: 0,
  reimbursementReceivedRefsToNull: 0,
  reimbursementRecords: 0,
  reimbursementSplitRefsToNull: 0,
  recurringAccountRefsToNull: 0,
  recurringLastTransactionRefsToNull: 0,
  reviewItems: 0,
  transactionSplits: 0
};

function selectedScopes(options: PlaidCleanupOptions) {
  return (["itemId", "institutionId", "institutionName", "plaidInstitutionId"] as const)
    .filter((key) => Boolean(options[key]?.trim()));
}

export function validatePlaidCleanupOptions(options: PlaidCleanupOptions) {
  if (!options.userId.trim()) {
    throw new Error("Missing --user-id.");
  }

  const scopes = selectedScopes(options);
  if (scopes.length !== 1) {
    throw new Error("Provide exactly one cleanup scope: --item-id, --institution-id, --institution-name, or --plaid-institution-id.");
  }

  if (options.execute && options.confirm !== PLAID_CLEANUP_CONFIRMATION) {
    throw new Error(`Destructive cleanup requires --confirm ${PLAID_CLEANUP_CONFIRMATION}.`);
  }
}

export function describePlaidCleanupScope(options: PlaidCleanupOptions) {
  const scope = selectedScopes(options)[0] as SelectorKey | undefined;
  if (!scope) return "unknown scope";

  const labels: Record<SelectorKey, string> = {
    institutionId: "institution id",
    institutionName: "institution name",
    itemId: "Plaid item id",
    plaidInstitutionId: "Plaid institution id"
  };

  return `${labels[scope]} ${options[scope]}`;
}

function expectRows<T>(result: { data: T[] | null; error: { message: string } | null }, context: string) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data ?? [];
}

async function selectIds(
  client: AdminClient,
  table: keyof Database["public"]["Tables"],
  userId: string,
  column: string,
  values: readonly string[]
) {
  if (values.length === 0) return [];

  const result = await client
    .from(table)
    .select("id")
    .eq("user_id", userId)
    .in(column, [...values]);

  return expectRows(result as { data: Array<{ id: string }> | null; error: { message: string } | null }, `Load ${table} ids`)
    .map((row) => row.id);
}

async function countByIds(
  client: AdminClient,
  table: keyof Database["public"]["Tables"],
  userId: string,
  column: string,
  values: readonly string[]
) {
  return (await selectIds(client, table, userId, column, values)).length;
}

async function loadInstitutionIds(client: AdminClient, options: PlaidCleanupOptions) {
  if (options.institutionId) return [options.institutionId];
  const institutionName = options.institutionName?.trim();
  const plaidInstitutionId = options.plaidInstitutionId?.trim();

  const query = client
    .from("institutions")
    .select("id")
    .eq("user_id", options.userId);

  const result = institutionName
    ? await query.eq("name", institutionName)
    : await query.eq("plaid_institution_id", plaidInstitutionId as string);

  return expectRows(
    result as { data: Array<{ id: string }> | null; error: { message: string } | null },
    "Load cleanup institutions"
  ).map((row) => row.id);
}

async function loadPlaidItemIds(client: AdminClient, options: PlaidCleanupOptions) {
  if (options.itemId) {
    const result = await client
      .from("plaid_items")
      .select("id")
      .eq("user_id", options.userId)
      .eq("id", options.itemId);

    return expectRows(
      result as { data: Array<{ id: string }> | null; error: { message: string } | null },
      "Load cleanup Plaid item"
    ).map((row) => row.id);
  }

  const institutionIds = await loadInstitutionIds(client, options);
  if (institutionIds.length === 0) return [];

  return selectIds(client, "plaid_items", options.userId, "institution_id", institutionIds);
}

async function assertPlaidItemsRevoked(client: AdminClient, userId: string, plaidItemIds: readonly string[]) {
  if (plaidItemIds.length === 0) return;

  const result = await client
    .from("plaid_items")
    .select("id,status")
    .eq("user_id", userId)
    .in("id", [...plaidItemIds]);

  const rows = expectRows(
    result as { data: Array<{ id: string; status: string }> | null; error: { message: string } | null },
    "Load cleanup Plaid item statuses"
  );
  const activeRows = rows.filter((row) => row.status !== "revoked");
  if (activeRows.length > 0) {
    throw new Error(
      `Cleanup only runs on revoked Plaid items. Disconnect first or narrow the scope. Active item ids: ${activeRows.map((row) => row.id).join(", ")}.`
    );
  }
}

async function getAffectedIds(client: AdminClient, options: PlaidCleanupOptions) {
  const plaidItemIds = await loadPlaidItemIds(client, options);
  const accountIds = await selectIds(client, "accounts", options.userId, "plaid_item_id", plaidItemIds);
  const rawTransactionIds = await selectIds(client, "raw_transactions", options.userId, "plaid_item_id", plaidItemIds);
  const enrichedTransactionIds = await selectIds(
    client,
    "enriched_transactions",
    options.userId,
    "raw_transaction_id",
    rawTransactionIds
  );
  const transactionSplitIds = await selectIds(
    client,
    "transaction_splits",
    options.userId,
    "enriched_transaction_id",
    enrichedTransactionIds
  );

  return { accountIds, enrichedTransactionIds, plaidItemIds, rawTransactionIds, transactionSplitIds };
}

export async function getPlaidCleanupCounts(client: AdminClient, options: PlaidCleanupOptions): Promise<PlaidCleanupCounts> {
  validatePlaidCleanupOptions(options);

  const ids = await getAffectedIds(client, options);
  if (ids.plaidItemIds.length === 0) return { ...EMPTY_COUNTS };

  return {
    accounts: ids.accountIds.length,
    balanceSnapshots: await countByIds(client, "balance_snapshots", options.userId, "account_id", ids.accountIds),
    enrichedTransactions: ids.enrichedTransactionIds.length,
    plaidItems: ids.plaidItemIds.length,
    plaidSyncRunItems: await countByIds(client, "plaid_sync_run_items", options.userId, "plaid_item_id", ids.plaidItemIds),
    rawTransactions: ids.rawTransactionIds.length,
    reimbursementReceivedRefsToNull: await countByIds(
      client,
      "reimbursement_records",
      options.userId,
      "received_transaction_id",
      ids.enrichedTransactionIds
    ),
    reimbursementRecords: await countByIds(
      client,
      "reimbursement_records",
      options.userId,
      "enriched_transaction_id",
      ids.enrichedTransactionIds
    ),
    reimbursementSplitRefsToNull: await countByIds(
      client,
      "reimbursement_records",
      options.userId,
      "split_id",
      ids.transactionSplitIds
    ),
    recurringAccountRefsToNull: await countByIds(client, "recurring_expenses", options.userId, "account_id", ids.accountIds),
    recurringLastTransactionRefsToNull: await countByIds(
      client,
      "recurring_expenses",
      options.userId,
      "last_transaction_id",
      ids.enrichedTransactionIds
    ),
    reviewItems: await countByIds(client, "review_items", options.userId, "enriched_transaction_id", ids.enrichedTransactionIds),
    transactionSplits: ids.transactionSplitIds.length
  };
}

export async function executePlaidItemCleanup(client: AdminClient, options: PlaidCleanupOptions) {
  validatePlaidCleanupOptions(options);
  if (!options.execute) {
    throw new Error("Cleanup execution requires execute=true.");
  }

  const before = await getPlaidCleanupCounts(client, options);
  const ids = await getAffectedIds(client, options);
  await assertPlaidItemsRevoked(client, options.userId, ids.plaidItemIds);

  for (const itemId of ids.plaidItemIds) {
    await deletePlaidItemLedgerData({ client, itemId, userId: options.userId });
  }

  const after = await getPlaidCleanupCounts(client, options);
  return { after, before };
}
