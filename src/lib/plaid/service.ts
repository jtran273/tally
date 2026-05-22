import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AccountType as PlaidAccountType,
  CountryCode,
  ItemRemoveReasonCode,
  Products,
  type AccountBase,
  type Institution,
  type LinkTokenCreateRequest,
  type RemovedTransaction,
  type Transaction
} from "plaid";
import type {
  AccountRow,
  AccountType,
  BalanceSnapshotRow,
  CategoryRecord,
  CategoryRow,
  Database,
  EnrichedTransactionRow,
  InstitutionRow,
  Json,
  MerchantRuleRow,
  PlaidItemRow,
  PlaidSyncRunItemRow,
  PlaidSyncRunRow,
  PlaidSyncRunSource,
  PlaidSyncRunStatus,
  RawTransactionRow,
  TransactionIntent
} from "../db/types";
import type { TransactionEnrichmentPatch } from "../db/queries";
import { createAutoReviewTransactionSuggestionService } from "../ai/server";
import { attachAiSuggestionsToReviewItems } from "../review/ai-suggestions";
import { evaluateAutoCategorization } from "../review/auto-categorization";
import { displayCategoryName } from "../finance/classification";
import { missingDefaultSystemCategories } from "../finance/default-categories";
import { buildTransactionReviewItems } from "../review/heuristics";
import { buildRuleAppliedEnrichment, findMatchingMerchantRule } from "../merchant-rules";
import { getPlaidLinkTokenConfig } from "./config";
import { getPlaidClient } from "./client";
import { getSafePlaidError } from "./errors";
import { getPlaidConnectionIssue, isPlaidServerConfigurationErrorCode, type PlaidConnectionIssue } from "./status";
import { decryptPlaidAccessToken, encryptPlaidAccessToken, PlaidTokenDecryptionError } from "./token-vault";
import { recordManualInvestmentSnapshots } from "@/lib/investments/manual-valuations";

type InstitutionInsert = Database["public"]["Tables"]["institutions"]["Insert"];
type InstitutionUpdate = Database["public"]["Tables"]["institutions"]["Update"];
type PlaidItemInsert = Database["public"]["Tables"]["plaid_items"]["Insert"];
type PlaidItemUpdate = Database["public"]["Tables"]["plaid_items"]["Update"];
type PlaidSyncRunInsert = Database["public"]["Tables"]["plaid_sync_runs"]["Insert"];
type PlaidSyncRunUpdate = Database["public"]["Tables"]["plaid_sync_runs"]["Update"];
type PlaidSyncRunItemInsert = Database["public"]["Tables"]["plaid_sync_run_items"]["Insert"];
type AccountInsert = Database["public"]["Tables"]["accounts"]["Insert"];
type AccountUpdate = Database["public"]["Tables"]["accounts"]["Update"];
type BalanceSnapshotInsert = Database["public"]["Tables"]["balance_snapshots"]["Insert"];
type RawTransactionInsert = Database["public"]["Tables"]["raw_transactions"]["Insert"];
type RawTransactionUpdate = Database["public"]["Tables"]["raw_transactions"]["Update"];
type EnrichedTransactionInsert = Database["public"]["Tables"]["enriched_transactions"]["Insert"];
type EnrichedTransactionUpdate = Database["public"]["Tables"]["enriched_transactions"]["Update"];
type ReviewItemInsert = Database["public"]["Tables"]["review_items"]["Insert"];

const PLAID_IMPORT_AI_REVIEW_SUGGESTION_LIMIT = 10;
const INSTITUTION_COLUMNS = "id,user_id,name,plaid_institution_id,logo_url,primary_color,website_url,created_at,updated_at";
const PLAID_ITEM_COLUMNS = [
  "id",
  "user_id",
  "institution_id",
  "status",
  "available_products",
  "billed_products",
  "error_code",
  "error_message",
  "consent_expires_at",
  "last_successful_sync_at",
  "auto_sync_enabled",
  "created_at",
  "updated_at"
].join(",");
const PLAID_ITEM_SYNC_COLUMNS = [
  "id",
  "user_id",
  "institution_id",
  "plaid_item_id",
  "access_token_ciphertext",
  "status",
  "available_products",
  "billed_products",
  "error_code",
  "error_message",
  "consent_expires_at",
  "last_successful_sync_at",
  "transaction_cursor",
  "auto_sync_enabled",
  "created_at",
  "updated_at"
].join(",");
const PLAID_SYNC_RUN_COLUMNS = [
  "id",
  "user_id",
  "source",
  "status",
  "started_at",
  "completed_at",
  "total_items",
  "succeeded_items",
  "failed_items",
  "accounts_upserted",
  "balance_snapshots_upserted",
  "raw_transactions_upserted",
  "raw_transactions_skipped",
  "enriched_transactions_inserted",
  "enriched_transactions_updated",
  "transactions_removed",
  "safe_error_code",
  "safe_error_message",
  "created_at",
  "updated_at"
].join(",");
const PLAID_SYNC_RUN_ITEM_COLUMNS = [
  "id",
  "user_id",
  "sync_run_id",
  "plaid_item_id",
  "status",
  "started_at",
  "completed_at",
  "accounts_upserted",
  "balance_snapshots_upserted",
  "raw_transactions_upserted",
  "raw_transactions_skipped",
  "enriched_transactions_inserted",
  "enriched_transactions_updated",
  "transactions_removed",
  "safe_error_code",
  "safe_error_message",
  "last_successful_sync_at",
  "created_at"
].join(",");
const ACCOUNT_COLUMNS = [
  "id",
  "user_id",
  "institution_id",
  "plaid_item_id",
  "plaid_account_id",
  "name",
  "official_name",
  "type",
  "subtype",
  "mask",
  "current_balance",
  "available_balance",
  "credit_limit",
  "iso_currency_code",
  "color",
  "is_active",
  "last_synced_at",
  "created_at",
  "updated_at"
].join(",");
const RAW_TRANSACTION_COLUMNS = [
  "id",
  "user_id",
  "account_id",
  "plaid_item_id",
  "plaid_transaction_id",
  "date",
  "authorized_date",
  "datetime",
  "authorized_datetime",
  "name",
  "merchant_name",
  "amount",
  "iso_currency_code",
  "status",
  "pending_transaction_id",
  "payment_channel",
  "plaid_category",
  "plaid_category_id",
  "transaction_type",
  "location",
  "payment_meta",
  "raw_payload",
  "first_seen_at",
  "updated_at"
].join(",");

const SYNC_PAGE_SIZE = 500;
const UPSERT_CHUNK_SIZE = 100;
const OPPORTUNISTIC_SYNC_THROTTLE_MS = 24 * 60 * 60 * 1000;
const OPPORTUNISTIC_SYNC_RUNNING_STALE_MS = 30 * 60 * 1000;
const TERMINAL_ITEM_REMOVE_ERROR_CODES = new Set(["INVALID_ACCESS_TOKEN", "ITEM_NOT_FOUND"]);
const RETIREMENT_SUBTYPES = new Set([
  "401a",
  "401k",
  "403b",
  "457b",
  "529",
  "cash isa",
  "education savings account",
  "fixed annuity",
  "gic",
  "hsa",
  "ira",
  "keogh",
  "lif",
  "lira",
  "lrif",
  "lrsp",
  "pension",
  "prif",
  "profit sharing plan",
  "qshr",
  "rdsp",
  "resp",
  "retirement",
  "rlif",
  "roth",
  "roth 401k",
  "roth 403b",
  "roth 457b",
  "roth ira",
  "roth pension",
  "roth profit sharing plan",
  "roth thrift savings plan",
  "rrif",
  "rrsp",
  "sarsep",
  "sep ira",
  "simple ira",
  "sipp",
  "thrift savings plan",
  "tfsa"
]);

const PFC_CONFIDENCE: Record<string, number> = {
  HIGH: 0.9,
  LOW: 0.5,
  MEDIUM: 0.75,
  UNKNOWN: 0.25,
  VERY_HIGH: 0.98
};

export interface PlaidInstitutionInput {
  institutionId?: string | null;
  name?: string | null;
}

type FinanceSupabaseClient = SupabaseClient;
type PlaidItemPublicRow = Omit<
  PlaidItemRow,
  "access_token_ciphertext" | "plaid_item_id" | "transaction_cursor"
>;

export interface PlaidConnectionSummary {
  autoSyncEnabled: boolean;
  availableProducts: string[];
  billedProducts: string[];
  consentExpiresAt: string | null;
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  institutionId: string;
  institutionName: string;
  issue: PlaidConnectionIssue | null;
  lastSuccessfulSyncAt: string | null;
  status: PlaidItemRow["status"];
  updatedAt: string;
}

export interface PlaidSyncItemSummary {
  accountsUpserted: number;
  balanceSnapshotsUpserted: number;
  enrichedTransactionsInserted: number;
  enrichedTransactionsUpdated: number;
  errorCode?: string;
  errorMessage?: string;
  id: string;
  lastSuccessfulSyncAt: string | null;
  rawTransactionsSkipped: number;
  rawTransactionsUpserted: number;
  transactionsRemoved: number;
  warningCode?: string;
  warningMessage?: string;
}

export interface PlaidItemLedgerDataPurgeSummary {
  accountsDeleted: number;
  agentProposalsDeleted: number;
  auditEventsDeleted: number;
  balanceSnapshotsDeleted: number;
  enrichedTransactionsDeleted: number;
  plaidSyncRunItemsDeleted: number;
  rawTransactionsDeleted: number;
  recurringExpensesDeleted: number;
  reimbursementRecordsDeleted: number;
  reviewItemsDeleted: number;
  transactionSplitsDeleted: number;
}

export interface PlaidSyncRunSummary {
  accountsUpserted: number;
  balanceSnapshotsUpserted: number;
  enrichedTransactionsInserted: number;
  enrichedTransactionsUpdated: number;
  failed: number;
  items: PlaidSyncItemSummary[];
  rawTransactionsSkipped: number;
  rawTransactionsUpserted: number;
  runId: string | null;
  source: PlaidSyncRunSource;
  startedAt: string;
  status: Exclude<PlaidSyncRunStatus, "running">;
  succeeded: number;
  totalItems: number;
  transactionsRemoved: number;
}

export interface PlaidSyncRunItemStatusSummary extends PlaidSyncItemSummary {
  completedAt: string;
  status: Exclude<PlaidSyncRunStatus, "running" | "partial">;
}

export interface PlaidPersistedSyncRunSummary extends Omit<PlaidSyncRunSummary, "items"> {
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  items: PlaidSyncRunItemStatusSummary[];
}

export interface PlaidScheduledSyncSummary {
  failedUsers: number;
  runs: PlaidSyncRunSummary[];
  succeededUsers: number;
  totalUsers: number;
}

export interface PlaidOpportunisticSyncSummary {
  checkedAt: string;
  reason: "in_progress" | "no_items" | "recently_synced" | "synced";
  sync: PlaidSyncRunSummary | null;
}

export interface PlaidLinkTokenResult {
  expiration: string;
  linkToken: string;
  requestId: string;
}

function toConnectionSummary(item: PlaidItemPublicRow, institution?: InstitutionRow): PlaidConnectionSummary {
  const hasServerConfigurationError = isPlaidServerConfigurationErrorCode(item.error_code);
  const status = hasServerConfigurationError && item.status !== "revoked" ? "active" : item.status;
  const errorCode = hasServerConfigurationError ? null : item.error_code;
  const issue = getPlaidConnectionIssue({
    errorCode,
    institutionName: institution?.name ?? null,
    lastSuccessfulSyncAt: item.last_successful_sync_at,
    status
  });

  return {
    autoSyncEnabled: item.auto_sync_enabled,
    availableProducts: item.available_products,
    billedProducts: item.billed_products,
    consentExpiresAt: item.consent_expires_at,
    createdAt: item.created_at,
    errorCode,
    errorMessage: issue?.detail ?? null,
    id: item.id,
    institutionId: item.institution_id,
    institutionName: institution?.name ?? "Unknown institution",
    issue,
    lastSuccessfulSyncAt: item.last_successful_sync_at,
    status,
    updatedAt: item.updated_at
  };
}

