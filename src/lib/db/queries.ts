import type {
  AccountRecord,
  AccountRow,
  AuditEventRow,
  BalanceSnapshotRecord,
  BalanceSnapshotRow,
  CategoryRecord,
  CategoryRow,
  Database,
  EnrichedTransactionRow,
  FinanceDashboardData,
  InsightRecord,
  InsightRow,
  InstitutionRow,
  Json,
  MerchantRuleRow,
  RawTransactionRow,
  ReimbursementRecord,
  ReimbursementRecordRow,
  RecurringExpenseRecord,
  RecurringExpenseRow,
  RecurringStatus,
  ReviewItemRecord,
  ReviewItemRow,
  ReviewQueueItem,
  ReviewStatus,
  TransactionIntent,
  TransactionRecord,
  TransactionSplitRecord,
  TransactionSplitRow
} from "./types";

interface QueryError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

interface QueryResult<T> {
  data: T | null;
  error: QueryError | null;
}

type FinanceTables = Database["public"]["Tables"];
type FinanceTableName = Extract<keyof FinanceTables, string>;
type TableRow<Table extends FinanceTableName> = FinanceTables[Table]["Row"];
type TableInsert<Table extends FinanceTableName> = FinanceTables[Table]["Insert"];
type TableUpdate<Table extends FinanceTableName> = FinanceTables[Table]["Update"];

interface FinanceFilterBuilder<Row> extends PromiseLike<QueryResult<Row[]>> {
  select(columns?: string): FinanceFilterBuilder<Row>;
  eq(column: string, value: unknown): FinanceFilterBuilder<Row>;
  in(column: string, values: readonly unknown[]): FinanceFilterBuilder<Row>;
  gte(column: string, value: string | number): FinanceFilterBuilder<Row>;
  lte(column: string, value: string | number): FinanceFilterBuilder<Row>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): FinanceFilterBuilder<Row>;
  limit(count: number): FinanceFilterBuilder<Row>;
  single(): PromiseLike<QueryResult<Row>>;
}

interface FinanceTableBuilder<Row, Insert, Update> {
  delete(): FinanceFilterBuilder<Row>;
  insert(values: Insert | Insert[]): FinanceFilterBuilder<Row>;
  select(columns?: string): FinanceFilterBuilder<Row>;
  update(values: Update): FinanceFilterBuilder<Row>;
  upsert(
    values: Insert | Insert[],
    options?: { ignoreDuplicates?: boolean; onConflict?: string }
  ): FinanceFilterBuilder<Row>;
}

export interface FinanceSupabaseClient {
  from<Table extends FinanceTableName>(
    table: Table
  ): FinanceTableBuilder<TableRow<Table>, TableInsert<Table>, TableUpdate<Table>>;
}

export class FinanceDbError extends Error {
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;