export function isPlaidItemDueForOpportunisticSync(
  item: Pick<PlaidItemRow, "last_successful_sync_at" | "status">,
  now = new Date()
) {
  if (item.status === "revoked") return false;
  if (!item.last_successful_sync_at) return true;

  const lastSuccessfulSyncAt = Date.parse(item.last_successful_sync_at);
  if (Number.isNaN(lastSuccessfulSyncAt)) return true;

  return now.getTime() - lastSuccessfulSyncAt >= OPPORTUNISTIC_SYNC_THROTTLE_MS;
}

export function isRecentRunningPlaidSync(
  run: Pick<PlaidSyncRunRow, "started_at" | "status"> | null | undefined,
  now = new Date()
) {
  if (!run || run.status !== "running") return false;

  const startedAt = Date.parse(run.started_at);
  if (Number.isNaN(startedAt)) return true;

  return now.getTime() - startedAt < OPPORTUNISTIC_SYNC_RUNNING_STALE_MS;
}

function byId(rows: InstitutionRow[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function coalesceInstitutionName(...names: Array<string | null | undefined>) {
  return names.find((name) => typeof name === "string" && name.trim())?.trim() ?? "Plaid institution";
}

function expectData<T>(
  result: { data: T | null; error: { code?: string; message: string } | null },
  context: string
): T {
  if (result.error || result.data === null) {
    throw new Error(`${context}: ${result.error?.message ?? "No data returned."}`);
  }

  return result.data;
}

function isMissingSchemaTableError(error: { code?: string; message: string } | null | undefined) {
  if (!error) return false;

  return error.code === "42P01" || error.code === "PGRST205" || (
    error.message.includes("Could not find the table") && error.message.includes("schema cache")
  );
}

function expectOptionalData<T>(
  result: { data: T | null; error: { code?: string; message: string } | null },
  context: string
): T | null {
  if (isMissingSchemaTableError(result.error)) {
    console.warn("plaid_purge_optional_table_missing", { context });
    return null;
  }

  return expectData(result, context);
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function safeJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? {})) as Json;
}

function normalizeCurrency(value: string | null | undefined) {
  return value && /^[A-Z]{3}$/.test(value) ? value : "USD";
}

function roundMoney(value: number | null | undefined) {
  return Number((value ?? 0).toFixed(2));
}

function cleanRequiredText(value: string | null | undefined, fallback: string) {
  const text = value?.trim();
  return text ? text.slice(0, 240) : fallback;
}

function humanizePlaidCategory(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return null;

  return text
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function mapPlaidAccountType(account: AccountBase): AccountType {
  const subtype = account.subtype?.toString().toLowerCase() ?? "";

  if (account.type === PlaidAccountType.Investment || account.type === PlaidAccountType.Brokerage) {
    return RETIREMENT_SUBTYPES.has(subtype) ? "retirement" : "investment";
  }

  if (account.type === PlaidAccountType.Credit || account.type === PlaidAccountType.Loan) {
    return "credit";
  }

  return "depository";
}

function toLedgerBalance(account: AccountBase) {
  const type = mapPlaidAccountType(account);
  const current = roundMoney(account.balances.current ?? account.balances.available ?? 0);

  return type === "credit" ? -Math.abs(current) : current;
}

function toLedgerAmount(transaction: Transaction) {
  return roundMoney(-transaction.amount);
}

function getPlaidCategory(transaction: Transaction) {
  const pfc = transaction.personal_finance_category;

  if (pfc?.primary || pfc?.detailed) {
    return [pfc.primary, pfc.detailed].filter(Boolean).join(" / ");
  }

  return transaction.category?.length ? transaction.category.join(" / ") : null;
}

function getDefaultCategoryName(transaction: Transaction) {
  const pfc = transaction.personal_finance_category;
  const primary = pfc?.primary ?? "";
  const detailed = pfc?.detailed ?? "";
  const appCategory = mapPlaidPersonalFinanceCategory(primary, detailed);

  if (appCategory) return appCategory;

  const categoryText = [
    primary,
    detailed,
    ...(transaction.category ?? [])
  ].filter(Boolean).join(" ").toUpperCase();

  if (categoryText.includes("TRANSFER")) return "Transfer";
  if (categoryText.includes("INCOME")) return "Income";

  if (pfc?.primary || pfc?.detailed) {
    const primaryName = humanizePlaidCategory(pfc.primary);
    const detailedCode = pfc.detailed?.startsWith(`${pfc.primary}_`)
      ? pfc.detailed.slice(pfc.primary.length + 1)
      : pfc.detailed;
    const detailedName = humanizePlaidCategory(detailedCode);

    if (primaryName && detailedName && primaryName !== detailedName) {
      return `${primaryName} / ${detailedName}`;
    }

    return detailedName ?? primaryName ?? "Uncategorized";
  }

  return transaction.category?.at(-1) ?? "Uncategorized";
}

function mapPlaidPersonalFinanceCategory(primary: string, detailed: string) {
  if (primary === "INCOME") return "Income";
  if (primary.startsWith("TRANSFER") || primary === "LOAN_PAYMENTS" || primary === "LOAN_DISBURSEMENTS") return "Transfer";

  if (primary === "FOOD_AND_DRINK") {
    return detailed === "FOOD_AND_DRINK_GROCERIES" ? "Groceries" : "Food / Restaurants";
  }

  if (primary === "GENERAL_MERCHANDISE") return "Shopping";

  if (primary === "TRANSPORTATION") {
    if (detailed === "TRANSPORTATION_GAS_STATIONS") return "Transport / Gas";
    if (detailed === "TRANSPORTATION_PARKING") return "Transport / Parking";
    if (detailed === "TRANSPORTATION_PUBLIC_TRANSIT") return "Transport / Public Transit";
    return "Transport / Rideshare";
  }

  if (primary === "TRAVEL") return "Travel / Flights";
  if (primary === "RENT_AND_UTILITIES") return "Housing";

  if (primary === "MEDICAL") {
    return detailed === "MEDICAL_PHARMACIES_AND_SUPPLEMENTS" ? "Health / Pharmacy" : "Health / Medical";
  }

  if (primary === "PERSONAL_CARE") return "Health / Fitness";
  if (primary === "ENTERTAINMENT") return "Entertainment";
  if (primary === "RECREATION") return "Entertainment";
  if (primary === "EDUCATION") return "Education";
  if (primary === "HOME_IMPROVEMENT") return "Home / Improvement";
  if (primary === "GENERAL_SERVICES") return "Services";
  if (primary === "BANK_FEES") return "Bank Fees";
  if (primary === "GOVERNMENT_AND_NON_PROFIT") return "Government / Non-Profit";

  return null;
}

function getDefaultIntent(transaction: Transaction): TransactionIntent {
  const categoryText = [
    transaction.personal_finance_category?.primary,
    transaction.personal_finance_category?.detailed,
    ...(transaction.category ?? [])
  ].filter(Boolean).join(" ").toUpperCase();

  return categoryText.includes("TRANSFER")
    || categoryText.includes("LOAN_PAYMENTS")
    || categoryText.includes("LOAN_DISBURSEMENTS")
    ? "transfer"
    : "personal";
}

export function getDefaultConfidence(transaction: Transaction) {
  const confidence = transaction.personal_finance_category?.confidence_level;
  if (confidence) return PFC_CONFIDENCE[confidence] ?? 0.75;

  if (!transaction.category?.length) return 0.25;

  const categoryName = getDefaultCategoryName(transaction).trim().toLowerCase();
  if (!categoryName || categoryName === "uncategorized") return 0.25;

  return 0.65;
}

function getMerchantName(transaction: Transaction) {
  return cleanRequiredText(transaction.merchant_name ?? transaction.name, "Plaid transaction");
}

function dedupePlaidAccounts(accounts: readonly AccountBase[]) {
  return [...new Map(accounts.map((account) => [account.account_id, account])).values()];
}

function dedupeTransactions(transactions: Transaction[]) {
  return [...new Map(transactions.map((transaction) => [transaction.transaction_id, transaction])).values()];
}

export interface PendingRawReplacementCandidate {
  pending_transaction_id?: string | null;
  plaid_transaction_id?: string;
  status?: "pending" | "posted";
}

export interface ExistingPendingRawCandidate {
  id: string;
  plaid_transaction_id: string;
  status: "pending" | "posted";
}

export interface PendingRawReplacement {
  incomingPlaidTransactionId: string;
  pendingPlaidTransactionId: string;
  rawTransactionId: string;
}

function getPlaidPendingReplacementIds(transactions: readonly PendingRawReplacementCandidate[]) {
  return new Set(
    transactions
      .filter((transaction) => transaction.status === "posted")
      .map((transaction) => transaction.pending_transaction_id?.trim() ?? "")
      .filter(Boolean)
  );
}

export function planPendingRawTransactionReplacements({
  existingPendingRows,
  incomingRows
}: {
  existingPendingRows: readonly ExistingPendingRawCandidate[];
  incomingRows: readonly PendingRawReplacementCandidate[];
}): PendingRawReplacement[] {
  const existingPendingByPlaidId = new Map(
    existingPendingRows
      .filter((row) => row.status === "pending")
      .map((row) => [row.plaid_transaction_id, row])
  );
  const plannedPendingIds = new Set<string>();

  return incomingRows.flatMap((row) => {
    if (row.status !== "posted" || !row.pending_transaction_id || !row.plaid_transaction_id) return [];
    if (plannedPendingIds.has(row.pending_transaction_id)) return [];

    const pendingRow = existingPendingByPlaidId.get(row.pending_transaction_id);
    if (!pendingRow) return [];
    plannedPendingIds.add(row.pending_transaction_id);

    return [{
      incomingPlaidTransactionId: row.plaid_transaction_id,
      pendingPlaidTransactionId: pendingRow.plaid_transaction_id,
      rawTransactionId: pendingRow.id
    }];
  });
}

export function getRemovedPlaidTransactionIdsToDelete(
  removed: readonly Pick<RemovedTransaction, "transaction_id">[],
  preservedPendingTransactionIds: ReadonlySet<string>
) {
  return [...new Set(
    removed
      .map((transaction) => transaction.transaction_id)
      .filter((transactionId) => !preservedPendingTransactionIds.has(transactionId))
  )];
}

export function shouldRefreshPlaidEnrichment(
  existing: Pick<EnrichedTransactionRow, "reviewed_at" | "source"> | null | undefined
) {
  return existing?.source === "plaid" && !existing.reviewed_at;
}

export interface PlaidAccountSyncSources {
  accountsGetAccounts: readonly AccountBase[];
  balanceAccounts: readonly AccountBase[];
  transactionSyncAccounts: readonly AccountBase[];
}

export function mergePlaidAccountSourcesForSync({
  accountsGetAccounts,
  balanceAccounts,
  transactionSyncAccounts
}: PlaidAccountSyncSources) {
  return dedupePlaidAccounts([
    ...transactionSyncAccounts,
    ...accountsGetAccounts,
    ...balanceAccounts
  ]);
}

function safeInternalSyncStep(error: unknown) {
  if (!(error instanceof Error)) return null;

  const step = error.message.split(":")[0]?.trim();
  if (!step || step.length > 80) return null;
  if (!/^[A-Za-z0-9 /()._-]+$/.test(step)) return null;

  return step;
}

function isPlaidRequestFailure(error: unknown) {
  const safe = getSafePlaidError(error);
  if (safe.status || safe.type || safe.requestId || safe.transportCode) return true;

  return isPlaidServerConfigurationErrorCode(safe.code)
    || safe.code === "PLAID_TOKEN_DECRYPTION_ERROR"
    || safe.code !== "PLAID_REQUEST_FAILED";
}

function plaidRequestFailureMessage(error: unknown) {
  const safe = getSafePlaidError(error);
  const details = [
    safe.status ? `HTTP status ${safe.status}` : null,
    safe.type ? `Plaid error type ${safe.type}` : null,
    safe.transportCode ? `transport code ${safe.transportCode}` : null
  ].filter(Boolean);

  return details.length > 0
    ? `Plaid request failed with ${details.join(", ")}.`
    : "Plaid request failed without a specific item error.";
}

export function persistedSyncError(error: unknown) {
  const safe = getSafePlaidError(error);

  if (!isPlaidRequestFailure(error)) {
    const step = safeInternalSyncStep(error);
    return {
      error_code: "PLAID_SYNC_INTERNAL_ERROR",
      error_message: step
        ? `Tally sync failed while saving imported Plaid data during ${step}.`
        : "Tally sync failed while saving imported Plaid data."
    };
  }

  return {
    error_code: safe.code,
    error_message: plaidRequestFailureMessage(error)
  };
}

function logPlaidItemSyncFailure(error: unknown) {
  const syncError = persistedSyncError(error);
  const safe = getSafePlaidError(error);

  console.error("plaid_item_sync_failed", {
    code: syncError.error_code,
    message: syncError.error_message,
    plaidRequestId: safe.requestId,
    plaidStatus: safe.status,
    plaidTransportCode: safe.transportCode,
    plaidType: safe.type
  });
}

async function findExistingInstitution(
  client: FinanceSupabaseClient,
  userId: string,
  plaidInstitutionId: string | null,
  name: string
) {
  if (plaidInstitutionId) {
    const result = await client
      .from("institutions")
      .select(INSTITUTION_COLUMNS)
      .eq("user_id", userId)
      .eq("plaid_institution_id", plaidInstitutionId)
      .maybeSingle();

    if (result.error) throw new Error(`Find Plaid institution: ${result.error.message}`);
    if (result.data) return result.data;
  }

  const result = await client
    .from("institutions")
    .select(INSTITUTION_COLUMNS)
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();

  if (result.error) throw new Error(`Find Plaid institution by name: ${result.error.message}`);
  return result.data;
}

async function fetchInstitutionDetails(plaidInstitutionId: string | null) {
  if (!plaidInstitutionId) return null;

  try {
    const plaid = getPlaidClient();
    const response = await plaid.institutionsGetById({
      country_codes: [CountryCode.Us],
      institution_id: plaidInstitutionId,
      options: {
        include_optional_metadata: true
      }
    });

    return response.data.institution;
  } catch (error) {
    console.warn("plaid_institution_metadata_fetch_failed", getSafePlaidError(error));
    return null;
  }
}

async function upsertInstitution({
  client,
  details,
  fallback,
  itemInstitutionId,
  itemInstitutionName,
  userId
}: {
  client: FinanceSupabaseClient;
  details: Institution | null;
  fallback?: PlaidInstitutionInput;
  itemInstitutionId: string | null;
  itemInstitutionName: string | null;
  userId: string;
}) {
  const plaidInstitutionId = details?.institution_id ?? itemInstitutionId ?? fallback?.institutionId ?? null;
  const name = coalesceInstitutionName(details?.name, itemInstitutionName, fallback?.name);
  const existing = await findExistingInstitution(client, userId, plaidInstitutionId, name);
  const update: InstitutionUpdate = {
    name,
    plaid_institution_id: plaidInstitutionId,
    primary_color: details?.primary_color ?? undefined,
    website_url: details?.url ?? undefined
  };

  if (existing) {
    const result = await client
      .from("institutions")
      .update(update)
      .eq("user_id", userId)
      .eq("id", existing.id)
      .select(INSTITUTION_COLUMNS)
      .single();

    if (result.error || !result.data) {
      throw new Error(`Update Plaid institution: ${result.error?.message ?? "No data returned."}`);
    }

    return result.data as InstitutionRow;
  }

  const insert: InstitutionInsert = {
    ...update,
    user_id: userId
  };
  const result = await client
    .from("institutions")
    .insert(insert)
    .select(INSTITUTION_COLUMNS)
    .single();

  if (result.error || !result.data) {
    throw new Error(`Insert Plaid institution: ${result.error?.message ?? "No data returned."}`);
  }

  return result.data as InstitutionRow;
}

async function upsertPlaidItem({
  accessToken,
  client,
  institutionId,
  item,
  userId
}: {
  accessToken: string;
  client: FinanceSupabaseClient;
  institutionId: string;
  item: {
    available_products: Products[];
    billed_products: Products[];
    consent_expiration_time: string | null;
    error: { error_code: string; error_message: string } | null;
    item_id: string;
  };
  userId: string;
}) {
  const insert: PlaidItemInsert = {
    access_token_ciphertext: encryptPlaidAccessToken(accessToken),
    available_products: item.available_products,
    billed_products: item.billed_products,
    consent_expires_at: item.consent_expiration_time,
    error_code: item.error?.error_code ?? null,
    error_message: item.error?.error_message ?? null,
    institution_id: institutionId,
    plaid_item_id: item.item_id,
    status: item.error ? "error" : "active",
    user_id: userId
  };
  const result = await client
    .from("plaid_items")
    .upsert(insert, { onConflict: "user_id,plaid_item_id" })
    .select(PLAID_ITEM_COLUMNS)
    .single();

  if (result.error || !result.data) {
    throw new Error(`Persist Plaid item: ${result.error?.message ?? "No data returned."}`);
  }

  return result.data as unknown as PlaidItemPublicRow;
}

function buildAccountInsert(
  item: PlaidItemRow,
  userId: string,
  account: AccountBase,
  syncedAt: string
): AccountInsert {
  const type = mapPlaidAccountType(account);

  return {
    available_balance: account.balances.available === null ? null : roundMoney(account.balances.available),
    credit_limit: account.balances.limit === null ? null : roundMoney(account.balances.limit),
    current_balance: toLedgerBalance(account),
    institution_id: item.institution_id,
    is_active: true,
    iso_currency_code: normalizeCurrency(account.balances.iso_currency_code),
    last_synced_at: syncedAt,
    mask: account.mask,
    name: cleanRequiredText(account.name, "Plaid account"),
    official_name: account.official_name,
    plaid_account_id: account.account_id,
    plaid_item_id: item.id,
    subtype: account.subtype?.toString() ?? null,
    type,
    user_id: userId
  };
}

async function markInactiveAccounts(
  client: FinanceSupabaseClient,
  item: PlaidItemRow,
  userId: string,
  activePlaidAccountIds: Set<string>,
  syncedAt: string
) {
  const existingResult = await client
    .from("accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("user_id", userId)
    .eq("plaid_item_id", item.id);
  const existingRows = expectData(existingResult, "Load Plaid item accounts") as unknown as AccountRow[];
  const staleRows = existingRows.filter((row) => row.is_active && !activePlaidAccountIds.has(row.plaid_account_id));

  await Promise.all(staleRows.map(async (row) => {
    const update: AccountUpdate = {
      is_active: false,
      last_synced_at: syncedAt
    };
    const result = await client
      .from("accounts")
      .update(update)
      .eq("user_id", userId)
      .eq("id", row.id);

    if (result.error) throw new Error(`Mark Plaid account inactive: ${result.error.message}`);
  }));
}

async function upsertBalanceSnapshots(
  client: FinanceSupabaseClient,
  userId: string,
  accountRows: AccountRow[],
  snapshotDate: string
) {
  const inserts: BalanceSnapshotInsert[] = accountRows.map((account) => ({
    account_id: account.id,
    available_balance: account.available_balance,
    credit_limit: account.credit_limit,
    current_balance: account.current_balance,
    iso_currency_code: account.iso_currency_code,
    snapshot_date: snapshotDate,
    source: "plaid",
    user_id: userId
  }));

  if (inserts.length === 0) return 0;

  let upserted = 0;

  for (const batch of chunk(inserts, UPSERT_CHUNK_SIZE)) {
    const result = await client
      .from("balance_snapshots")
      .upsert(batch, { onConflict: "user_id,account_id,snapshot_date" })
      .select("id");
    const rows = expectData(result, "Upsert Plaid balance snapshots") as Pick<BalanceSnapshotRow, "id">[];
    upserted += rows.length;
  }

  return upserted;
}

async function upsertPlaidAccounts({
  accounts,
  client,
  item,
  snapshotDate,
  syncedAt,
  userId
}: {
  accounts: AccountBase[];
  client: FinanceSupabaseClient;
  item: PlaidItemRow;
  snapshotDate: string;
  syncedAt: string;
  userId: string;
}) {
  const uniqueAccounts = dedupePlaidAccounts(accounts);
  const accountRows: AccountRow[] = [];

  if (uniqueAccounts.length > 0) {
    const inserts = uniqueAccounts.map((account) => buildAccountInsert(item, userId, account, syncedAt));

    for (const batch of chunk(inserts, UPSERT_CHUNK_SIZE)) {
      const result = await client
        .from("accounts")
        .upsert(batch, { onConflict: "user_id,plaid_account_id" })
        .select(ACCOUNT_COLUMNS);
      accountRows.push(...expectData(result, "Upsert Plaid accounts") as unknown as AccountRow[]);
    }
  }

  await markInactiveAccounts(
    client,
    item,
    userId,
    new Set(uniqueAccounts.map((account) => account.account_id)),
    syncedAt
  );

  const snapshotsUpserted = await upsertBalanceSnapshots(client, userId, accountRows, snapshotDate);

  return {
    accountByPlaidId: new Map(accountRows.map((row) => [row.plaid_account_id, row])),
    accountsUpserted: accountRows.length,
    balanceSnapshotsUpserted: snapshotsUpserted
  };
}

async function fetchTransactionSyncUpdates(
  accessToken: string,
  initialCursor: string | null
) {
  const plaid = getPlaidClient();
  const updates = {
    accounts: [] as AccountBase[],
    added: [] as Transaction[],
    modified: [] as Transaction[],
    nextCursor: initialCursor,
    removed: [] as RemovedTransaction[]
  };
  let cursor = initialCursor ?? undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await plaid.transactionsSync({
      access_token: accessToken,
      count: SYNC_PAGE_SIZE,
      cursor,
      options: {
        include_original_description: true
      }
    });
    const data = response.data;

    updates.accounts.push(...data.accounts);
    updates.added.push(...data.added);
    updates.modified.push(...data.modified);
    updates.removed.push(...data.removed);
    updates.nextCursor = data.next_cursor || updates.nextCursor;
    cursor = data.next_cursor || cursor;
    hasMore = data.has_more;
  }

  updates.accounts = dedupePlaidAccounts(updates.accounts);
  updates.added = dedupeTransactions(updates.added);
  updates.modified = dedupeTransactions(updates.modified);

  return updates;
}

function emptyTransactionSyncUpdates(initialCursor: string | null) {
  return {
    accounts: [] as AccountBase[],
    added: [] as Transaction[],
    modified: [] as Transaction[],
    nextCursor: initialCursor,
    removed: [] as RemovedTransaction[],
    warning: null as { error_code: string; error_message: string } | null
  };
}

export function isSkippablePlaidTransactionsError(error: unknown) {
  const code = getSafePlaidError(error).code;
  return code === "INVALID_PRODUCT" || code === "PRODUCT_NOT_ENABLED" || code === "PRODUCT_NOT_READY";
}

async function fetchTransactionSyncUpdatesWithRetry(accessToken: string, initialCursor: string | null) {
  try {
    return await fetchTransactionSyncUpdates(accessToken, initialCursor);
  } catch (error) {
    if (getSafePlaidError(error).code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") {
      throw error;
    }

    return fetchTransactionSyncUpdates(accessToken, initialCursor);
  }
}

async function fetchTransactionSyncUpdatesForImport(accessToken: string, initialCursor: string | null) {
  try {
    return {
      ...await fetchTransactionSyncUpdatesWithRetry(accessToken, initialCursor),
      warning: null as { error_code: string; error_message: string } | null
    };
  } catch (error) {
    if (!isSkippablePlaidTransactionsError(error)) {
      throw error;
    }

    const safe = getSafePlaidError(error);
    console.warn("plaid_transactions_sync_skipped", safe);
    return {
      ...emptyTransactionSyncUpdates(initialCursor),
      warning: {
        error_code: safe.code,
        error_message: "Plaid transactions are not available for this connection yet."
      }
    };
  }
}

async function fetchBalanceAccounts(accessToken: string) {
  const plaid = getPlaidClient();

  try {
    const response = await plaid.accountsBalanceGet({ access_token: accessToken });
    return response.data.accounts;
  } catch (error) {
    const safe = getSafePlaidError(error);

    if (safe.code === "INVALID_PRODUCT") {
      console.warn("plaid_balance_fetch_skipped", safe);
      return [];
    }

    throw error;
  }
}

async function fetchItemAccounts(accessToken: string) {
  const plaid = getPlaidClient();
  const response = await plaid.accountsGet({ access_token: accessToken });
  return response.data.accounts;
}

async function deleteRemovedTransactions({
  client,
  item,
  preservedPendingTransactionIds,
  removed,
  userId
}: {
  client: FinanceSupabaseClient;
  item: PlaidItemRow;
  preservedPendingTransactionIds?: ReadonlySet<string>;
  removed: RemovedTransaction[];
  userId: string;
}) {
  const transactionIds = getRemovedPlaidTransactionIdsToDelete(
    removed,
    preservedPendingTransactionIds ?? new Set()
  );
  let removedCount = 0;

  for (const batch of chunk(transactionIds, UPSERT_CHUNK_SIZE)) {
    if (batch.length === 0) continue;

    const result = await client
      .from("raw_transactions")
      .delete()
      .eq("user_id", userId)
      .eq("plaid_item_id", item.id)
      .in("plaid_transaction_id", batch)
      .select("id");
    const rows = expectData(result, "Delete removed Plaid transactions") as Pick<RawTransactionRow, "id">[];
    removedCount += rows.length;
  }

  return removedCount;
}

function buildRawTransactionInsert({
  account,
  item,
  transaction,
  userId
}: {
  account: AccountRow;
  item: PlaidItemRow;
  transaction: Transaction;
  userId: string;
}): RawTransactionInsert {
  const pfc = transaction.personal_finance_category;

  return {
    account_id: account.id,
    amount: toLedgerAmount(transaction),
    authorized_date: transaction.authorized_date,
    authorized_datetime: transaction.authorized_datetime,
    date: transaction.date,
    datetime: transaction.datetime,
    iso_currency_code: normalizeCurrency(transaction.iso_currency_code),
    location: safeJson(transaction.location),
    merchant_name: transaction.merchant_name ?? null,
    name: cleanRequiredText(transaction.name, transaction.merchant_name ?? "Plaid transaction"),
    payment_channel: transaction.payment_channel?.toString() ?? null,
    payment_meta: safeJson(transaction.payment_meta),
    pending_transaction_id: transaction.pending_transaction_id,
    plaid_category: getPlaidCategory(transaction),
    plaid_category_id: transaction.category_id ?? pfc?.detailed ?? null,
    plaid_item_id: item.id,
    plaid_transaction_id: transaction.transaction_id,
    raw_payload: safeJson(transaction),
    status: transaction.pending ? "pending" : "posted",
    transaction_type: transaction.transaction_type?.toString() ?? transaction.transaction_code?.toString() ?? null,
    user_id: userId
  };
}

function buildRawTransactionUpdate(insert: RawTransactionInsert): RawTransactionUpdate {
  return {
    account_id: insert.account_id,
    amount: insert.amount,
    authorized_date: insert.authorized_date,
    authorized_datetime: insert.authorized_datetime,
    date: insert.date,
    datetime: insert.datetime,
    iso_currency_code: insert.iso_currency_code,
    location: insert.location,
    merchant_name: insert.merchant_name,
    name: insert.name,
    payment_channel: insert.payment_channel,
    payment_meta: insert.payment_meta,
    pending_transaction_id: insert.pending_transaction_id,
    plaid_category: insert.plaid_category,
    plaid_category_id: insert.plaid_category_id,
    plaid_item_id: insert.plaid_item_id,
    plaid_transaction_id: insert.plaid_transaction_id,
    raw_payload: insert.raw_payload,
    status: insert.status,
    transaction_type: insert.transaction_type
  };
}

async function loadPendingRawRowsForReplacement({
  client,
  item,
  pendingTransactionIds,
  userId
}: {
  client: FinanceSupabaseClient;
  item: PlaidItemRow;
  pendingTransactionIds: ReadonlySet<string>;
  userId: string;
}) {
  const rows: RawTransactionRow[] = [];

  for (const batch of chunk([...pendingTransactionIds], UPSERT_CHUNK_SIZE)) {
    if (batch.length === 0) continue;

    const result = await client
      .from("raw_transactions")
      .select(RAW_TRANSACTION_COLUMNS)
      .eq("user_id", userId)
      .eq("plaid_item_id", item.id)
      .eq("status", "pending")
      .in("plaid_transaction_id", batch);

    rows.push(...expectData(result, "Load pending Plaid transaction replacements") as unknown as RawTransactionRow[]);
  }

  return rows;
}

async function replacePendingRawTransactions({
  client,
  item,
  inserts,
  userId
}: {
  client: FinanceSupabaseClient;
  item: PlaidItemRow;
  inserts: RawTransactionInsert[];
  userId: string;
}) {
  const pendingReplacementIds = getPlaidPendingReplacementIds(inserts);
  const existingPendingRows = await loadPendingRawRowsForReplacement({
    client,
    item,
    pendingTransactionIds: pendingReplacementIds,
    userId
  });
  const replacementPlan = planPendingRawTransactionReplacements({
    existingPendingRows,
    incomingRows: inserts
  });
  const insertByPlaidId = new Map(inserts.map((insert) => [insert.plaid_transaction_id, insert]));
  const replacedRows: RawTransactionRow[] = [];
  const replacedPlaidTransactionIds = new Set<string>();
  const replacedPendingPlaidTransactionIds = new Set<string>();

  for (const replacement of replacementPlan) {
    const insert = insertByPlaidId.get(replacement.incomingPlaidTransactionId);
    if (!insert) continue;

    const result = await client
      .from("raw_transactions")
      .update(buildRawTransactionUpdate(insert))
      .eq("user_id", userId)
      .eq("plaid_item_id", item.id)
      .eq("id", replacement.rawTransactionId)
      .eq("plaid_transaction_id", replacement.pendingPlaidTransactionId)
      .eq("status", "pending")
      .select(RAW_TRANSACTION_COLUMNS)
      .single();
    const row = expectData(result, "Replace pending Plaid raw transaction") as unknown as RawTransactionRow;

    replacedRows.push(row);
    replacedPlaidTransactionIds.add(replacement.incomingPlaidTransactionId);
    replacedPendingPlaidTransactionIds.add(replacement.pendingPlaidTransactionId);
  }

  return {
    replacedPendingPlaidTransactionIds,
    replacedPlaidTransactionIds,
    replacedRows
  };
}

async function upsertRawTransactions({
  accountByPlaidId,
  client,
  item,
  transactions,
  userId
}: {
  accountByPlaidId: Map<string, AccountRow>;
  client: FinanceSupabaseClient;
  item: PlaidItemRow;
  transactions: Transaction[];
  userId: string;
}) {
  const uniqueTransactions = dedupeTransactions(transactions);
  const transactionByPlaidId = new Map(uniqueTransactions.map((transaction) => [transaction.transaction_id, transaction]));
  const inserts: RawTransactionInsert[] = [];
  let skipped = 0;

  for (const transaction of uniqueTransactions) {
    const account = accountByPlaidId.get(transaction.account_id);

    if (!account) {
      skipped += 1;
      continue;
    }

    inserts.push(buildRawTransactionInsert({ account, item, transaction, userId }));
  }

  const rawRows: RawTransactionRow[] = [];
  const replacementResult = await replacePendingRawTransactions({
    client,
    inserts,
    item,
    userId
  });
  rawRows.push(...replacementResult.replacedRows);
  const remainingInserts = inserts.filter((insert) => {
    const plaidTransactionId = insert.plaid_transaction_id;
    return !plaidTransactionId || !replacementResult.replacedPlaidTransactionIds.has(plaidTransactionId);
  });

  for (const batch of chunk(remainingInserts, UPSERT_CHUNK_SIZE)) {
    const result = await client
      .from("raw_transactions")
      .upsert(batch, { onConflict: "user_id,plaid_transaction_id" })
      .select(RAW_TRANSACTION_COLUMNS);
    rawRows.push(...expectData(result, "Upsert Plaid raw transactions") as unknown as RawTransactionRow[]);
  }

  return {
    rawRows,
    rawTransactionsSkipped: skipped,
    rawTransactionsUpserted: rawRows.length,
    replacedPendingPlaidTransactionIds: replacementResult.replacedPendingPlaidTransactionIds,
    transactionByPlaidId
  };
}

async function loadCategoryRows(client: FinanceSupabaseClient, userId: string) {
  const result = await client
    .from("categories")
    .select("id,user_id,parent_id,name,color,icon,is_system,created_at,updated_at")
    .eq("user_id", userId);

  const rows = expectData(result, "Load categories for Plaid enrichment") as CategoryRow[];
  const missingCategories = missingDefaultSystemCategories(rows.map((row) => row.name));
  if (missingCategories.length === 0) return rows;

  const insertResult = await client
    .from("categories")
    .upsert(
      missingCategories.map((category) => ({
        color: category.color,
        icon: category.icon,
        is_system: true,
        name: category.name,
        parent_id: null,
        user_id: userId
      })),
      { ignoreDuplicates: true, onConflict: "user_id,name" }
    )
    .select("id,user_id,parent_id,name,color,icon,is_system,created_at,updated_at");
  const insertedRows = expectData(insertResult, "Insert default Plaid enrichment categories") as CategoryRow[];

  return [...rows, ...insertedRows];
}

function toCategoryRecordForAi(row: CategoryRow): CategoryRecord {
  return {
    color: row.color,
    icon: row.icon,
    id: row.id,
    isSystem: row.is_system,
    name: row.name,
    parentId: row.parent_id,
    userId: row.user_id
  };
}

function buildEnrichedTransactionInsert({
  categoryByName,
  merchantRules,
  raw,
  transaction,
  userId
}: {
  categoryByName: Map<string, CategoryRow>;
  merchantRules: readonly MerchantRuleRow[];
  raw: RawTransactionRow;
  transaction: Transaction | undefined;
  userId: string;
}): EnrichedTransactionInsert {
  const categoryName = transaction ? getDefaultCategoryName(transaction) : raw.plaid_category ?? "Uncategorized";
  const categoryRows = [...categoryByName.values()];
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
  const matchedCategory = categoryByName.get(categoryName.toLowerCase()) ??
    categoryByName.get(displayCategoryName(categoryName).toLowerCase()) ??
    null;
  const matchedRule = findMatchingMerchantRule(merchantRules, raw);
  const ruleEnrichment = matchedRule
    ? buildRuleAppliedEnrichment(matchedRule, raw, categoryById)
    : null;

  return {
    account_id: raw.account_id,
    amount: raw.amount,
    category_id: ruleEnrichment?.categoryId ?? matchedCategory?.id ?? null,
    category_name: ruleEnrichment?.categoryName ?? matchedCategory?.name ?? categoryName,
    confidence: ruleEnrichment?.confidence ?? (transaction ? getDefaultConfidence(transaction) : 0.95),
    date: raw.date,
    intent: ruleEnrichment?.intent ?? (transaction ? getDefaultIntent(transaction) : "personal"),
    is_recurring: ruleEnrichment?.isRecurring ?? false,
    merchant_name: ruleEnrichment?.merchantName ?? (
      transaction ? getMerchantName(transaction) : cleanRequiredText(raw.merchant_name ?? raw.name, "Plaid transaction")
    ),
    note: ruleEnrichment?.note ?? "",
    raw_transaction_id: raw.id,
    source: ruleEnrichment?.source ?? "plaid",
    status: raw.status,
    user_id: userId
  };
}

export function shouldRefreshImportedEnrichment(existing: Pick<EnrichedTransactionRow, "reviewed_at" | "source">) {
  return (existing.source === "plaid" || existing.source === "rule") && !existing.reviewed_at;
}

async function seedEnrichedTransactions({
  client,
  rawRows,
  transactionByPlaidId,
  userId
}: {
  client: FinanceSupabaseClient;
  rawRows: RawTransactionRow[];
  transactionByPlaidId: Map<string, Transaction>;
  userId: string;
}) {
  if (rawRows.length === 0) {
    return {
      enrichedTransactionsInserted: 0,
      enrichedTransactionsUpdated: 0
    };
  }

  const rawIds = rawRows.map((row) => row.id);
  const [existingResult, categoryRows, merchantRulesResult] = await Promise.all([
    client
      .from("enriched_transactions")
      .select("*")
      .eq("user_id", userId)
      .in("raw_transaction_id", rawIds),
    loadCategoryRows(client, userId),
    client
      .from("merchant_rules")
      .select("*")
      .eq("user_id", userId)
      .eq("enabled", true)
      .order("priority")
  ]);
  const existingRows = expectData(existingResult, "Load Plaid enriched transactions") as EnrichedTransactionRow[];
  const merchantRules = expectData(merchantRulesResult, "Load merchant rules for Plaid enrichment") as MerchantRuleRow[];
  const existingByRawId = new Map(existingRows.map((row) => [row.raw_transaction_id, row]));
  const categoryByName = new Map(categoryRows.map((row) => [row.name.toLowerCase(), row]));
  const inserts: EnrichedTransactionInsert[] = [];
  const updates: EnrichedTransactionInsert[] = [];
  const changedRows: EnrichedTransactionRow[] = [];

  for (const raw of rawRows) {
    const existing = existingByRawId.get(raw.id);
    const seed = buildEnrichedTransactionInsert({
      categoryByName,
      merchantRules,
      raw,
      transaction: transactionByPlaidId.get(raw.plaid_transaction_id),
      userId
    });

    if (!existing) {
      inserts.push(seed);
    } else if (shouldRefreshImportedEnrichment(existing)) {
      updates.push(seed);
    }
  }

  for (const batch of chunk([...inserts, ...updates], UPSERT_CHUNK_SIZE)) {
    const result = await client
      .from("enriched_transactions")
      .upsert(batch, { onConflict: "user_id,raw_transaction_id" })
      .select("*");

    changedRows.push(...expectData(result, "Seed Plaid enriched transactions") as unknown as EnrichedTransactionRow[]);
  }

  await insertGeneratedReviewItems(client, changedRows, {
    categoryRows,
    merchantRules,
    rawRows
  });

  return {
    enrichedTransactionsInserted: inserts.length,
    enrichedTransactionsUpdated: updates.length
  };
}

function applyReviewSuggestionUpdates(
  reviewItems: ReviewItemInsert[],
  updates: Awaited<ReturnType<typeof attachAiSuggestionsToReviewItems<ReviewItemInsert>>>
) {
  if (updates.length === 0) return reviewItems;

  const suggestionByKey = new Map(updates.map(({ item }) => [
    `${item.enriched_transaction_id}:${item.reason}`,
    item
  ]));

  return reviewItems.map((item) => {
    const suggested = suggestionByKey.get(`${item.enriched_transaction_id}:${item.reason}`);
    return suggested ?? item;
  });
}

async function insertGeneratedReviewItems(
  client: FinanceSupabaseClient,
  transactions: EnrichedTransactionRow[],
  context: {
    categoryRows: CategoryRow[];
    merchantRules: MerchantRuleRow[];
    rawRows: RawTransactionRow[];
  }
) {
  const reviewItems: ReviewItemInsert[] = transactions.flatMap(buildTransactionReviewItems);
  const aiUpdates = await attachAiSuggestionsToReviewItems(reviewItems, {
    categories: context.categoryRows.map(toCategoryRecordForAi),
    maxSuggestions: PLAID_IMPORT_AI_REVIEW_SUGGESTION_LIMIT,
    merchantRules: context.merchantRules,
    rawRows: context.rawRows,
    suggestionService: createAutoReviewTransactionSuggestionService(),
    transactions
  });
  const reviewItemsWithSuggestions = applyReviewSuggestionUpdates(reviewItems, aiUpdates);
  const autoAppliedKeys = await autoApplyReviewSuggestions(client, reviewItemsWithSuggestions, transactions, context);
  const openReviewItems = reviewItemsWithSuggestions.filter((item) => {
    const key = reviewItemKey(item);
    return !key || !autoAppliedKeys.has(key);
  });

  for (const batch of chunk(openReviewItems, UPSERT_CHUNK_SIZE)) {
    if (batch.length === 0) continue;

    const result = await client
      .from("review_items")
      .upsert(batch, {
        ignoreDuplicates: true,
        onConflict: "user_id,enriched_transaction_id,reason"
      })
      .select("id");

    expectData(result, "Insert generated Plaid review items");
  }

  const refreshes = aiUpdates
    .filter((update) => {
      const item = update.item;
      if (!item.enriched_transaction_id || !item.reason) return false;
      const key = reviewItemKey(item);
      return !(key && autoAppliedKeys.has(key));
    })
    .map(async (update) => {
      const item = update.item;
      const result = await client
        .from("review_items")
        .update({
          ai_suggestion: item.ai_suggestion,
          confidence: item.confidence ?? null
        })
        .eq("user_id", item.user_id)
        .eq("enriched_transaction_id", item.enriched_transaction_id!)
        .eq("reason", item.reason!)
        .eq("status", "open")
        .select("id");
      expectData(result, "Refresh generated Plaid review AI suggestions");
    });

  await Promise.all(refreshes);
}

function reviewItemKey(item: Pick<ReviewItemInsert, "enriched_transaction_id" | "reason">) {
  return item.enriched_transaction_id && item.reason
    ? `${item.enriched_transaction_id}:${item.reason}`
    : null;
}

function enrichedUpdateFromPatch(patch: TransactionEnrichmentPatch): EnrichedTransactionUpdate {
  const update: EnrichedTransactionUpdate = {};

  if (patch.merchantName !== undefined) update.merchant_name = patch.merchantName;
  if (patch.categoryId !== undefined) update.category_id = patch.categoryId;
  if (patch.categoryName !== undefined) update.category_name = patch.categoryName;
  if (patch.intent !== undefined) update.intent = patch.intent;
  if (patch.note !== undefined) update.note = patch.note;
  if (patch.isRecurring !== undefined) update.is_recurring = patch.isRecurring;
  if (patch.confidence !== undefined) update.confidence = patch.confidence;
  if (patch.reviewedAt !== undefined) update.reviewed_at = patch.reviewedAt;
  if (patch.source !== undefined) update.source = patch.source;

  return update;
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

async function recordAutoCategorizationAuditEvent(
  client: FinanceSupabaseClient,
  plan: {
    decision: ReturnType<typeof evaluateAutoCategorization> & { patch: TransactionEnrichmentPatch };
    items: ReviewItemInsert[];
    transaction: EnrichedTransactionRow;
  }
) {
  const result = await client
    .from("audit_events")
    .insert({
      action: "review.suggestion_auto_applied",
      actor_id: null,
      after_data: toJson({
        appliedPatch: plan.decision.patch,
        suggestion: plan.items[0]?.ai_suggestion ?? {}
      }),
      before_data: toJson({
        categoryId: plan.transaction.category_id,
        categoryName: plan.transaction.category_name,
        confidence: plan.transaction.confidence,
        intent: plan.transaction.intent,
        merchantName: plan.transaction.merchant_name,
        reviewedAt: plan.transaction.reviewed_at,
        source: plan.transaction.source
      }),
      entity_id: plan.transaction.id,
      entity_table: "enriched_transactions",
      metadata: toJson({
        reason: plan.decision.reason,
        reviewItemIds: plan.items.map((item) => item.id).filter(Boolean),
        reviewReasons: plan.items.map((item) => item.reason).filter(Boolean),
        transactionId: plan.transaction.id
      }),
      user_id: plan.transaction.user_id
    })
    .select("id");

  expectData(result, "Record auto-applied AI categorization audit event");
}

async function autoApplyReviewSuggestions(
  client: FinanceSupabaseClient,
  reviewItems: ReviewItemInsert[],
  transactions: EnrichedTransactionRow[],
  context: {
    categoryRows: CategoryRow[];
    rawRows: RawTransactionRow[];
  }
) {
  const categories = context.categoryRows.map(toCategoryRecordForAi);
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const rawById = new Map(context.rawRows.map((raw) => [raw.id, raw]));
  const reviewedAt = new Date().toISOString();
  const plans = new Map<string, {
    decision: ReturnType<typeof evaluateAutoCategorization> & { patch: TransactionEnrichmentPatch };
    items: ReviewItemInsert[];
    transaction: EnrichedTransactionRow;
  }>();

  for (const item of reviewItems) {
    const key = reviewItemKey(item);
    const transaction = item.enriched_transaction_id ? transactionById.get(item.enriched_transaction_id) : null;
    const raw = transaction ? rawById.get(transaction.raw_transaction_id) ?? null : null;
    if (!key || !transaction || !item.reason) continue;

    const decision = evaluateAutoCategorization({
      categories,
      rawTransaction: raw,
      reviewReason: item.reason,
      reviewedAt,
      suggestion: item.ai_suggestion ?? {},
      transaction
    });
    if (!decision.shouldApply || !decision.patch) continue;

    const existing = plans.get(transaction.id);
    if (existing) {
      existing.items.push(item);
    } else {
      plans.set(transaction.id, {
        decision: decision as typeof decision & { patch: TransactionEnrichmentPatch },
        items: [item],
        transaction
      });
    }
  }

  const autoAppliedKeys = new Set<string>();
  const resolvedReviewItems: ReviewItemInsert[] = [];

  for (const plan of plans.values()) {
    const result = await client
      .from("enriched_transactions")
      .update(enrichedUpdateFromPatch(plan.decision.patch))
      .eq("user_id", plan.transaction.user_id)
      .eq("id", plan.transaction.id)
      .select("id");

    expectData(result, "Auto-apply high-confidence AI categorization");
    await recordAutoCategorizationAuditEvent(client, plan);

    for (const item of plan.items) {
      const key = reviewItemKey(item);
      if (key) autoAppliedKeys.add(key);

      resolvedReviewItems.push({
        ...item,
        confidence: plan.decision.suggestion.confidence ?? item.confidence ?? null,
        resolution_note: "Auto-applied high-confidence non-manual categorization.",
        resolved_at: reviewedAt,
        status: "resolved"
      });
    }
  }

  for (const batch of chunk(resolvedReviewItems, UPSERT_CHUNK_SIZE)) {
    if (batch.length === 0) continue;

    const result = await client
      .from("review_items")
      .upsert(batch, {
        onConflict: "user_id,enriched_transaction_id,reason"
      })
      .select("id");

    expectData(result, "Store auto-resolved Plaid review items");
  }

  return autoAppliedKeys;
}

async function persistTransactionUpdates({
  accountByPlaidId,
  client,
  item,
  transactions,
  userId
}: {
  accountByPlaidId: Map<string, AccountRow>;
  client: FinanceSupabaseClient;
  item: PlaidItemRow;
  transactions: {
    added: Transaction[];
    modified: Transaction[];
    removed: RemovedTransaction[];
  };
  userId: string;
}) {
  const changedTransactions = dedupeTransactions([...transactions.added, ...transactions.modified]);
  const rawResult = await upsertRawTransactions({
    accountByPlaidId,
    client,
    item,
    transactions: changedTransactions,
    userId
  });
  const enrichedResult = await seedEnrichedTransactions({
    client,
    rawRows: rawResult.rawRows,
    transactionByPlaidId: rawResult.transactionByPlaidId,
    userId
  });
  const removedCount = await deleteRemovedTransactions({
    client,
    item,
    preservedPendingTransactionIds: rawResult.replacedPendingPlaidTransactionIds,
    removed: transactions.removed,
    userId
  });

  return {
    ...rawResult,
    ...enrichedResult,
    transactionsRemoved: removedCount
  };
}

async function loadPlaidItemForSync(
  client: FinanceSupabaseClient,
  userId: string,
  itemId: string
) {
  const result = await client
    .from("plaid_items")
    .select(PLAID_ITEM_SYNC_COLUMNS)
    .eq("user_id", userId)
    .eq("id", itemId)
    .maybeSingle();

  if (result.error) throw new Error(`Load Plaid item for sync: ${result.error.message}`);
  if (!result.data) throw new Error("Plaid item was not found.");

  const item = result.data as unknown as PlaidItemRow;
  if (item.status === "revoked") {
    throw new Error("Plaid item has been revoked.");
  }

  return item;
}

async function listPlaidItemsForSync(client: FinanceSupabaseClient, userId: string) {
  const result = await client
    .from("plaid_items")
    .select(PLAID_ITEM_SYNC_COLUMNS)
    .eq("user_id", userId)
    .neq("status", "revoked");

  return expectData(result, "List Plaid items for sync") as unknown as PlaidItemRow[];
}

async function updatePlaidItemSyncSuccess(
  client: FinanceSupabaseClient,
  userId: string,
  item: PlaidItemRow,
  syncedAt: string,
  cursor: string | null,
  warning: { error_code: string; error_message: string } | null = null
) {
  const update: PlaidItemUpdate = {
    error_code: warning?.error_code ?? null,
    error_message: warning?.error_message ?? null,
    last_successful_sync_at: syncedAt,
    status: "active",
    transaction_cursor: cursor
  };
  const result = await client
    .from("plaid_items")
    .update(update)
    .eq("user_id", userId)
    .eq("id", item.id)
    .select(PLAID_ITEM_SYNC_COLUMNS)
    .single();

  return expectData(result, "Persist Plaid sync success") as unknown as PlaidItemRow;
}

async function updatePlaidItemSyncError(
  client: FinanceSupabaseClient,
  userId: string,
  itemId: string,
  error: unknown
) {
  const syncError = persistedSyncError(error);
  if (isPlaidServerConfigurationErrorCode(syncError.error_code)) return;

  const update: PlaidItemUpdate = {
    ...syncError,
    status: "error"
  };
  const result = await client
    .from("plaid_items")
    .update(update)
    .eq("user_id", userId)
    .eq("id", itemId);

  if (result.error) {
    console.error("plaid_sync_error_state_update_failed", { code: result.error.code });
  }
}

function itemSummaryCounts(item: PlaidSyncItemSummary) {
  return {
    accounts_upserted: item.accountsUpserted,
    balance_snapshots_upserted: item.balanceSnapshotsUpserted,
    enriched_transactions_inserted: item.enrichedTransactionsInserted,
    enriched_transactions_updated: item.enrichedTransactionsUpdated,
    raw_transactions_skipped: item.rawTransactionsSkipped,
    raw_transactions_upserted: item.rawTransactionsUpserted,
    transactions_removed: item.transactionsRemoved
  };
}

function syncItemSafeCode(summary: PlaidSyncItemSummary) {
  return summary.errorCode ?? summary.warningCode ?? null;
}

function syncItemSafeMessage(summary: PlaidSyncItemSummary) {
  return summary.errorMessage ?? summary.warningMessage ?? null;
}

function toRunStatus(summary: Pick<PlaidSyncRunSummary, "failed" | "succeeded" | "totalItems">): Exclude<PlaidSyncRunStatus, "running"> {
  if (summary.failed === 0) return "succeeded";
  if (summary.succeeded > 0) return "partial";
  return summary.totalItems > 0 ? "failed" : "succeeded";
}

function safeSyncRunMessage(summary: Pick<PlaidSyncRunSummary, "failed" | "succeeded" | "totalItems">) {
  if (summary.failed === 0) return null;
  return `${summary.failed} of ${summary.totalItems} Plaid items failed during sync.`;
}

async function createPlaidSyncRun(
  client: FinanceSupabaseClient,
  userId: string,
  source: PlaidSyncRunSource,
  totalItems: number
) {
  const startedAt = new Date().toISOString();
  const insert: PlaidSyncRunInsert = {
    source,
    started_at: startedAt,
    status: "running",
    total_items: totalItems,
    user_id: userId
  };
  const result = await client
    .from("plaid_sync_runs")
    .insert(insert)
    .select(PLAID_SYNC_RUN_COLUMNS)
    .single();

  return expectData(result, "Create Plaid sync run") as unknown as PlaidSyncRunRow;
}

async function getLatestRunningPlaidSyncRun(
  client: FinanceSupabaseClient,
  userId: string
) {
  const result = await client
    .from("plaid_sync_runs")
    .select(PLAID_SYNC_RUN_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) throw new Error(`Load running Plaid sync run: ${result.error.message}`);
  return (result.data ?? null) as unknown as PlaidSyncRunRow | null;
}

async function persistPlaidSyncRunItem({
  client,
  item,
  run,
  startedAt,
  summary,
  userId
}: {
  client: FinanceSupabaseClient;
  item: PlaidItemRow;
  run: PlaidSyncRunRow;
  startedAt: string;
  summary: PlaidSyncItemSummary;
  userId: string;
}) {
  const insert: PlaidSyncRunItemInsert = {
    ...itemSummaryCounts(summary),
    completed_at: new Date().toISOString(),
    last_successful_sync_at: summary.lastSuccessfulSyncAt,
    plaid_item_id: item.id,
    safe_error_code: syncItemSafeCode(summary),
    safe_error_message: syncItemSafeMessage(summary),
    started_at: startedAt,
    status: summary.errorCode ? "failed" : "succeeded",
    sync_run_id: run.id,
    user_id: userId
  };
  const result = await client
    .from("plaid_sync_run_items")
    .insert(insert)
    .select(PLAID_SYNC_RUN_ITEM_COLUMNS)
    .single();

  if (result.error) throw new Error(`Persist Plaid sync run item: ${result.error.message}`);
}

async function finalizePlaidSyncRun(
  client: FinanceSupabaseClient,
  run: PlaidSyncRunRow,
  summary: PlaidSyncRunSummary
) {
  const update: PlaidSyncRunUpdate = {
    accounts_upserted: summary.accountsUpserted,
    balance_snapshots_upserted: summary.balanceSnapshotsUpserted,
    completed_at: new Date().toISOString(),
    enriched_transactions_inserted: summary.enrichedTransactionsInserted,
    enriched_transactions_updated: summary.enrichedTransactionsUpdated,
    failed_items: summary.failed,
    raw_transactions_skipped: summary.rawTransactionsSkipped,
    raw_transactions_upserted: summary.rawTransactionsUpserted,
    safe_error_code: summary.failed > 0 ? "PLAID_SYNC_PARTIAL_FAILURE" : null,
    safe_error_message: safeSyncRunMessage(summary),
    status: summary.status,
    succeeded_items: summary.succeeded,
    transactions_removed: summary.transactionsRemoved
  };
  const result = await client
    .from("plaid_sync_runs")
    .update(update)
    .eq("user_id", run.user_id)
    .eq("id", run.id)
    .select(PLAID_SYNC_RUN_COLUMNS)
    .single();

  return expectData(result, "Finalize Plaid sync run") as unknown as PlaidSyncRunRow;
}

async function syncLoadedPlaidItem(
  client: FinanceSupabaseClient,
  userId: string,
  item: PlaidItemRow
): Promise<PlaidSyncItemSummary> {
  const accessToken = decryptPlaidAccessToken(item.access_token_ciphertext);
  const syncedAt = new Date().toISOString();
  const snapshotDate = syncedAt.slice(0, 10);
  const [transactionUpdates, itemAccounts, balanceAccounts] = await Promise.all([
    fetchTransactionSyncUpdatesForImport(accessToken, item.transaction_cursor),
    fetchItemAccounts(accessToken),
    fetchBalanceAccounts(accessToken)
  ]);
  const accounts = mergePlaidAccountSourcesForSync({
    accountsGetAccounts: itemAccounts,
    balanceAccounts,
    transactionSyncAccounts: transactionUpdates.accounts
  });
  const accountResult = await upsertPlaidAccounts({
    accounts,
    client,
    item,
    snapshotDate,
    syncedAt,
    userId
  });
  const transactionResult = await persistTransactionUpdates({
    accountByPlaidId: accountResult.accountByPlaidId,
    client,
    item,
    transactions: transactionUpdates,
    userId
  });
  const productSyncSkipped = transactionUpdates.warning ? 1 : 0;
  const rawTransactionsSkipped = transactionResult.rawTransactionsSkipped + productSyncSkipped;
  const syncedItem = await updatePlaidItemSyncSuccess(
    client,
    userId,
    item,
    syncedAt,
    rawTransactionsSkipped > 0
      ? item.transaction_cursor
      : transactionUpdates.nextCursor || item.transaction_cursor,
    transactionUpdates.warning
  );

  return {
    accountsUpserted: accountResult.accountsUpserted,
    balanceSnapshotsUpserted: accountResult.balanceSnapshotsUpserted,
    enrichedTransactionsInserted: transactionResult.enrichedTransactionsInserted,
    enrichedTransactionsUpdated: transactionResult.enrichedTransactionsUpdated,
    id: item.id,
    lastSuccessfulSyncAt: syncedItem.last_successful_sync_at,
    rawTransactionsSkipped,
    rawTransactionsUpserted: transactionResult.rawTransactionsUpserted,
    transactionsRemoved: transactionResult.transactionsRemoved,
    warningCode: transactionUpdates.warning?.error_code,
    warningMessage: transactionUpdates.warning?.error_message
  };
}

export async function createPlaidLinkToken({
  client,
  itemId,
  userEmail,
  userId
}: {
  client?: FinanceSupabaseClient;
  itemId?: string;
  userEmail: string | null;
  userId: string;
}): Promise<PlaidLinkTokenResult> {
  const config = getPlaidLinkTokenConfig();
  const plaid = getPlaidClient();
  if (itemId && !client) {
    throw new Error("Plaid update mode requires a write client.");
  }

  const item = itemId && client ? await loadPlaidItemForSync(client, userId, itemId) : null;
  const response = await plaid.linkTokenCreate(buildPlaidLinkTokenCreateRequest({
    accessToken: item ? decryptPlaidAccessToken(item.access_token_ciphertext) : undefined,
    redirectUri: config.redirectUri,
    userEmail,
    userId
  }));

  return {
    expiration: response.data.expiration,
    linkToken: response.data.link_token,
    requestId: response.data.request_id
  };
}

export function buildPlaidLinkTokenCreateRequest({
  accessToken,
  redirectUri,
  userEmail,
  userId
}: {
  accessToken?: string;
  redirectUri: string | null;
  userEmail: string | null;
  userId: string;
}): LinkTokenCreateRequest {
  return {
    ...(accessToken
      ? { access_token: accessToken }
      : { products: [Products.Transactions] }),
    client_name: "Tally",
    country_codes: [CountryCode.Us],
    language: "en",
    redirect_uri: redirectUri ?? undefined,
    user: {
      client_user_id: userId,
      email_address: userEmail ?? undefined
    }
  };
}

export async function exchangePlaidPublicToken({
  client,
  institution,
  publicToken,
  userId
}: {
  client: FinanceSupabaseClient;
  institution?: PlaidInstitutionInput;
  publicToken: string;
  userId: string;
}) {
  const plaid = getPlaidClient();
  const exchangeResponse = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = exchangeResponse.data.access_token;
  const itemResponse = await plaid.itemGet({ access_token: accessToken });
  const item = itemResponse.data.item;
  const institutionDetails = await fetchInstitutionDetails(item.institution_id ?? institution?.institutionId ?? null);
  const institutionRow = await upsertInstitution({
    client,
    details: institutionDetails,
    fallback: institution,
    itemInstitutionId: item.institution_id ?? null,
    itemInstitutionName: item.institution_name ?? null,
    userId
  });
  const plaidItem = await upsertPlaidItem({
    accessToken,
    client,
    institutionId: institutionRow.id,
    item: {
      available_products: item.available_products,
      billed_products: item.billed_products,
      consent_expiration_time: item.consent_expiration_time,
      error: item.error
        ? {
          error_code: item.error.error_code,
          error_message: item.error.error_message
        }
        : null,
      item_id: item.item_id
    },
    userId
  });

  return toConnectionSummary(plaidItem, institutionRow);
}

export async function syncPlaidItem({
  client,
  itemId,
  source = "manual",
  throwOnError = true,
  userId
}: {
  client: FinanceSupabaseClient;
  itemId: string;
  source?: PlaidSyncRunSource;
  throwOnError?: boolean;
  userId: string;
}): Promise<PlaidSyncItemSummary> {
  const item = await loadPlaidItemForSync(client, userId, itemId);
  const run = await createPlaidSyncRun(client, userId, source, 1);
  const startedAt = new Date().toISOString();

  let summary: PlaidSyncItemSummary;
  let syncError: unknown;

  try {
    summary = await syncLoadedPlaidItem(client, userId, item);
  } catch (error) {
    syncError = error;
    logPlaidItemSyncFailure(error);
    await updatePlaidItemSyncError(client, userId, item.id, error);
    const persistedError = persistedSyncError(error);
    summary = {
      accountsUpserted: 0,
      balanceSnapshotsUpserted: 0,
      enrichedTransactionsInserted: 0,
      enrichedTransactionsUpdated: 0,
      errorCode: persistedError.error_code,
      errorMessage: persistedError.error_message,
      id: item.id,
      lastSuccessfulSyncAt: item.last_successful_sync_at,
      rawTransactionsSkipped: 0,
      rawTransactionsUpserted: 0,
      transactionsRemoved: 0
    };
  }

  const runSummary = summarizeSyncRun([summary], {
    runId: run.id,
    source,
    startedAt: run.started_at
  });
  await Promise.all([
    persistPlaidSyncRunItem({ client, item, run, startedAt, summary, userId }),
    finalizePlaidSyncRun(client, run, runSummary)
  ]);

  if (syncError && throwOnError) throw syncError;
  return summary;
}

export function summarizeSyncRun(
  items: PlaidSyncItemSummary[],
  run: { runId?: string | null; source?: PlaidSyncRunSource; startedAt?: string } = {}
): PlaidSyncRunSummary {
  const summary = items.reduce<Omit<PlaidSyncRunSummary, "runId" | "source" | "startedAt" | "status">>(
    (summary, item) => {
      summary.accountsUpserted += item.accountsUpserted;
      summary.balanceSnapshotsUpserted += item.balanceSnapshotsUpserted;
      summary.enrichedTransactionsInserted += item.enrichedTransactionsInserted;
      summary.enrichedTransactionsUpdated += item.enrichedTransactionsUpdated;
      summary.failed += item.errorCode ? 1 : 0;
      summary.rawTransactionsSkipped += item.rawTransactionsSkipped;
      summary.rawTransactionsUpserted += item.rawTransactionsUpserted;
      summary.succeeded += item.errorCode ? 0 : 1;
      summary.transactionsRemoved += item.transactionsRemoved;
      return summary;
    },
    {
      accountsUpserted: 0,
      balanceSnapshotsUpserted: 0,
      enrichedTransactionsInserted: 0,
      enrichedTransactionsUpdated: 0,
      failed: 0,
      items,
      rawTransactionsSkipped: 0,
      rawTransactionsUpserted: 0,
      succeeded: 0,
      totalItems: items.length,
      transactionsRemoved: 0
    }
  );

  return {
    ...summary,
    runId: run.runId ?? null,
    source: run.source ?? "manual",
    startedAt: run.startedAt ?? new Date().toISOString(),
    status: toRunStatus(summary)
  };
}

export async function syncPlaidConnections(
  client: FinanceSupabaseClient,
  userId: string,
  source: PlaidSyncRunSource = "manual"
): Promise<PlaidSyncRunSummary> {
  const items = await listPlaidItemsForSync(client, userId);
  return syncLoadedPlaidItems({ client, items, source, userId });
}

async function syncLoadedPlaidItems({
  client,
  items,
  source,
  userId
}: {
  client: FinanceSupabaseClient;
  items: PlaidItemRow[];
  source: PlaidSyncRunSource;
  userId: string;
}) {
  const run = await createPlaidSyncRun(client, userId, source, items.length);
  const results: PlaidSyncItemSummary[] = [];

  for (const item of items) {
    const startedAt = new Date().toISOString();
    let summary: PlaidSyncItemSummary;

    try {
      summary = await syncLoadedPlaidItem(client, userId, item);
    } catch (error) {
      logPlaidItemSyncFailure(error);
      await updatePlaidItemSyncError(client, userId, item.id, error);
      const safeError = persistedSyncError(error);
      summary = {
        accountsUpserted: 0,
        balanceSnapshotsUpserted: 0,
        enrichedTransactionsInserted: 0,
        enrichedTransactionsUpdated: 0,
        errorCode: safeError.error_code,
        errorMessage: safeError.error_message,
        id: item.id,
        lastSuccessfulSyncAt: item.last_successful_sync_at,
        rawTransactionsSkipped: 0,
        rawTransactionsUpserted: 0,
        transactionsRemoved: 0
      };
    }

    results.push(summary);
    await persistPlaidSyncRunItem({ client, item, run, startedAt, summary, userId });
  }

  const summary = summarizeSyncRun(results, {
    runId: run.id,
    source,
    startedAt: run.started_at
  });
  await finalizePlaidSyncRun(client, run, summary);
  return summary;
}

export async function syncOpportunisticPlaidConnections(
  client: FinanceSupabaseClient,
  userId: string,
  now = new Date()
): Promise<PlaidOpportunisticSyncSummary> {
  const checkedAt = now.toISOString();
  const runningRun = await getLatestRunningPlaidSyncRun(client, userId);
  if (isRecentRunningPlaidSync(runningRun, now)) {
    return {
      checkedAt,
      reason: "in_progress",
      sync: null
    };
  }

  const items = await listPlaidItemsForSync(client, userId);
  if (items.length === 0) {
    return {
      checkedAt,
      reason: "no_items",
      sync: null
    };
  }

  const dueItems = items.filter((item) => isPlaidItemDueForOpportunisticSync(item, now));
  if (dueItems.length === 0) {
    return {
      checkedAt,
      reason: "recently_synced",
      sync: null
    };
  }

  const sync = await syncLoadedPlaidItems({
    client,
    items: dueItems,
    source: "opportunistic",
    userId
  });

  return {
    checkedAt,
    reason: "synced",
    sync
  };
}

function toPersistedSyncRunItemSummary(row: PlaidSyncRunItemRow): PlaidSyncRunItemStatusSummary {
  return {
    accountsUpserted: row.accounts_upserted,
    balanceSnapshotsUpserted: row.balance_snapshots_upserted,
    completedAt: row.completed_at,
    enrichedTransactionsInserted: row.enriched_transactions_inserted,
    enrichedTransactionsUpdated: row.enriched_transactions_updated,
    errorCode: row.status === "failed" ? row.safe_error_code ?? undefined : undefined,
    errorMessage: row.status === "failed" ? row.safe_error_message ?? undefined : undefined,
    id: row.plaid_item_id,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    rawTransactionsSkipped: row.raw_transactions_skipped,
    rawTransactionsUpserted: row.raw_transactions_upserted,
    status: row.status,
    transactionsRemoved: row.transactions_removed,
    warningCode: row.status === "succeeded" ? row.safe_error_code ?? undefined : undefined,
    warningMessage: row.status === "succeeded" ? row.safe_error_message ?? undefined : undefined
  };
}

function toPersistedSyncRunSummary(
  run: PlaidSyncRunRow,
  items: PlaidSyncRunItemRow[]
): PlaidPersistedSyncRunSummary {
  return {
    accountsUpserted: run.accounts_upserted,
    balanceSnapshotsUpserted: run.balance_snapshots_upserted,
    completedAt: run.completed_at,
    enrichedTransactionsInserted: run.enriched_transactions_inserted,
    enrichedTransactionsUpdated: run.enriched_transactions_updated,
    errorCode: run.safe_error_code,
    errorMessage: run.safe_error_message,
    failed: run.failed_items,
    items: items.map(toPersistedSyncRunItemSummary),
    rawTransactionsSkipped: run.raw_transactions_skipped,
    rawTransactionsUpserted: run.raw_transactions_upserted,
    runId: run.id,
    source: run.source,
    startedAt: run.started_at,
    status: run.status === "running" ? "failed" : run.status,
    succeeded: run.succeeded_items,
    totalItems: run.total_items,
    transactionsRemoved: run.transactions_removed
  };
}

async function listUsersWithSyncablePlaidItems(client: FinanceSupabaseClient) {
  const result = await client
    .from("plaid_items")
    .select("user_id")
    .eq("auto_sync_enabled", true)
    .neq("status", "revoked");
  const rows = expectData(result, "List users with syncable Plaid items") as unknown as Array<{ user_id: string }>;
  return [...new Set(rows.map((row) => row.user_id))];
}

async function listPlaidItemsForScheduledSync(client: FinanceSupabaseClient, userId: string) {
  const result = await client
    .from("plaid_items")
    .select(PLAID_ITEM_SYNC_COLUMNS)
    .eq("user_id", userId)
    .eq("auto_sync_enabled", true)
    .neq("status", "revoked");
  return expectData(result, "List Plaid items for scheduled sync") as unknown as PlaidItemRow[];
}

export async function syncScheduledPlaidConnections(client: FinanceSupabaseClient): Promise<PlaidScheduledSyncSummary> {
  const userIds = await listUsersWithSyncablePlaidItems(client);
  const runs: PlaidSyncRunSummary[] = [];
  let failedUsers = 0;

  const snapshotDate = new Date().toISOString().slice(0, 10);

  for (const userId of userIds) {
    try {
      const items = await listPlaidItemsForScheduledSync(client, userId);
      if (items.length === 0) continue;
      runs.push(await syncLoadedPlaidItems({ client, items, source: "scheduled", userId }));
    } catch (error) {
      failedUsers += 1;
      console.error("scheduled_plaid_sync_user_failed", getSafePlaidError(error));
    }

    try {
      await recordManualInvestmentSnapshots(client as unknown as Parameters<typeof recordManualInvestmentSnapshots>[0], userId, snapshotDate);
    } catch (error) {
      console.error("scheduled_manual_investment_snapshot_failed", getSafePlaidError(error));
    }
  }

  return {
    failedUsers,
    runs,
    succeededUsers: runs.length,
    totalUsers: userIds.length
  };
}

async function loadPlaidItemForRevoke(
  client: FinanceSupabaseClient,
  userId: string,
  itemId: string
) {
  const result = await client
    .from("plaid_items")
    .select(PLAID_ITEM_SYNC_COLUMNS)
    .eq("user_id", userId)
    .eq("id", itemId)
    .maybeSingle();

  if (result.error) throw new Error(`Load Plaid item for disconnect: ${result.error.message}`);
  if (!result.data) throw new Error("Plaid item was not found.");

  return result.data as unknown as PlaidItemRow;
}

async function loadIdRows(
  client: FinanceSupabaseClient,
  table: string,
  userId: string,
  column: string,
  values: readonly string[],
  context: string,
  options: { optional?: boolean } = {}
) {
  const ids: string[] = [];

  for (const batch of chunk([...new Set(values)], UPSERT_CHUNK_SIZE)) {
    if (batch.length === 0) continue;

    const result = await client
      .from(table)
      .select("id")
      .eq("user_id", userId)
      .in(column, batch);
    const rows = (options.optional ? expectOptionalData(result, context) : expectData(result, context)) as Array<{ id: string }> | null;
    if (!rows) continue;
    ids.push(...rows.map((row) => row.id));
  }

  return ids;
}

async function deleteRowsByIds(
  client: FinanceSupabaseClient,
  table: string,
  userId: string,
  ids: readonly string[],
  context: string,
  options: { optional?: boolean } = {}
) {
  let deleted = 0;

  for (const batch of chunk([...new Set(ids)], UPSERT_CHUNK_SIZE)) {
    if (batch.length === 0) continue;

    const result = await client
      .from(table)
      .delete()
      .eq("user_id", userId)
      .in("id", batch)
      .select("id");
    const rows = (options.optional ? expectOptionalData(result, context) : expectData(result, context)) as Array<{ id: string }> | null;
    if (!rows) continue;
    deleted += rows.length;
  }

  return deleted;
}

async function deleteRowsByTargets(
  client: FinanceSupabaseClient,
  table: string,
  userId: string,
  targets: Array<{ column: string; eq?: Record<string, unknown>; ids: readonly string[] }>,
  context: string,
  options: { optional?: boolean } = {}
) {
  const deletedIds = new Set<string>();

  for (const target of targets) {
    for (const batch of chunk([...new Set(target.ids)], UPSERT_CHUNK_SIZE)) {
      if (batch.length === 0) continue;

      let query = client
        .from(table)
        .delete()
        .eq("user_id", userId);

      for (const [column, value] of Object.entries(target.eq ?? {})) {
        query = query.eq(column, value);
      }

      const result = await query
        .in(target.column, batch)
        .select("id");
      const rows = (options.optional ? expectOptionalData(result, context) : expectData(result, context)) as Array<{ id: string }> | null;
      if (!rows) continue;
      rows.forEach((row) => deletedIds.add(row.id));
    }
  }

  return deletedIds.size;
}

async function loadAgentProposalIdsForTargets(
  client: FinanceSupabaseClient,
  userId: string,
  targets: Array<{ kind: string; ids: readonly string[] }>
) {
  const proposalIds: string[] = [];

  for (const target of targets) {
    for (const batch of chunk([...new Set(target.ids)], UPSERT_CHUNK_SIZE)) {
      if (batch.length === 0) continue;

      const result = await client
        .from("agent_proposals")
        .select("id")
        .eq("user_id", userId)
        .eq("target_kind", target.kind)
        .in("target_id", batch);
      const rows = expectOptionalData(result, "Load Plaid item agent proposal references") as Array<{ id: string }> | null;
      if (!rows) continue;
      proposalIds.push(...rows.map((row) => row.id));
    }
  }

  return proposalIds;
}

export async function deletePlaidItemLedgerData({
  client,
  itemId,
  userId
}: {
  client: FinanceSupabaseClient;
  itemId: string;
  userId: string;
}): Promise<PlaidItemLedgerDataPurgeSummary> {
  const accountResult = await client
    .from("accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("plaid_item_id", itemId);
  const accountIds = (expectData(accountResult, "Load Plaid item accounts for purge") as Array<{ id: string }>)
    .map((row) => row.id);
  const rawResult = await client
    .from("raw_transactions")
    .select("id")
    .eq("user_id", userId)
    .eq("plaid_item_id", itemId);
  const rawTransactionIds = (expectData(rawResult, "Load Plaid item raw transactions for purge") as Array<{ id: string }>)
    .map((row) => row.id);
  const enrichedTransactionIds = await loadIdRows(
    client,
    "enriched_transactions",
    userId,
    "account_id",
    accountIds,
    "Load Plaid item enriched transactions for purge"
  );
  const reviewItemIds = await loadIdRows(
    client,
    "review_items",
    userId,
    "enriched_transaction_id",
    enrichedTransactionIds,
    "Load Plaid item review items for purge",
    { optional: true }
  );
  const splitIds = await loadIdRows(
    client,
    "transaction_splits",
    userId,
    "enriched_transaction_id",
    enrichedTransactionIds,
    "Load Plaid item transaction splits for purge",
    { optional: true }
  );
  const recurringIds = [
    ...await loadIdRows(
      client,
      "recurring_expenses",
      userId,
      "account_id",
      accountIds,
      "Load Plaid item recurring account references for purge",
      { optional: true }
    ),
    ...await loadIdRows(
      client,
      "recurring_expenses",
      userId,
      "last_transaction_id",
      enrichedTransactionIds,
      "Load Plaid item recurring transaction references for purge",
      { optional: true }
    )
  ];
  const reimbursementIds = [
    ...await loadIdRows(
      client,
      "reimbursement_records",
      userId,
      "enriched_transaction_id",
      enrichedTransactionIds,
      "Load Plaid item reimbursement transaction references for purge",
      { optional: true }
    ),
    ...await loadIdRows(
      client,
      "reimbursement_records",
      userId,
      "received_transaction_id",
      enrichedTransactionIds,
      "Load Plaid item reimbursement received references for purge",
      { optional: true }
    ),
    ...await loadIdRows(
      client,
      "reimbursement_records",
      userId,
      "split_id",
      splitIds,
      "Load Plaid item reimbursement split references for purge",
      { optional: true }
    )
  ];
  const agentProposalIds = await loadAgentProposalIdsForTargets(client, userId, [
    { ids: enrichedTransactionIds, kind: "enriched_transaction" },
    { ids: reviewItemIds, kind: "review_item" },
    { ids: [...new Set(reimbursementIds)], kind: "reimbursement_record" },
    { ids: [...new Set(recurringIds)], kind: "recurring_expense" }
  ]);
  const plaidSyncRunItemIds = await loadIdRows(
    client,
    "plaid_sync_run_items",
    userId,
    "plaid_item_id",
    [itemId],
    "Load Plaid item sync run items for purge",
    { optional: true }
  );

  const agentProposalsDeleted = await deleteRowsByIds(
    client,
    "agent_proposals",
    userId,
    agentProposalIds,
    "Delete Plaid item agent proposals",
    { optional: true }
  );
  const auditEventsDeleted = await deleteRowsByTargets(client, "audit_events", userId, [
    { column: "entity_id", eq: { entity_table: "accounts" }, ids: accountIds },
    { column: "entity_id", eq: { entity_table: "raw_transactions" }, ids: rawTransactionIds },
    { column: "entity_id", eq: { entity_table: "enriched_transactions" }, ids: enrichedTransactionIds },
    { column: "entity_id", eq: { entity_table: "review_items" }, ids: reviewItemIds },
    { column: "entity_id", eq: { entity_table: "transaction_splits" }, ids: splitIds },
    { column: "entity_id", eq: { entity_table: "reimbursement_records" }, ids: [...new Set(reimbursementIds)] },
    { column: "entity_id", eq: { entity_table: "recurring_expenses" }, ids: [...new Set(recurringIds)] },
    { column: "entity_id", eq: { entity_table: "agent_proposals" }, ids: agentProposalIds },
    { column: "entity_id", eq: { entity_table: "plaid_items" }, ids: [itemId] },
    { column: "entity_id", eq: { entity_table: "plaid_sync_run_items" }, ids: plaidSyncRunItemIds }
  ], "Delete Plaid item audit events", { optional: true });
  const reimbursementRecordsDeleted = await deleteRowsByIds(
    client,
    "reimbursement_records",
    userId,
    reimbursementIds,
    "Delete Plaid item reimbursement records",
    { optional: true }
  );
  const recurringExpensesDeleted = await deleteRowsByIds(
    client,
    "recurring_expenses",
    userId,
    recurringIds,
    "Delete Plaid item recurring expenses",
    { optional: true }
  );
  const reviewItemsDeleted = await deleteRowsByIds(
    client,
    "review_items",
    userId,
    reviewItemIds,
    "Delete Plaid item review items",
    { optional: true }
  );
  const transactionSplitsDeleted = await deleteRowsByIds(
    client,
    "transaction_splits",
    userId,
    splitIds,
    "Delete Plaid item transaction splits",
    { optional: true }
  );
  const enrichedTransactionsDeleted = await deleteRowsByIds(
    client,
    "enriched_transactions",
    userId,
    enrichedTransactionIds,
    "Delete Plaid item enriched transactions"
  );
  const rawTransactionsDeleted = await deleteRowsByIds(
    client,
    "raw_transactions",
    userId,
    rawTransactionIds,
    "Delete Plaid item raw transactions"
  );
  const balanceSnapshotsDeleted = await deleteRowsByTargets(
    client,
    "balance_snapshots",
    userId,
    [{ column: "account_id", ids: accountIds }],
    "Delete Plaid item balance snapshots"
  );
  const accountsDeleted = await deleteRowsByIds(
    client,
    "accounts",
    userId,
    accountIds,
    "Delete Plaid item accounts"
  );
  const plaidSyncRunItemsDeleted = await deleteRowsByIds(
    client,
    "plaid_sync_run_items",
    userId,
    plaidSyncRunItemIds,
    "Delete Plaid item sync run items",
    { optional: true }
  );

  return {
    accountsDeleted,
    agentProposalsDeleted,
    auditEventsDeleted,
    balanceSnapshotsDeleted,
    enrichedTransactionsDeleted,
    plaidSyncRunItemsDeleted,
    rawTransactionsDeleted,
    recurringExpensesDeleted,
    reimbursementRecordsDeleted,
    reviewItemsDeleted,
    transactionSplitsDeleted
  };
}

async function updatePlaidItemRevoked(
  client: FinanceSupabaseClient,
  userId: string,
  itemId: string
) {
  const update: PlaidItemUpdate = {
    access_token_ciphertext: encryptPlaidAccessToken(`revoked:${new Date().toISOString()}`),
    error_code: null,
    error_message: null,
    status: "revoked",
    transaction_cursor: null
  };
  const result = await client
    .from("plaid_items")
    .update(update)
    .eq("user_id", userId)
    .eq("id", itemId)
    .select(PLAID_ITEM_COLUMNS)
    .single();

  return expectData(result, "Mark Plaid item revoked") as unknown as PlaidItemPublicRow;
}

export async function setPlaidAutoSyncForUser(
  client: FinanceSupabaseClient,
  userId: string,
  autoSyncEnabled: boolean
) {
  const update: PlaidItemUpdate = { auto_sync_enabled: autoSyncEnabled };
  const result = await client
    .from("plaid_items")
    .update(update)
    .eq("user_id", userId)
    .neq("status", "revoked");

  if (result.error) throw new Error(`Update Plaid auto-sync preference: ${result.error.message}`);
}

type PlaidItemRemoveClient = Pick<ReturnType<typeof getPlaidClient>, "itemRemove">;

async function removePlaidItemAtProvider(item: PlaidItemRow, plaid: PlaidItemRemoveClient) {
  const accessToken = decryptPlaidAccessToken(item.access_token_ciphertext);

  try {
    await plaid.itemRemove({
      access_token: accessToken,
      reason_code: ItemRemoveReasonCode.Other,
      reason_note: "User disconnected this item from the budgeting app."
    });
  } catch (error) {
    const safe = getSafePlaidError(error);
    if (TERMINAL_ITEM_REMOVE_ERROR_CODES.has(safe.code)) {
      console.warn("plaid_connection_item_remove_already_unavailable", safe);
      return;
    }

    throw error;
  }
}

async function loadInstitutionForPlaidItem(
  client: FinanceSupabaseClient,
  userId: string,
  institutionId: string
) {
  const result = await client
    .from("institutions")
    .select(INSTITUTION_COLUMNS)
    .eq("user_id", userId)
    .eq("id", institutionId)
    .maybeSingle();

  if (result.error) throw new Error(`Load Plaid institution: ${result.error.message}`);

  return result.data as InstitutionRow | null;
}

export async function revokePlaidConnection({
  client,
  itemId,
  plaidClient,
  userId
}: {
  client: FinanceSupabaseClient;
  itemId: string;
  plaidClient?: PlaidItemRemoveClient;
  userId: string;
}) {
  const item = await loadPlaidItemForRevoke(client, userId, itemId);

  if (item.status !== "revoked") {
    try {
      await removePlaidItemAtProvider(item, plaidClient ?? getPlaidClient());
    } catch (error) {
      if (!(error instanceof PlaidTokenDecryptionError)) {
        throw error;
      }

      console.warn("plaid_connection_marked_revoked_without_provider_remove", getSafePlaidError(error));
    }
  }

  const revokedItem = await updatePlaidItemRevoked(client, userId, item.id);
  const institution = await loadInstitutionForPlaidItem(client, userId, revokedItem.institution_id);

  return toConnectionSummary(revokedItem, institution ?? undefined);
}

export async function listPlaidConnections(client: FinanceSupabaseClient, userId: string) {
  const itemResult = await client
    .from("plaid_items")
    .select(PLAID_ITEM_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (itemResult.error || !itemResult.data) {
    throw new Error(`List Plaid items: ${itemResult.error?.message ?? "No data returned."}`);
  }

  const itemRows = itemResult.data as unknown as PlaidItemPublicRow[];

  if (itemRows.length === 0) return [];

  const institutionIds = [...new Set(itemRows.map((item) => item.institution_id))];
  const institutionResult = await client
    .from("institutions")
    .select(INSTITUTION_COLUMNS)
    .eq("user_id", userId)
    .in("id", institutionIds);

  if (institutionResult.error || !institutionResult.data) {
    throw new Error(`List Plaid institutions: ${institutionResult.error?.message ?? "No data returned."}`);
  }

  const institutionRows = institutionResult.data as InstitutionRow[];
  const institutionById = byId(institutionRows);
  return itemRows.map((item) => toConnectionSummary(item, institutionById.get(item.institution_id)));
}