  constructor(context: string, error: QueryError) {
    super(`${context}: ${error.message}`);
    this.name = "FinanceDbError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export interface TransactionListFilters {
  accountIds?: string[];
  categoryIds?: string[];
  intent?: TransactionIntent | "all";
  fromDate?: string;
  toDate?: string;
  recurring?: boolean;
  reviewStatus?: ReviewStatus | "all";
  excludeTransfers?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface BalanceSnapshotFilters {
  accountIds?: string[];
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface TransactionEnrichmentPatch {
  merchantName?: string;
  categoryId?: string | null;
  categoryName?: string;
  intent?: TransactionIntent;
  note?: string;
  isRecurring?: boolean;
  confidence?: number;
  reviewedAt?: string | null;
  source?: EnrichedTransactionRow["source"];
}

export interface CategoryMutationInput {
  color?: string | null;
  icon?: string | null;
  name: string;
  parentId?: string | null;
}

export interface AuditEventInput {
  action: string;
  actorId?: string | null;
  afterData?: Json | null;
  beforeData?: Json | null;
  entityId: string | null;
  entityTable: string;
  metadata?: Json;
}

type EnrichedTransactionUpdate = Database["public"]["Tables"]["enriched_transactions"]["Update"];
type AuditEventInsert = Database["public"]["Tables"]["audit_events"]["Insert"];
type CategoryInsert = Database["public"]["Tables"]["categories"]["Insert"];
type CategoryUpdate = Database["public"]["Tables"]["categories"]["Update"];
type MerchantRuleInsert = Database["public"]["Tables"]["merchant_rules"]["Insert"];
type RecurringExpenseInsert = Database["public"]["Tables"]["recurring_expenses"]["Insert"];
type RecurringExpenseUpdate = Database["public"]["Tables"]["recurring_expenses"]["Update"];
type ReviewItemUpdate = Database["public"]["Tables"]["review_items"]["Update"];
type TransactionSplitInsert = Database["public"]["Tables"]["transaction_splits"]["Insert"];

export interface TransactionSplitMutationInput {
  amount: number;
  categoryId: string | null;
  intent: TransactionIntent;
  label: string;
  notes?: string | null;
}

export interface MerchantRuleMutationInput {
  categoryId: string | null;
  enabled?: boolean;
  intent: TransactionIntent | null;
  isRecurring: boolean | null;
  maxAmount?: number | null;
  merchantPattern: string;
  minAmount?: number | null;
  normalizedMerchantName: string | null;
  notes?: string | null;
  priority: number;
}

function expectData<T>(result: QueryResult<T>, context: string): T {
  if (result.error) {
    throw new FinanceDbError(context, result.error);
  }
  if (result.data === null) {
    throw new FinanceDbError(context, { message: "No data returned from database query." });
  }
  return result.data;
}

function byId<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function slicePage<T>(rows: readonly T[], limit?: number, offset = 0) {
  if (limit === undefined) return rows.slice(offset);
  return rows.slice(offset, offset + limit);
}

function groupBy<T>(rows: T[], getKey: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  rows.forEach((row) => {
    const key = getKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  });
  return grouped;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function toAccountRecord(row: AccountRow, institution?: InstitutionRow): AccountRecord {
  return {
    id: row.id,
    userId: row.user_id,
    institutionId: row.institution_id,
    institutionName: institution?.name ?? "Unknown institution",
    plaidAccountId: row.plaid_account_id,
    name: row.name,
    officialName: row.official_name,
    type: row.type,
    subtype: row.subtype,
    mask: row.mask,
    balance: row.current_balance,
    availableBalance: row.available_balance,
    creditLimit: row.credit_limit,
    currency: row.iso_currency_code,
    color: row.color,
    isActive: row.is_active,
    lastSyncedAt: row.last_synced_at
  };
}

function toCategoryRecord(row: CategoryRow): CategoryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    parentId: row.parent_id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    isSystem: row.is_system
  };
}

function toReviewItemRecord(row: ReviewItemRow): ReviewItemRecord {
  return {
    id: row.id,
    transactionId: row.enriched_transaction_id,
    reason: row.reason,
    status: row.status,
    explanation: row.explanation,
    aiSuggestion: row.ai_suggestion,
    confidence: row.confidence,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at
  };
}

function toSplitRecord(row: TransactionSplitRow, category?: CategoryRow): TransactionSplitRecord {
  return {
    id: row.id,
    transactionId: row.enriched_transaction_id,
    categoryId: row.category_id,
    categoryName: category?.name ?? null,
    label: row.label,
    intent: row.intent,
    amount: row.amount,
    notes: row.notes
  };
}

function toReimbursementRecord(row: ReimbursementRecordRow): ReimbursementRecord {
  return {
    id: row.id,
    transactionId: row.enriched_transaction_id,
    splitId: row.split_id,
    receivedTransactionId: row.received_transaction_id,
    counterparty: row.counterparty,
    expectedAmount: row.expected_amount,
    receivedAmount: row.received_amount,
    status: row.status,
    dueDate: row.due_date,
    receivedAt: row.received_at,
    notes: row.notes
  };
}

function toBalanceSnapshotRecord(row: BalanceSnapshotRow): BalanceSnapshotRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    snapshotDate: row.snapshot_date,
    currentBalance: row.current_balance,
    availableBalance: row.available_balance,
    creditLimit: row.credit_limit,
    currency: row.iso_currency_code,
    source: row.source
  };
}

function toInsightRecord(row: InsightRow): InsightRecord {
  return {
    id: row.id,
    key: row.insight_key,
    title: row.title,
    body: row.body,
    tone: row.tone,
    actionLabel: row.action_label,
    payload: row.payload,
    generatedAt: row.generated_at,
    expiresAt: row.expires_at
  };
}

function transactionSearchText(transaction: TransactionRecord) {
  return [
    transaction.merchant,
    transaction.plaidMerchant,
    transaction.plaidName,
    transaction.category,
    transaction.plaidCategory,
    transaction.accountName,
    transaction.accountMask,
    transaction.institutionName,
    transaction.note
  ].filter(Boolean).join(" ");
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[_/\\|,.;:()[\]{}#]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function filterTransactionRecordsForList(
  transactions: readonly TransactionRecord[],
  filters: Pick<TransactionListFilters, "excludeTransfers" | "limit" | "offset" | "reviewStatus" | "search"> = {}
) {
  const search = normalizeSearchText(filters.search ?? "");
  const searched = search
    ? transactions.filter((transaction) => transactionMatchesSearch(transaction, search))
    : [...transactions];
  const transferFiltered = filters.excludeTransfers
    ? searched.filter((transaction) => transaction.intent !== "transfer")
    : searched;
  const reviewFiltered = filters.reviewStatus && filters.reviewStatus !== "all"
    ? transferFiltered.filter((transaction) =>
      transaction.reviewItems.some((review) => review.status === filters.reviewStatus)
    )
    : transferFiltered;

  return slicePage(reviewFiltered, filters.limit, filters.offset);
}

function buildTransactionRecord({
  row,
  raw,
  account,
  institution,
  category,
  reviews,
  reimbursements,
  splits
}: {
  row: EnrichedTransactionRow;
  raw?: RawTransactionRow;
  account?: AccountRow;
  institution?: InstitutionRow;
  category?: CategoryRow;
  reviews: ReviewItemRecord[];
  reimbursements: ReimbursementRecord[];
  splits: TransactionSplitRecord[];
}): TransactionRecord {
  const openReview = reviews.find((review) => review.status === "open") ?? null;

  return {
    id: row.id,
    userId: row.user_id,
    rawTransactionId: row.raw_transaction_id,
    plaidTransactionId: raw?.plaid_transaction_id ?? null,
    accountId: row.account_id,
    accountName: account?.name ?? "Unknown account",
    accountMask: account?.mask ?? null,
    institutionName: institution?.name ?? "Unknown institution",
    date: row.date,
    merchant: row.merchant_name,
    amount: row.amount,
    categoryId: row.category_id,
    category: row.category_name || category?.name || "Uncategorized",
    intent: row.intent,
    status: row.status,
    confidence: row.confidence,
    reviewReason: openReview?.reason ?? null,
    reviewStatus: openReview?.status ?? null,
    reviewItems: reviews,
    plaidCategory: raw?.plaid_category ?? null,
    plaidMerchant: raw?.merchant_name ?? null,
    plaidName: raw?.name ?? null,
    note: row.note,
    recurring: row.is_recurring,
    splits,
    reimbursements,
    reviewedAt: row.reviewed_at
  };
}

export function transactionMatchesSearch(transaction: TransactionRecord, search: string) {
  const needle = normalizeSearchText(search);
  if (!needle) return true;

  return normalizeSearchText(transactionSearchText(transaction)).includes(needle);
}

async function hydrateTransactions(
  client: FinanceSupabaseClient,
  userId: string,
  enrichedRows: EnrichedTransactionRow[]
): Promise<TransactionRecord[]> {
  if (enrichedRows.length === 0) return [];

  const transactionIds = enrichedRows.map((row) => row.id);
  const rawIds = unique(enrichedRows.map((row) => row.raw_transaction_id));

  const [
    rawResult,
    accountResult,
    institutionResult,
    categoryResult,
    reviewResult,
    reimbursementResult,
    splitResult
  ] = await Promise.all([
    client.from("raw_transactions").select("*").eq("user_id", userId).in("id", rawIds),
    client.from("accounts").select("*").eq("user_id", userId),
    client.from("institutions").select("*").eq("user_id", userId),
    client.from("categories").select("*").eq("user_id", userId),
    client.from("review_items").select("*").eq("user_id", userId).in("enriched_transaction_id", transactionIds),
    client.from("reimbursement_records").select("*").eq("user_id", userId).in("enriched_transaction_id", transactionIds),
    client.from("transaction_splits").select("*").eq("user_id", userId).in("enriched_transaction_id", transactionIds)
  ]);

  const rawById = byId(expectData(rawResult, "Load raw transactions"));
  const accountById = byId(expectData(accountResult, "Load accounts for transactions"));
  const institutionById = byId(expectData(institutionResult, "Load institutions for transactions"));
  const categoryById = byId(expectData(categoryResult, "Load categories for transactions"));
  const reviewsByTransaction = groupBy(
    expectData(reviewResult, "Load review items for transactions").map(toReviewItemRecord),
    (review) => review.transactionId
  );
  const reimbursementsByTransaction = groupBy(
    expectData(reimbursementResult, "Load reimbursement records for transactions").map(toReimbursementRecord),
    (reimbursement) => reimbursement.transactionId
  );
  const splitsByTransaction = groupBy(
    expectData(splitResult, "Load transaction splits").map((split) =>
      toSplitRecord(split, split.category_id ? categoryById.get(split.category_id) : undefined)
    ),
    (split) => split.transactionId
  );

  return enrichedRows.map((row) => {
    const account = accountById.get(row.account_id);
    return buildTransactionRecord({
      row,
      raw: rawById.get(row.raw_transaction_id),
      account,
      institution: account ? institutionById.get(account.institution_id) : undefined,
      category: row.category_id ? categoryById.get(row.category_id) : undefined,
      reviews: reviewsByTransaction.get(row.id) ?? [],
      reimbursements: reimbursementsByTransaction.get(row.id) ?? [],
      splits: splitsByTransaction.get(row.id) ?? []
    });
  });
}

export async function listAccounts(client: FinanceSupabaseClient, userId: string): Promise<AccountRecord[]> {
  const [accountResult, institutionResult] = await Promise.all([
    client.from("accounts").select("*").eq("user_id", userId).order("type").order("name"),
    client.from("institutions").select("*").eq("user_id", userId)
  ]);

  const institutionById = byId(expectData(institutionResult, "List account institutions"));
  return expectData(accountResult, "List accounts").map((account) =>
    toAccountRecord(account, institutionById.get(account.institution_id))
  );
}

export async function listCategories(client: FinanceSupabaseClient, userId: string): Promise<CategoryRecord[]> {
  const result = await client.from("categories").select("*").eq("user_id", userId).order("name");
  return expectData(result, "List categories").map(toCategoryRecord);
}

export async function listMerchantRules(client: FinanceSupabaseClient, userId: string): Promise<MerchantRuleRow[]> {
  const result = await client
    .from("merchant_rules")
    .select("*")
    .eq("user_id", userId)
    .order("priority");
  return expectData(result, "List merchant rules");
}

export async function upsertMerchantRule(
  client: FinanceSupabaseClient,
  userId: string,
  input: MerchantRuleMutationInput
): Promise<MerchantRuleRow> {
  const insert: MerchantRuleInsert = {
    category_id: input.categoryId,
    enabled: input.enabled ?? true,
    intent: input.intent,
    is_recurring: input.isRecurring,
    max_amount: input.maxAmount ?? null,
    merchant_pattern: input.merchantPattern,
    min_amount: input.minAmount ?? null,
    normalized_merchant_name: input.normalizedMerchantName,
    notes: input.notes ?? null,
    priority: input.priority,
    user_id: userId
  };
  const result = await client
    .from("merchant_rules")
    .upsert(insert, { onConflict: "user_id,merchant_pattern,priority" })
    .select("*")
    .single();

  return expectData(result, "Upsert merchant rule");
}

export async function getCategoryById(
  client: FinanceSupabaseClient,
  userId: string,
  categoryId: string
): Promise<CategoryRecord | null> {
  const result = await client
    .from("categories")
    .select("*")
    .eq("user_id", userId)
    .eq("id", categoryId)
    .limit(1);

  const [row] = expectData(result, "Get category");
  return row ? toCategoryRecord(row) : null;
}

export async function createCategory(
  client: FinanceSupabaseClient,
  userId: string,
  input: CategoryMutationInput
): Promise<CategoryRecord> {
  const insert: CategoryInsert = {
    color: input.color ?? null,
    icon: input.icon ?? null,
    name: input.name,
    parent_id: input.parentId ?? null,
    user_id: userId
  };

  const result = await client
    .from("categories")
    .insert(insert)
    .select("*")
    .single();

  return toCategoryRecord(expectData(result, "Create category"));
}

export async function updateCategory(
  client: FinanceSupabaseClient,
  userId: string,
  categoryId: string,
  input: Partial<CategoryMutationInput>
): Promise<CategoryRecord> {
  const update: CategoryUpdate = {};

  if (input.color !== undefined) update.color = input.color;
  if (input.icon !== undefined) update.icon = input.icon;
  if (input.name !== undefined) update.name = input.name;
  if (input.parentId !== undefined) update.parent_id = input.parentId;

  const result = Object.keys(update).length === 0
    ? await client
      .from("categories")
      .select("*")
      .eq("user_id", userId)
      .eq("id", categoryId)
      .single()
    : await client
      .from("categories")
      .update(update)
      .eq("user_id", userId)
      .eq("id", categoryId)
      .select("*")
      .single();

  return toCategoryRecord(expectData(result, "Update category"));
}

export async function listTransactions(
  client: FinanceSupabaseClient,
  userId: string,
  filters: TransactionListFilters = {}
): Promise<TransactionRecord[]> {
  let query = client
    .from("enriched_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters.accountIds?.length) {
    query = query.in("account_id", filters.accountIds);
  }
  if (filters.categoryIds?.length) {
    query = query.in("category_id", filters.categoryIds);
  }
  if (filters.intent && filters.intent !== "all") {
    query = query.eq("intent", filters.intent);
  }
  if (filters.fromDate) {
    query = query.gte("date", filters.fromDate);
  }
  if (filters.toDate) {
    query = query.lte("date", filters.toDate);
  }
  if (filters.recurring !== undefined) {
    query = query.eq("is_recurring", filters.recurring);
  }

  const enrichedRows = expectData(await query, "List enriched transactions");
  const hydrated = await hydrateTransactions(client, userId, enrichedRows);
  return filterTransactionRecordsForList(hydrated, filters);
}

export async function getEnrichedTransactionRow(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string
): Promise<EnrichedTransactionRow | null> {
  const result = await client
    .from("enriched_transactions")
    .select("*")
    .eq("user_id", userId)
    .eq("id", transactionId)
    .limit(1);

  const [row] = expectData(result, "Get enriched transaction");
  return row ?? null;
}

export async function getTransactionById(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string
): Promise<TransactionRecord | null> {
  const row = await getEnrichedTransactionRow(client, userId, transactionId);
  if (!row) return null;

  const [transaction] = await hydrateTransactions(client, userId, [row]);
  return transaction ?? null;
}

export async function listReviewItems(
  client: FinanceSupabaseClient,
  userId: string,
  status: ReviewStatus | "all" = "open"
): Promise<ReviewQueueItem[]> {
  let query = client
    .from("review_items")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const reviewRows = expectData(await query, "List review items");
  if (reviewRows.length === 0) return [];

  const transactionIds = unique(reviewRows.map((row) => row.enriched_transaction_id));
  const transactionResult = await client
    .from("enriched_transactions")
    .select("*")
    .eq("user_id", userId)
    .in("id", transactionIds);
  const transactions = await hydrateTransactions(
    client,
    userId,
    expectData(transactionResult, "Load review transactions")
  );
  const transactionById = byId(transactions);

  return reviewRows
    .map((row) => {
      const review = toReviewItemRecord(row);
      const transaction = transactionById.get(row.enriched_transaction_id);
      if (!transaction) return null;
      return { ...review, transaction };
    })
    .filter((item): item is ReviewQueueItem => item !== null)
    .sort((a, b) => Math.abs(b.transaction.amount) - Math.abs(a.transaction.amount));
}

export async function getReviewQueueItemById(
  client: FinanceSupabaseClient,
  userId: string,
  reviewItemId: string
): Promise<ReviewQueueItem | null> {
  const result = await client
    .from("review_items")
    .select("*")
    .eq("user_id", userId)
    .eq("id", reviewItemId)
    .limit(1);

  const [row] = expectData(result, "Get review item");
  if (!row) return null;

  const transactionResult = await client
    .from("enriched_transactions")
    .select("*")
    .eq("user_id", userId)
    .eq("id", row.enriched_transaction_id)
    .limit(1);

  const [transactionRow] = expectData(transactionResult, "Load review transaction");
  if (!transactionRow) return null;

  const [transaction] = await hydrateTransactions(client, userId, [transactionRow]);
  if (!transaction) return null;

  return {
    ...toReviewItemRecord(row),
    transaction
  };
}

export async function listRecurringExpenses(
  client: FinanceSupabaseClient,
  userId: string,
  statuses: RecurringStatus[] = ["active", "pending"]
): Promise<RecurringExpenseRecord[]> {
  let query = client
    .from("recurring_expenses")
    .select("*")
    .eq("user_id", userId)
    .order("next_due_date", { ascending: true });

  if (statuses.length > 0) {
    query = query.in("status", statuses);
  }

  const [recurringResult, categoryResult, accountResult] = await Promise.all([
    query,
    client.from("categories").select("*").eq("user_id", userId),
    client.from("accounts").select("*").eq("user_id", userId)
  ]);
  const categoryById = byId(expectData(categoryResult, "Load recurring categories"));
  const accountById = byId(expectData(accountResult, "Load recurring accounts"));

  return expectData(recurringResult, "List recurring expenses").map((row: RecurringExpenseRow) => ({
    id: row.id,
    merchant: row.merchant_name,
    amount: row.amount,
    cadence: row.cadence,
    categoryId: row.category_id,
    category: row.category_id ? categoryById.get(row.category_id)?.name ?? null : null,
    accountId: row.account_id,
    accountName: row.account_id ? accountById.get(row.account_id)?.name ?? null : null,
    nextDueDate: row.next_due_date,
    lastChargeDate: row.last_charge_date,
    lastAmount: row.last_amount,
    status: row.status,
    isNew: row.is_new,
    confidence: row.confidence
  }));
}

export async function upsertRecurringExpense(
  client: FinanceSupabaseClient,
  userId: string,
  input: RecurringExpenseInsert,
  onConflict = "user_id,merchant_name,cadence"
): Promise<RecurringExpenseRow> {
  const result = await client
    .from("recurring_expenses")
    .upsert({ ...input, user_id: userId }, { onConflict })
    .select("*")
    .single();

  return expectData(result, "Upsert recurring expense");
}

export async function updateRecurringExpense(
  client: FinanceSupabaseClient,
  userId: string,
  recurringExpenseId: string,
  patch: RecurringExpenseUpdate
): Promise<RecurringExpenseRow> {
  const result = await client
    .from("recurring_expenses")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", recurringExpenseId)
    .select("*")
    .single();

  return expectData(result, "Update recurring expense");
}

export async function listBalanceSnapshots(
  client: FinanceSupabaseClient,
  userId: string,
  filters: BalanceSnapshotFilters = {}
): Promise<BalanceSnapshotRecord[]> {
  let query = client
    .from("balance_snapshots")
    .select("*")
    .eq("user_id", userId)
    .order("snapshot_date", { ascending: false });

  if (filters.accountIds?.length) {
    query = query.in("account_id", filters.accountIds);
  }
  if (filters.fromDate) {
    query = query.gte("snapshot_date", filters.fromDate);
  }
  if (filters.toDate) {
    query = query.lte("snapshot_date", filters.toDate);
  }
  if (filters.limit !== undefined) {
    query = query.limit(filters.limit);
  }

  return expectData(await query, "List balance snapshots").map(toBalanceSnapshotRecord);
}

export async function listInsights(
  client: FinanceSupabaseClient,
  userId: string,
  status: InsightRow["status"] = "active"
): Promise<InsightRecord[]> {
  const result = await client
    .from("insights")
    .select("*")
    .eq("user_id", userId)
    .eq("status", status)
    .order("generated_at", { ascending: false });

  return expectData(result, "List insights").map(toInsightRecord);
}

export async function getFinanceDashboardData(
  client: FinanceSupabaseClient,
  userId: string
): Promise<FinanceDashboardData> {
  const [accounts, recentTransactions, reviewItems, recurringExpenses, insights] = await Promise.all([
    listAccounts(client, userId),
    listTransactions(client, userId, { limit: 8 }),
    listReviewItems(client, userId, "open"),
    listRecurringExpenses(client, userId),
    listInsights(client, userId)
  ]);

  const totals = accounts.reduce(
    (sum, account) => {
      if (account.type === "depository") sum.cash += account.balance;
      if (account.type === "credit") sum.credit += account.balance;
      if (account.type === "investment") sum.investments += account.balance;
      if (account.type === "retirement") sum.retirement += account.balance;
      sum.netWorth += account.balance;
      return sum;
    },
    { cash: 0, credit: 0, investments: 0, retirement: 0, netWorth: 0 }
  );

  return {
    totals,
    accounts,
    recentTransactions,
    reviewItems,
    recurringExpenses,
    insights
  };
}

export async function updateTransactionEnrichment(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string,
  patch: TransactionEnrichmentPatch
): Promise<TransactionRecord> {
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

  const result = Object.keys(update).length === 0
    ? await client
      .from("enriched_transactions")
      .select("*")
      .eq("user_id", userId)
      .eq("id", transactionId)
      .single()
    : await client
      .from("enriched_transactions")
      .update(update)
      .eq("user_id", userId)
      .eq("id", transactionId)
      .select("*")
      .single();

  const [transaction] = await hydrateTransactions(
    client,
    userId,
    [expectData(result, "Update transaction enrichment")]
  );

  return transaction;
}

export async function recordAuditEvent(
  client: FinanceSupabaseClient,
  userId: string,
  input: AuditEventInput
): Promise<AuditEventRow> {
  const insert: AuditEventInsert = {
    action: input.action,
    actor_id: input.actorId ?? null,
    after_data: input.afterData ?? null,
    before_data: input.beforeData ?? null,
    entity_id: input.entityId,
    entity_table: input.entityTable,
    metadata: input.metadata ?? {},
    user_id: userId
  };

  const result = await client
    .from("audit_events")
    .insert(insert)
    .select("*")
    .single();

  return expectData(result, "Record audit event");
}

export async function resolveReviewItem(
  client: FinanceSupabaseClient,
  userId: string,
  reviewItemId: string,
  status: Exclude<ReviewStatus, "open">,
  resolutionNote?: string,
  options: { explanation?: string } = {}
): Promise<ReviewItemRecord> {
  const update: ReviewItemUpdate = {
    status,
    resolved_at: new Date().toISOString(),
    resolution_note: resolutionNote ?? null
  };

  if (options.explanation !== undefined) {
    update.explanation = options.explanation;
  }

  const result = await client
    .from("review_items")
    .update(update)
    .eq("user_id", userId)
    .eq("id", reviewItemId)
    .select("*")
    .single();

  return toReviewItemRecord(expectData(result, "Resolve review item"));
}

export async function replaceTransactionSplits(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string,
  splits: TransactionSplitMutationInput[]
): Promise<TransactionSplitRecord[]> {
  const deleteResult = await client
    .from("transaction_splits")
    .delete()
    .eq("user_id", userId)
    .eq("enriched_transaction_id", transactionId);

  if (deleteResult.error) {
    throw new FinanceDbError("Replace transaction splits", deleteResult.error);
  }

  if (splits.length === 0) return [];

  const inserts: TransactionSplitInsert[] = splits.map((split) => ({
    amount: roundMoney(split.amount),
    category_id: split.categoryId,
    enriched_transaction_id: transactionId,
    intent: split.intent,
    label: split.label,
    notes: split.notes ?? null,
    user_id: userId
  }));

  const result = await client
    .from("transaction_splits")
    .insert(inserts)
    .select("*");
  const rows = expectData(result, "Insert transaction splits");
  const categoryIds = unique(rows.map((row) => row.category_id));
  const categoryRows = categoryIds.length > 0
    ? expectData(
      await client.from("categories").select("*").eq("user_id", userId).in("id", categoryIds),
      "Load categories for transaction splits"
    )
    : [];
  const categoryById = byId(categoryRows);

  return rows.map((row) => toSplitRecord(row, row.category_id ? categoryById.get(row.category_id) : undefined));
}

export function asJsonObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
