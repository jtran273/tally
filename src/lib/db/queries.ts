import { createClient } from "@supabase/supabase-js";
import type {
  AccountRecord,
  AccountRow,
  AnomalyAlertRecord,
  AnomalyAlertReasonCode,
  AnomalyAlertRow,
  AnomalyAlertSeverity,
  AnomalyAlertStatus,
  AgentProposalRecord,
  AgentProposalRow,
  AgentProposalStatus,
  AgentProposalType,
  AgentTargetKind,
  AuditEventRow,
  BalanceSnapshotRecord,
  BalanceSnapshotRow,
  CategoryRecord,
  CategoryRow,
  CreditAprRecord,
  CreditScoreModel,
  CreditScoreSnapshotRecord,
  CreditScoreSnapshotRow,
  CreditScoreSource,
  Database,
  EnrichedTransactionRow,
  FinanceDashboardData,
  InsightRecord,
  InsightRow,
  InstitutionRow,
  Json,
  MerchantRuleRow,
  PlaidItemRow,
  RawTransactionRow,
  ReimbursementRecord,
  ReimbursementRecordRow,
  RecurringExpenseRecord,
  RecurringExpenseRow,
  RecurringStatus,
  ReviewItemRecord,
  ReviewItemRow,
  ReviewQueueItem,
  ReviewReason,
  ReviewResolutionKind,
  ReviewStatus,
  TransactionIntent,
  TransactionRecord,
  TransactionSplitRecord,
  TransactionSplitRow
} from "./types";
import {
  assertAgentProposalPayloadSafe,
  canDismissAgentProposal,
  isAgentProposalExpired,
  isJsonObject,
  isVisibleAgentProposal,
  normalizeAgentClarificationAnswer,
  type AgentProposalJsonObject
} from "../agents/proposals";
import { assertAssistantContextSafe } from "../agents/assistant-contract";
import { missingDefaultSystemCategories } from "../finance/default-categories";
import {
  DEFAULT_REVERSAL_WINDOW_DAYS,
  excludeMatchedRefundReversalTransactions,
  getMatchedRefundReversalTransactionIds
} from "../finance/refund-reversals";
import {
  buildReimbursementLinkDecision,
  buildReimbursementStatusTransition,
  type ReimbursementManualStatus
} from "../finance/reimbursement-linking";
import { transactionSpendingAmount } from "../finance/spending";
import { isRecurringReview } from "../review/reasons";
import { getSupabaseConfig } from "../supabase/env";

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
  lt(column: string, value: string | number): FinanceFilterBuilder<Row>;
  lte(column: string, value: string | number): FinanceFilterBuilder<Row>;
  like(column: string, pattern: string): FinanceFilterBuilder<Row>;
  ilike(column: string, pattern: string): FinanceFilterBuilder<Row>;
  neq(column: string, value: unknown): FinanceFilterBuilder<Row>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): FinanceFilterBuilder<Row>;
  limit(count: number): FinanceFilterBuilder<Row>;
  range(from: number, to: number): FinanceFilterBuilder<Row>;
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

function canUseServiceRoleClient(client: FinanceSupabaseClient) {
  return "auth" in (client as unknown as Record<string, unknown>);
}

function createServiceRoleClient(client: FinanceSupabaseClient) {
  if (!canUseServiceRoleClient(client)) return null;

  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!config || !serviceRoleKey) return null;

  return createClient<Database>(config.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }) as unknown as FinanceSupabaseClient;
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

export type TransactionQualityFilter = "all" | "needs-cleanup" | "low-confidence" | "uncategorized";
export type TransactionDirectionFilter = "all" | "income" | "spending";

export interface TransactionListFilters {
  accountIds?: string[];
  categoryIds?: string[];
  direction?: TransactionDirectionFilter;
  intent?: TransactionIntent | "all";
  fromDate?: string;
  toDate?: string;
  recurring?: boolean;
  reviewReason?: ReviewReason | "all";
  reviewStatus?: ReviewStatus | "all";
  quality?: TransactionQualityFilter;
  excludeTransfers?: boolean;
  includeRawContext?: boolean;
  /**
   * When true, transactions from inactive accounts and revoked Plaid items are
   * included. Only the Transactions history page and CSV export opt into this so
   * users keep a record of past spending. All analytics surfaces (dashboard, net
   * worth, anomaly scan, recurring, OpenClaw) leave this false so disconnected
   * accounts never distort financial calculations.
   */
  includeDisconnectedAccounts?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ReviewItemListOptions {
  includeRawContext?: boolean;
  limit?: number;
}

export interface BalanceSnapshotFilters {
  accountIds?: string[];
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface CreditScoreSnapshotMutationInput {
  asOfDate: string;
  model: CreditScoreModel;
  score: number;
  source: CreditScoreSource;
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
type AnomalyAlertInsert = Database["public"]["Tables"]["anomaly_alerts"]["Insert"];
type AnomalyAlertUpdate = Database["public"]["Tables"]["anomaly_alerts"]["Update"];
type AgentProposalInsert = Database["public"]["Tables"]["agent_proposals"]["Insert"];
type AgentProposalUpdate = Database["public"]["Tables"]["agent_proposals"]["Update"];
type AuditEventInsert = Database["public"]["Tables"]["audit_events"]["Insert"];
type CategoryInsert = Database["public"]["Tables"]["categories"]["Insert"];
type CategoryUpdate = Database["public"]["Tables"]["categories"]["Update"];
type CreditScoreSnapshotInsert = Database["public"]["Tables"]["credit_score_snapshots"]["Insert"];
type MerchantRuleInsert = Database["public"]["Tables"]["merchant_rules"]["Insert"];
type RecurringExpenseInsert = Database["public"]["Tables"]["recurring_expenses"]["Insert"];
type RecurringExpenseUpdate = Database["public"]["Tables"]["recurring_expenses"]["Update"];
type ReimbursementRecordInsert = Database["public"]["Tables"]["reimbursement_records"]["Insert"];
type ReimbursementRecordUpdate = Database["public"]["Tables"]["reimbursement_records"]["Update"];
type ReviewItemUpdate = Database["public"]["Tables"]["review_items"]["Update"];
type TransactionSplitUpdate = Database["public"]["Tables"]["transaction_splits"]["Update"];
type TransactionSplitInsert = Database["public"]["Tables"]["transaction_splits"]["Insert"];

export interface TransactionSplitMutationInput {
  amount: number;
  categoryId: string | null;
  id?: string | null;
  intent: TransactionIntent;
  label: string;
  notes?: string | null;
}

export interface ReimbursementSplitSyncOptions {
  actorId?: string | null;
  source?: string;
}

export interface LinkReimbursementInput {
  appliedAmount?: number;
  actorId?: string | null;
  receivedTransactionId: string;
  reimbursementId: string;
  source?: string;
}

export interface UnlinkReimbursementInput {
  actorId?: string | null;
  reimbursementId: string;
  restoredReceivedTransactionIntent?: TransactionIntent;
  source?: string;
}

export interface SetReimbursementStatusInput {
  actorId?: string | null;
  reimbursementId: string;
  status: ReimbursementManualStatus;
  source?: string;
}

export interface AgentProposalMutationInput {
  clarificationQuestion?: string | null;
  confidence?: number | null;
  evidence?: Json;
  expiresAt?: string | null;
  proposedPatch?: Json;
  proposalType: AgentProposalType;
  questionFingerprint?: string | null;
  sourceAgent: string;
  sourceCandidateId?: string | null;
  sourceContextId?: string | null;
  targetId: string;
  targetKind: AgentTargetKind;
}

export interface AgentProposalListFilters {
  includeExpired?: boolean;
  limit?: number;
  since?: string;
  status?: AgentProposalStatus | "all";
}

export interface AnomalyAlertMutationInput {
  body: string;
  dedupeKey: string;
  detectedAt?: string;
  evidence?: Json;
  reasonCode: AnomalyAlertReasonCode;
  severity: AnomalyAlertSeverity;
  title: string;
}

export interface AnomalyAlertListFilters {
  includeResolved?: boolean;
  limit?: number;
  reasonCode?: AnomalyAlertReasonCode;
  since?: string;
  sinceColumn?: "created_at" | "detected_at" | "first_seen_at" | "updated_at";
  status?: AnomalyAlertStatus | "all";
}

export interface AcceptAgentProposalOptions {
  actorId?: string | null;
  source?: string;
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

function isMissingRelationOrSchemaCacheError(error: QueryError, relationName: string) {
  const message = error.message.toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (message.includes("could not find the table") && message.includes(relationName.toLowerCase()))
  );
}

function isMissingSingleRowError(error: QueryError) {
  const message = error.message.toLowerCase();
  const details = error.details?.toLowerCase() ?? "";
  return (
    message.includes("no rows") ||
    message.includes("0 rows") ||
    (error.code === "PGRST116" && details.includes("0 rows"))
  );
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

function isCreditAprRecord(value: Json): value is Json & {
  aprPercentage?: number | null;
  aprType?: string;
  balanceSubjectToApr?: number | null;
  interestChargeAmount?: number | null;
} {
  return (
    isJsonObject(value) &&
    typeof value.aprType === "string" &&
    (value.aprPercentage === null || typeof value.aprPercentage === "number") &&
    (value.balanceSubjectToApr === null || typeof value.balanceSubjectToApr === "number") &&
    (value.interestChargeAmount === null || typeof value.interestChargeAmount === "number")
  );
}

function parseCreditAprs(value: Json): CreditAprRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isCreditAprRecord).map((row): CreditAprRecord => ({
    aprPercentage: row.aprPercentage ?? null,
    aprType: row.aprType ?? "unknown",
    balanceSubjectToApr: row.balanceSubjectToApr ?? null,
    interestChargeAmount: row.interestChargeAmount ?? null
  }));
}

function toAccountRecord(
  row: AccountRow,
  institution?: InstitutionRow,
  plaidItem?: Pick<PlaidItemRow, "auto_sync_enabled" | "connection_source">
): AccountRecord {
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
    lastSyncedAt: row.last_synced_at,
    plaidAutoSyncEnabled: plaidItem?.auto_sync_enabled ?? null,
    plaidConnectionSource: plaidItem?.connection_source ?? null,
    lastStatementIssueDate: row.last_statement_issue_date,
    lastStatementBalance: row.last_statement_balance,
    nextPaymentDueDate: row.next_payment_due_date,
    minimumPaymentAmount: row.minimum_payment_amount,
    liabilityIsOverdue: row.liability_is_overdue ?? null,
    liabilityLastPaymentDate: row.liability_last_payment_date ?? null,
    liabilityLastPaymentAmount: row.liability_last_payment_amount ?? null,
    liabilityAprs: parseCreditAprs(row.liability_aprs ?? [])
  };
}

async function listActiveAccountIds(client: FinanceSupabaseClient, userId: string) {
  const [accountResult, plaidItemResult] = await Promise.all([
    client.from("accounts").select("id,plaid_item_id").eq("user_id", userId).eq("is_active", true),
    client.from("plaid_items").select("id").eq("user_id", userId).neq("status", "revoked")
  ]);
  const activePlaidItemIds = new Set(
    (expectData(plaidItemResult, "List active Plaid item ids") as Array<Pick<PlaidItemRow, "id">>)
      .map((item) => item.id)
  );

  return (expectData(accountResult, "List active account ids") as Array<Pick<AccountRow, "id" | "plaid_item_id">>)
    .filter((account) => activePlaidItemIds.has(account.plaid_item_id))
    .map((account) => account.id);
}

async function listTransactionHistoryAccountIds(client: FinanceSupabaseClient, userId: string) {
  const result = await client
    .from("accounts")
    .select("id")
    .eq("user_id", userId);

  return expectData(result, "List transaction history account ids")
    .map((account) => account.id);
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

function toCreditScoreSnapshotRecord(row: CreditScoreSnapshotRow): CreditScoreSnapshotRecord {
  return {
    asOfDate: row.as_of_date,
    createdAt: row.created_at,
    id: row.id,
    model: row.model,
    score: row.score,
    source: row.source,
    updatedAt: row.updated_at,
    userId: row.user_id
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
    resolutionKind: row.resolution_kind ?? null,
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

function reimbursementAuditSnapshot(row: ReimbursementRecordRow): Record<string, Json> {
  return {
    counterparty: row.counterparty,
    dueDate: row.due_date,
    expectedAmount: row.expected_amount,
    receivedAmount: row.received_amount,
    receivedAt: row.received_at,
    receivedTransactionId: row.received_transaction_id,
    splitId: row.split_id,
    status: row.status,
    transactionId: row.enriched_transaction_id
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

function toAgentProposalRecord(row: AgentProposalRow): AgentProposalRecord {
  return {
    id: row.id,
    userId: row.user_id,
    proposalType: row.proposal_type,
    targetKind: row.target_kind,
    targetId: row.target_id,
    evidence: row.evidence,
    confidence: row.confidence,
    proposedPatch: row.proposed_patch,
    status: row.status,
    clarificationQuestion: row.clarification_question,
    clarificationAnswer: row.clarification_answer,
    clarificationAnswerKind: row.clarification_answer_kind,
    questionFingerprint: row.question_fingerprint,
    sourceContextId: row.source_context_id,
    sourceCandidateId: row.source_candidate_id,
    sourceAgent: row.source_agent,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    dismissedAt: row.dismissed_at,
    answeredAt: row.answered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toAnomalyAlertRecord(row: AnomalyAlertRow): AnomalyAlertRecord {
  return {
    id: row.id,
    userId: row.user_id,
    reasonCode: row.reason_code,
    severity: row.severity,
    status: row.status,
    dedupeKey: row.dedupe_key,
    title: row.title,
    body: row.body,
    evidence: row.evidence,
    detectedAt: row.detected_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    dismissedAt: row.dismissed_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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

function transactionNeedsCategoryCleanup(transaction: TransactionRecord) {
  return transaction.confidence < 0.75 ||
    !transaction.categoryId ||
    transaction.category.toLowerCase() === "uncategorized" ||
    transaction.reviewItems.some((review) => review.status === "open" && !isRecurringReview(review.reason));
}

function transactionMatchesReviewStatus(
  transaction: TransactionRecord,
  status: ReviewStatus,
  reasonFilter: ReviewReason | "all" | undefined
) {
  return transaction.reviewItems.some((review) => {
    if (review.status !== status) return false;
    if (isRecurringReview(review.reason)) return reasonFilter === review.reason;
    return true;
  });
}

function transactionMatchesQuality(transaction: TransactionRecord, quality: TransactionQualityFilter | undefined) {
  if (!quality || quality === "all") return true;
  if (quality === "low-confidence") return transaction.confidence < 0.75;
  if (quality === "uncategorized") return !transaction.categoryId || transaction.category.toLowerCase() === "uncategorized";
  return transactionNeedsCategoryCleanup(transaction);
}

function transactionMatchesDirection(transaction: TransactionRecord, direction: TransactionDirectionFilter | undefined) {
  if (!direction || direction === "all") return true;
  if (direction === "income") return transaction.amount > 0 && transaction.intent !== "transfer";
  return transactionSpendingAmount(transaction) > 0;
}

function firstOpenReview(reviews: readonly ReviewItemRecord[]) {
  return reviews.find((review) => review.status === "open" && !isRecurringReview(review.reason)) ??
    reviews.find((review) => review.status === "open") ??
    null;
}

function withReviews(transaction: TransactionRecord, reviews: ReviewItemRecord[]): TransactionRecord {
  const openReview = firstOpenReview(reviews);
  return {
    ...transaction,
    reviewItems: reviews,
    reviewReason: openReview?.reason ?? null,
    reviewStatus: openReview?.status ?? null
  };
}

function suppressMatchedRefundReversalReviews(transactions: readonly TransactionRecord[]) {
  const matchedIds = getMatchedRefundReversalTransactionIds(transactions);
  return suppressMatchedRefundReversalReviewsById(transactions, matchedIds);
}

function suppressMatchedRefundReversalReviewsById(
  transactions: readonly TransactionRecord[],
  matchedIds: ReadonlySet<string>
) {
  if (matchedIds.size === 0) return [...transactions];

  return transactions.map((transaction) => {
    if (!matchedIds.has(transaction.id)) return transaction;

    const reviews = transaction.reviewItems.filter((review) =>
      review.status !== "open" || isRecurringReview(review.reason)
    );
    return reviews.length === transaction.reviewItems.length
      ? transaction
      : withReviews(transaction, reviews);
  });
}

function hasActiveReviewFilter(filters: Pick<TransactionListFilters, "reviewReason" | "reviewStatus">) {
  return Boolean(
    (filters.reviewStatus && filters.reviewStatus !== "all") ||
    (filters.reviewReason && filters.reviewReason !== "all")
  );
}

function requiresHydratedTransactionFiltering(filters: TransactionListFilters) {
  return Boolean(
    filters.search?.trim() ||
    (filters.quality && filters.quality !== "all") ||
    (filters.direction && filters.direction !== "all") ||
    hasActiveReviewFilter(filters)
  );
}

function transactionRowLimit(filters: TransactionListFilters) {
  if (filters.limit === undefined || requiresHydratedTransactionFiltering(filters)) return undefined;
  return (filters.offset ?? 0) + filters.limit;
}

function reviewRowFetchLimit(limit: number | undefined) {
  if (limit === undefined) return undefined;
  return Math.min(Math.max(limit * 5, limit + 10), 250);
}

export function filterTransactionRecordsForList(
  transactions: readonly TransactionRecord[],
  filters: Pick<TransactionListFilters, "direction" | "excludeTransfers" | "limit" | "offset" | "quality" | "reviewReason" | "reviewStatus" | "search"> = {},
  options: { matchedRefundReversalIds?: ReadonlySet<string> } = {}
) {
  const reviewReadyTransactions = hasActiveReviewFilter(filters)
    ? options.matchedRefundReversalIds
      ? suppressMatchedRefundReversalReviewsById(transactions, options.matchedRefundReversalIds)
      : suppressMatchedRefundReversalReviews(transactions)
    : [...transactions];
  const reportableTransactions = filters.direction && filters.direction !== "all"
    ? options.matchedRefundReversalIds
      ? reviewReadyTransactions.filter((transaction) => !options.matchedRefundReversalIds?.has(transaction.id))
      : excludeMatchedRefundReversalTransactions(reviewReadyTransactions)
    : reviewReadyTransactions;
  const search = normalizeSearchText(filters.search ?? "");
  const searched = search
    ? reportableTransactions.filter((transaction) => transactionMatchesSearch(transaction, search))
    : reportableTransactions;
  const transferFiltered = filters.excludeTransfers
    ? searched.filter((transaction) => transaction.intent !== "transfer")
    : searched;
  const reviewFiltered = filters.reviewStatus && filters.reviewStatus !== "all"
    ? transferFiltered.filter((transaction) =>
      transactionMatchesReviewStatus(transaction, filters.reviewStatus as ReviewStatus, filters.reviewReason)
    )
    : transferFiltered;
  const reasonFiltered = filters.reviewReason && filters.reviewReason !== "all"
    ? reviewFiltered.filter((transaction) =>
      transaction.reviewItems.some((review) => review.reason === filters.reviewReason)
    )
    : reviewFiltered;
  const directionFiltered = reasonFiltered.filter((transaction) => transactionMatchesDirection(transaction, filters.direction));
  const qualityFiltered = directionFiltered.filter((transaction) => transactionMatchesQuality(transaction, filters.quality));

  return slicePage(qualityFiltered, filters.limit, filters.offset);
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
  raw?: RawTransactionContextRow;
  account?: AccountRow;
  institution?: InstitutionRow;
  category?: CategoryRow;
  reviews: ReviewItemRecord[];
  reimbursements: ReimbursementRecord[];
  splits: TransactionSplitRecord[];
}): TransactionRecord {
  const openReview = firstOpenReview(reviews);

  return {
    id: row.id,
    userId: row.user_id,
    rawTransactionId: row.raw_transaction_id,
    plaidTransactionId: null,
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

type RawTransactionContextRow = Pick<
  RawTransactionRow,
  "id" | "merchant_name" | "name" | "plaid_category"
>;

const RAW_TRANSACTION_CONTEXT_COLUMNS = [
  "id",
  "merchant_name",
  "name",
  "plaid_category"
].join(",");

export function transactionMatchesSearch(transaction: TransactionRecord, search: string) {
  const needle = normalizeSearchText(search);
  if (!needle) return true;

  return normalizeSearchText(transactionSearchText(transaction)).includes(needle);
}

async function hydrateTransactions(
  client: FinanceSupabaseClient,
  userId: string,
  enrichedRows: readonly EnrichedTransactionRow[],
  options: { includeRawContext?: boolean } = {}
): Promise<TransactionRecord[]> {
  if (enrichedRows.length === 0) return [];

  const transactionIds = enrichedRows.map((row) => row.id);
  const rawIds = unique(enrichedRows.map((row) => row.raw_transaction_id));
  const includeRawContext = options.includeRawContext ?? true;

  const [
    rawResult,
    accountResult,
    institutionResult,
    categoryResult,
    reviewResult,
    reimbursementResult,
    splitResult
  ] = await Promise.all([
    includeRawContext
      ? client
        .from("raw_transactions")
        .select(RAW_TRANSACTION_CONTEXT_COLUMNS)
        .eq("user_id", userId)
        .in("id", rawIds)
      : Promise.resolve({ data: [] as RawTransactionContextRow[], error: null }),
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

  const transactions = enrichedRows.flatMap((row) => {
    const account = accountById.get(row.account_id);
    if (!account) return [];

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

  return suppressMatchedRefundReversalReviews(transactions);
}

async function listReviewTransactionIds(
  client: FinanceSupabaseClient,
  userId: string,
  filters: Pick<TransactionListFilters, "reviewReason" | "reviewStatus">
) {
  const statusFilter = filters.reviewStatus && filters.reviewStatus !== "all"
    ? filters.reviewStatus
    : null;
  const reasonFilter = filters.reviewReason && filters.reviewReason !== "all"
    ? filters.reviewReason
    : null;

  if (!statusFilter && !reasonFilter) return null;

  async function loadIds(filter: { reason?: ReviewReason; status?: ReviewStatus }) {
    let query = client
      .from("review_items")
      .select("enriched_transaction_id")
      .eq("user_id", userId);

    if (filter.status) query = query.eq("status", filter.status);
    if (filter.reason) query = query.eq("reason", filter.reason);
    if (filter.status && !filter.reason) {
      query = query.neq("reason", "new-recurring").neq("reason", "recurring-candidate");
    }

    return new Set(expectData(await query, "List review transaction ids").map((row) => row.enriched_transaction_id));
  }

  if (statusFilter && reasonFilter) {
    const [statusIds, reasonIds] = await Promise.all([
      loadIds({ status: statusFilter }),
      loadIds({ reason: reasonFilter })
    ]);
    return [...statusIds].filter((id) => reasonIds.has(id));
  }

  return [...await loadIds(statusFilter ? { status: statusFilter } : { reason: reasonFilter! })];
}

async function loadTransactionRowsWithRefundReversalContext(
  client: FinanceSupabaseClient,
  userId: string,
  rows: readonly EnrichedTransactionRow[],
  accountIds: readonly string[]
) {
  if (rows.length === 0) return [];

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const windows = refundContextWindowsForRows(rows);
  if (windows.length === 0) return [...rows];

  for (const window of windows) {
    let query = client
      .from("enriched_transactions")
      .select("*")
      .eq("user_id", userId)
      .gte("date", window.fromDate)
      .lte("date", window.toDate);

    if (accountIds.length > 0) {
      query = query.in("account_id", accountIds);
    }

    const contextRows = expectData(await query, "Load transaction refund reversal context");
    contextRows.forEach((row) => rowsById.set(row.id, row));
  }

  return rowsById.size === rows.length ? rows : [...rowsById.values()];
}

export async function listAccounts(client: FinanceSupabaseClient, userId: string): Promise<AccountRecord[]> {
  const [accountResult, institutionResult, plaidItemResult] = await Promise.all([
    client.from("accounts").select("*").eq("user_id", userId).eq("is_active", true).order("type").order("name"),
    client.from("institutions").select("*").eq("user_id", userId),
    client.from("plaid_items").select("id,connection_source,auto_sync_enabled").eq("user_id", userId).neq("status", "revoked")
  ]);

  const institutionById = byId(expectData(institutionResult, "List account institutions"));
  const activePlaidItemsById = new Map(
    (expectData(plaidItemResult, "List active Plaid item ids") as Array<Pick<PlaidItemRow, "auto_sync_enabled" | "connection_source" | "id">>)
      .map((item) => [item.id, item])
  );
  return expectData(accountResult, "List accounts")
    .filter((account) => activePlaidItemsById.has(account.plaid_item_id))
    .map((account) =>
      toAccountRecord(account, institutionById.get(account.institution_id), activePlaidItemsById.get(account.plaid_item_id))
    );
}

export async function listTransactionAccounts(client: FinanceSupabaseClient, userId: string): Promise<AccountRecord[]> {
  const [accountResult, institutionResult, plaidItemResult] = await Promise.all([
    client.from("accounts").select("*").eq("user_id", userId).order("type").order("name"),
    client.from("institutions").select("*").eq("user_id", userId),
    client.from("plaid_items").select("id,connection_source,auto_sync_enabled").eq("user_id", userId)
  ]);

  const institutionById = byId(expectData(institutionResult, "List transaction account institutions"));
  const plaidItemsById = new Map(
    (expectData(plaidItemResult, "List transaction account Plaid item ids") as Array<Pick<PlaidItemRow, "auto_sync_enabled" | "connection_source" | "id">>)
      .map((item) => [item.id, item])
  );

  return expectData(accountResult, "List transaction accounts")
    .map((account) =>
      toAccountRecord(account, institutionById.get(account.institution_id), plaidItemsById.get(account.plaid_item_id))
    );
}

export async function listCategories(client: FinanceSupabaseClient, userId: string): Promise<CategoryRecord[]> {
  const result = await client.from("categories").select("*").eq("user_id", userId).order("name");
  const rows = expectData(result, "List categories");
  const missingCategories = missingDefaultSystemCategories(rows.map((row) => row.name));

  if (missingCategories.length > 0) {
    const insertRows: CategoryInsert[] = missingCategories.map((category) => ({
      color: category.color,
      icon: category.icon,
      is_system: true,
      name: category.name,
      parent_id: null,
      user_id: userId
    }));
    const insertResult = await client
      .from("categories")
      .upsert(insertRows, { ignoreDuplicates: true, onConflict: "user_id,name" })
      .select("*");
    rows.push(...expectData(insertResult, "Insert default categories"));
  }

  return rows
    .map(toCategoryRecord)
    .sort((left, right) => left.name.localeCompare(right.name));
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

export async function upsertCategory(
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
    .upsert(insert, { onConflict: "user_id,name" })
    .select("*")
    .single();

  return toCategoryRecord(expectData(result, "Upsert category"));
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
  const reviewTransactionIds = await listReviewTransactionIds(client, userId, filters);
  if (reviewTransactionIds && reviewTransactionIds.length === 0) return [];
  const visibleAccountIds = filters.includeDisconnectedAccounts
    ? await listTransactionHistoryAccountIds(client, userId)
    : await listActiveAccountIds(client, userId);
  if (visibleAccountIds.length === 0) return [];
  const visibleAccountIdSet = new Set(visibleAccountIds);
  const accountIds = filters.accountIds?.length
    ? filters.accountIds.filter((accountId) => visibleAccountIdSet.has(accountId))
    : visibleAccountIds;
  if (accountIds.length === 0) return [];

  let query = client
    .from("enriched_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (reviewTransactionIds) {
    query = query.in("id", reviewTransactionIds);
  }
  query = query.in("account_id", accountIds);
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
  if (filters.excludeTransfers) {
    query = query.neq("intent", "transfer");
  }
  const rowLimit = transactionRowLimit(filters);
  if (rowLimit !== undefined) {
    query = query.limit(rowLimit);
  }

  const enrichedRows = expectData(await query, "List enriched transactions");
  const needsRefundReversalContext =
    (filters.direction && filters.direction !== "all") ||
    hasActiveReviewFilter(filters);
  const contextRows = needsRefundReversalContext
    ? await loadTransactionRowsWithRefundReversalContext(client, userId, enrichedRows, accountIds)
    : enrichedRows;
  const contextTransactions = contextRows === enrichedRows
    ? null
    : await hydrateTransactions(client, userId, contextRows, {
      includeRawContext: filters.search?.trim() ? true : filters.includeRawContext
    });
  const matchedRefundReversalIds = contextTransactions
    ? getMatchedRefundReversalTransactionIds(contextTransactions)
    : undefined;
  const hydrated = await hydrateTransactions(client, userId, enrichedRows, {
    includeRawContext: filters.search?.trim() ? true : filters.includeRawContext
  });
  return filterTransactionRecordsForList(hydrated, filters, { matchedRefundReversalIds });
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

function addDaysIso(value: string, days: number) {
  const time = new Date(`${value}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

interface DateWindow {
  fromDate: string;
  toDate: string;
}

function refundContextWindowsForRows(rows: readonly EnrichedTransactionRow[]): DateWindow[] {
  const windows = rows.flatMap((row) => {
    const fromDate = addDaysIso(row.date, -DEFAULT_REVERSAL_WINDOW_DAYS);
    const toDate = addDaysIso(row.date, DEFAULT_REVERSAL_WINDOW_DAYS);
    return fromDate && toDate ? [{ fromDate, toDate }] : [];
  }).sort((left, right) => left.fromDate.localeCompare(right.fromDate));

  return windows.reduce<DateWindow[]>((merged, window) => {
    const previous = merged[merged.length - 1];
    const mergeBoundary = previous ? addDaysIso(previous.toDate, 1) ?? previous.toDate : null;
    if (!previous || !mergeBoundary || window.fromDate > mergeBoundary) {
      merged.push({ ...window });
      return merged;
    }

    if (window.toDate > previous.toDate) {
      previous.toDate = window.toDate;
    }
    return merged;
  }, []);
}

async function loadReviewRowsWithRefundReversalContext(
  client: FinanceSupabaseClient,
  userId: string,
  transactionIds: readonly string[]
) {
  const transactionResult = await client
    .from("enriched_transactions")
    .select("*")
    .eq("user_id", userId)
    .in("id", transactionIds);
  const reviewTransactionRows = expectData(transactionResult, "Load review transactions");
  if (reviewTransactionRows.length === 0) return [];

  const rowsById = new Map(reviewTransactionRows.map((row) => [row.id, row]));
  const windows = refundContextWindowsForRows(reviewTransactionRows);

  for (const window of windows) {
    const contextResult = await client
      .from("enriched_transactions")
      .select("*")
      .eq("user_id", userId)
      .gte("date", window.fromDate)
      .lte("date", window.toDate);
    const contextRows = expectData(contextResult, "Load review refund reversal context");
    contextRows.forEach((row) => rowsById.set(row.id, row));
  }

  return [...rowsById.values()];
}

export async function listReviewItems(
  client: FinanceSupabaseClient,
  userId: string,
  status: ReviewStatus | "all" = "open",
  options: ReviewItemListOptions = {}
): Promise<ReviewQueueItem[]> {
  const fetchLimit = reviewRowFetchLimit(options.limit);
  const collectedItems: ReviewQueueItem[] = [];
  let offset = 0;

  while (true) {
    const reviewRows = await listReviewItemRows(client, userId, status, fetchLimit, offset);
    if (reviewRows.length === 0) break;

    const pageItems = await hydrateReviewQueueItems(client, userId, reviewRows, options);
    collectedItems.push(...pageItems);

    if (
      fetchLimit === undefined ||
      reviewRows.length < fetchLimit ||
      (options.limit !== undefined && collectedItems.length >= options.limit)
    ) {
      break;
    }
    offset += fetchLimit;
  }

  return collectedItems
    .sort((a, b) => Math.abs(b.transaction.amount) - Math.abs(a.transaction.amount))
    .slice(0, options.limit);
}

async function listReviewItemRows(
  client: FinanceSupabaseClient,
  userId: string,
  status: ReviewStatus | "all",
  fetchLimit: number | undefined,
  offset: number
) {
  let query = client
    .from("review_items")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (status !== "all") {
    query = query.eq("status", status);
  }
  if (fetchLimit !== undefined) {
    query = query.range(offset, offset + fetchLimit - 1);
  }

  return expectData(await query, "List review items");
}

async function hydrateReviewQueueItems(
  client: FinanceSupabaseClient,
  userId: string,
  reviewRows: readonly ReviewItemRow[],
  options: ReviewItemListOptions
) {
  if (reviewRows.length === 0) return [];

  const transactionIds = unique(reviewRows.map((row) => row.enriched_transaction_id));
  const transactionRows = await loadReviewRowsWithRefundReversalContext(client, userId, transactionIds);
  const transactions = await hydrateTransactions(
    client,
    userId,
    transactionRows,
    { includeRawContext: options.includeRawContext }
  );
  const transactionById = byId(transactions);
  const matchedReversalTransactionIds = getMatchedRefundReversalTransactionIds(transactions);

  return reviewRows
    .map((row) => {
      if (
        row.status === "open" &&
        !isRecurringReview(row.reason) &&
        matchedReversalTransactionIds.has(row.enriched_transaction_id)
      ) {
        return null;
      }

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

export async function listCreditScoreSnapshots(
  client: FinanceSupabaseClient,
  userId: string,
  options: { limit?: number } = {}
): Promise<CreditScoreSnapshotRecord[]> {
  let query = client
    .from("credit_score_snapshots")
    .select("*")
    .eq("user_id", userId)
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }

  return expectData(await query, "List credit score snapshots").map(toCreditScoreSnapshotRecord);
}

export async function createCreditScoreSnapshot(
  client: FinanceSupabaseClient,
  userId: string,
  input: CreditScoreSnapshotMutationInput
): Promise<CreditScoreSnapshotRecord> {
  const insert: CreditScoreSnapshotInsert = {
    as_of_date: input.asOfDate,
    model: input.model,
    score: input.score,
    source: input.source,
    user_id: userId
  };

  const result = await client
    .from("credit_score_snapshots")
    .insert(insert)
    .select("*")
    .single();

  return toCreditScoreSnapshotRecord(expectData(result, "Create credit score snapshot"));
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

function agentProposalAuditData(proposal: AgentProposalRecord): Record<string, Json> {
  return {
    confidence: proposal.confidence,
    proposalType: proposal.proposalType,
    questionFingerprint: proposal.questionFingerprint,
    sourceAgent: proposal.sourceAgent,
    status: proposal.status,
    targetId: proposal.targetId,
    targetKind: proposal.targetKind
  };
}

function proposalPatchObject(proposal: AgentProposalRecord): AgentProposalJsonObject {
  if (!isJsonObject(proposal.proposedPatch)) {
    throw new FinanceDbError("Read agent proposal patch", { message: "Agent proposal patch must be an object." });
  }
  return proposal.proposedPatch;
}

function reviewSuggestionPatchFromProposal(proposal: AgentProposalRecord): TransactionEnrichmentPatch {
  const patch = proposalPatchObject(proposal);
  const update: TransactionEnrichmentPatch = {};

  if (typeof patch.merchantName === "string") update.merchantName = patch.merchantName;
  if (typeof patch.categoryId === "string" || patch.categoryId === null) update.categoryId = patch.categoryId;
  if (typeof patch.categoryName === "string") update.categoryName = patch.categoryName;
  if (
    patch.intent === "personal" ||
    patch.intent === "business" ||
    patch.intent === "shared" ||
    patch.intent === "reimbursable" ||
    patch.intent === "transfer"
  ) {
    update.intent = patch.intent;
  }
  if (typeof patch.note === "string") update.note = patch.note;
  if (typeof patch.isRecurring === "boolean") update.isRecurring = patch.isRecurring;
  if (typeof patch.confidence === "number") update.confidence = patch.confidence;

  if (Object.keys(update).length === 0) {
    throw new FinanceDbError("Accept review suggestion proposal", { message: "Agent proposal does not contain an applicable review patch." });
  }

  return update;
}

function reimbursementMatchInputFromProposal(proposal: AgentProposalRecord): Pick<LinkReimbursementInput, "appliedAmount" | "receivedTransactionId" | "reimbursementId"> {
  const patch = proposalPatchObject(proposal);
  const reimbursementId = typeof patch.reimbursementRecordId === "string" ? patch.reimbursementRecordId : proposal.targetId;
  const receivedTransactionId = typeof patch.receivedTransactionId === "string" ? patch.receivedTransactionId : null;
  const appliedAmount = typeof patch.matchAmount === "number" ? patch.matchAmount : undefined;

  if (!receivedTransactionId) {
    throw new FinanceDbError("Accept reimbursement match proposal", { message: "Agent proposal is missing a received transaction id." });
  }

  return { appliedAmount, receivedTransactionId, reimbursementId };
}

function assertPendingAgentProposal(proposal: AgentProposalRecord, context: string) {
  if (proposal.status !== "pending") {
    throw new FinanceDbError(context, { message: "Agent proposal is not pending." });
  }
  if (isAgentProposalExpired(proposal)) {
    throw new FinanceDbError(context, { message: "Agent proposal has expired." });
  }
}

function anomalyAlertInsert(userId: string, input: AnomalyAlertMutationInput, now: string): AnomalyAlertInsert {
  const evidence = input.evidence ?? {};
  assertAssistantContextSafe(evidence);

  return {
    user_id: userId,
    reason_code: input.reasonCode,
    severity: input.severity,
    dedupe_key: input.dedupeKey,
    title: input.title,
    body: input.body,
    evidence,
    detected_at: input.detectedAt ?? now,
    first_seen_at: now,
    last_seen_at: now
  };
}

export async function createAnomalyAlerts(
  client: FinanceSupabaseClient,
  userId: string,
  inputs: readonly AnomalyAlertMutationInput[],
  options: { now?: Date } = {}
): Promise<AnomalyAlertRecord[]> {
  if (inputs.length === 0) return [];

  const now = (options.now ?? new Date()).toISOString();
  const result = await client
    .from("anomaly_alerts")
    .upsert(inputs.map((input) => anomalyAlertInsert(userId, input, now)), {
      ignoreDuplicates: true,
      onConflict: "user_id,dedupe_key"
    })
    .select("*");

  return expectData(result, "Create anomaly alerts").map(toAnomalyAlertRecord);
}

export async function listAnomalyAlerts(
  client: FinanceSupabaseClient,
  userId: string,
  filters: AnomalyAlertListFilters = {}
): Promise<AnomalyAlertRecord[]> {
  let query = client
    .from("anomaly_alerts")
    .select("*")
    .eq("user_id", userId)
    .order("detected_at", { ascending: false });

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  } else if (!filters.includeResolved) {
    query = query.eq("status", "pending");
  }
  if (filters.reasonCode) {
    query = query.eq("reason_code", filters.reasonCode);
  }
  if (filters.since) {
    query = query.gte(filters.sinceColumn ?? "updated_at", filters.since);
  }
  if (filters.limit !== undefined) {
    query = query.limit(filters.limit);
  }

  return expectData(await query, "List anomaly alerts").map(toAnomalyAlertRecord);
}

export async function refreshAnomalyAlerts(
  client: FinanceSupabaseClient,
  userId: string,
  alertIds: readonly string[],
  options: { now?: Date } = {}
): Promise<AnomalyAlertRecord[]> {
  if (alertIds.length === 0) return [];

  const now = (options.now ?? new Date()).toISOString();
  const update: AnomalyAlertUpdate = {
    last_seen_at: now,
    updated_at: now
  };
  const result = await client
    .from("anomaly_alerts")
    .update(update)
    .eq("user_id", userId)
    .in("id", [...alertIds])
    .select("*");

  return expectData(result, "Refresh anomaly alerts").map(toAnomalyAlertRecord);
}

export async function updateAnomalyAlertStatus(
  client: FinanceSupabaseClient,
  userId: string,
  alertId: string,
  status: AnomalyAlertStatus,
  options: { now?: Date } = {}
): Promise<AnomalyAlertRecord> {
  const now = (options.now ?? new Date()).toISOString();
  const update: AnomalyAlertUpdate = {
    status,
    dismissed_at: status === "dismissed" ? now : null,
    resolved_at: status === "resolved" ? now : null,
    updated_at: now
  };
  const result = await client
    .from("anomaly_alerts")
    .update(update)
    .eq("user_id", userId)
    .eq("id", alertId)
    .select("*")
    .single();

  return toAnomalyAlertRecord(expectData(result, "Update anomaly alert status"));
}

export async function createAgentProposal(
  client: FinanceSupabaseClient,
  userId: string,
  input: AgentProposalMutationInput
): Promise<AgentProposalRecord> {
  const evidence = input.evidence ?? {};
  const proposedPatch = input.proposedPatch ?? {};
  assertAgentProposalPayloadSafe(evidence, proposedPatch);

  const insert: AgentProposalInsert = {
    user_id: userId,
    proposal_type: input.proposalType,
    target_kind: input.targetKind,
    target_id: input.targetId,
    evidence,
    confidence: input.confidence ?? null,
    proposed_patch: proposedPatch,
    clarification_question: input.clarificationQuestion ?? null,
    question_fingerprint: input.questionFingerprint ?? null,
    source_agent: input.sourceAgent,
    source_candidate_id: input.sourceCandidateId ?? null,
    source_context_id: input.sourceContextId ?? null,
    expires_at: input.expiresAt ?? null
  };

  const result = await client
    .from("agent_proposals")
    .insert(insert)
    .select("*")
    .single();

  return toAgentProposalRecord(expectData(result, "Create agent proposal"));
}

export async function upsertAgentProposalBySourceContext(
  client: FinanceSupabaseClient,
  userId: string,
  input: AgentProposalMutationInput,
  options: { now?: Date } = {}
): Promise<AgentProposalRecord> {
  const sourceContextId = input.sourceContextId?.trim();
  if (!sourceContextId) {
    throw new FinanceDbError("Upsert agent proposal by source context", {
      message: "sourceContextId is required."
    });
  }

  const evidence = input.evidence ?? {};
  const proposedPatch = input.proposedPatch ?? {};
  assertAgentProposalPayloadSafe(evidence, proposedPatch);

  const upsert: AgentProposalInsert = {
    user_id: userId,
    clarification_question: input.clarificationQuestion ?? null,
    confidence: input.confidence ?? null,
    evidence,
    expires_at: input.expiresAt ?? null,
    proposal_type: input.proposalType,
    proposed_patch: proposedPatch,
    question_fingerprint: input.questionFingerprint ?? null,
    source_agent: input.sourceAgent,
    source_candidate_id: input.sourceCandidateId ?? null,
    source_context_id: sourceContextId,
    target_id: input.targetId,
    target_kind: input.targetKind,
    updated_at: (options.now ?? new Date()).toISOString()
  };

  const result = await client
    .from("agent_proposals")
    .upsert(upsert, { onConflict: "user_id,source_agent,source_context_id" })
    .select("*")
    .single();

  return toAgentProposalRecord(expectData(result, "Upsert agent proposal by source context"));
}

export async function listAgentProposals(
  client: FinanceSupabaseClient,
  userId: string,
  filters: AgentProposalListFilters = {}
): Promise<AgentProposalRecord[]> {
  let query = client
    .from("agent_proposals")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters.since) {
    query = query.gte("updated_at", filters.since);
  }

  const result = await query;
  if (result.error && isMissingRelationOrSchemaCacheError(result.error, "agent_proposals")) {
    return [];
  }

  const rows = expectData(result, "List agent proposals")
    .map(toAgentProposalRecord)
    .filter((proposal) => isVisibleAgentProposal(proposal, { includeExpired: filters.includeExpired }));

  return filters.limit === undefined ? rows : rows.slice(0, filters.limit);
}

export async function getAgentProposalById(
  client: FinanceSupabaseClient,
  userId: string,
  proposalId: string
): Promise<AgentProposalRecord | null> {
  const result = await client
    .from("agent_proposals")
    .select("*")
    .eq("user_id", userId)
    .eq("id", proposalId)
    .single();

  if (result.error) {
    if (isMissingSingleRowError(result.error)) return null;
    throw new FinanceDbError("Load agent proposal", result.error);
  }
  return result.data ? toAgentProposalRecord(result.data) : null;
}

async function updateAgentProposalStatus(
  client: FinanceSupabaseClient,
  userId: string,
  proposalId: string,
  update: AgentProposalUpdate,
  context: string
): Promise<AgentProposalRecord> {
  const result = await client
    .from("agent_proposals")
    .update(update)
    .eq("user_id", userId)
    .eq("id", proposalId)
    .select("*")
    .single();

  return toAgentProposalRecord(expectData(result, context));
}

export async function dismissAgentProposal(
  client: FinanceSupabaseClient,
  userId: string,
  proposalId: string,
  options: { actorId?: string | null; source?: string } = {}
): Promise<AgentProposalRecord> {
  const before = await getAgentProposalById(client, userId, proposalId);
  if (!before) {
    throw new FinanceDbError("Dismiss agent proposal", { message: "Agent proposal was not found." });
  }
  if (!canDismissAgentProposal(before.status)) {
    throw new FinanceDbError("Dismiss agent proposal", { message: "Agent proposal can no longer be dismissed." });
  }
  if (before.status === "dismissed") return before;

  const dismissed = await updateAgentProposalStatus(
    client,
    userId,
    proposalId,
    {
      dismissed_at: new Date().toISOString(),
      status: "dismissed"
    },
    "Dismiss agent proposal"
  );

  await recordAuditEvent(client, userId, {
    action: "agent_proposal.dismissed",
    actorId: options.actorId ?? userId,
    afterData: agentProposalAuditData(dismissed),
    beforeData: agentProposalAuditData(before),
    entityId: dismissed.id,
    entityTable: "agent_proposals",
    metadata: {
      proposalId: dismissed.id,
      source: options.source ?? "agent_proposal_store"
    }
  });

  return dismissed;
}

export async function recordClarificationAnswer(
  client: FinanceSupabaseClient,
  userId: string,
  proposalId: string,
  rawAnswer: string,
  options: { actorId?: string | null; source?: string } = {}
): Promise<AgentProposalRecord> {
  const before = await getAgentProposalById(client, userId, proposalId);
  if (!before) {
    throw new FinanceDbError("Record clarification answer", { message: "Agent proposal was not found." });
  }
  assertPendingAgentProposal(before, "Record clarification answer");
  if (!before.clarificationQuestion) {
    throw new FinanceDbError("Record clarification answer", { message: "Agent proposal is not asking a clarification question." });
  }

  const answer = normalizeAgentClarificationAnswer(rawAnswer);
  const answered = await updateAgentProposalStatus(
    client,
    userId,
    proposalId,
    {
      answered_at: new Date().toISOString(),
      clarification_answer: answer.rawAnswer,
      clarification_answer_kind: answer.answerKind,
      proposed_patch: {
        ...(isJsonObject(before.proposedPatch) ? before.proposedPatch : {}),
        counterparties: answer.counterparties
      },
      status: "answered"
    },
    "Record clarification answer"
  );

  await recordAuditEvent(client, userId, {
    action: "agent_proposal.clarification_answered",
    actorId: options.actorId ?? userId,
    afterData: agentProposalAuditData(answered),
    beforeData: agentProposalAuditData(before),
    entityId: answered.id,
    entityTable: "agent_proposals",
    metadata: {
      answerKind: answer.answerKind,
      proposalId: answered.id,
      source: options.source ?? "agent_proposal_store"
    }
  });

  return answered;
}

export async function acceptAgentProposal(
  client: FinanceSupabaseClient,
  userId: string,
  proposalId: string,
  options: AcceptAgentProposalOptions = {}
): Promise<AgentProposalRecord> {
  const before = await getAgentProposalById(client, userId, proposalId);
  if (!before) {
    throw new FinanceDbError("Accept agent proposal", { message: "Agent proposal was not found." });
  }
  assertPendingAgentProposal(before, "Accept agent proposal");

  if (before.proposalType === "review_suggestion") {
    if (before.targetKind !== "review_item") {
      throw new FinanceDbError("Accept review suggestion proposal", { message: "Review suggestions must target a review item." });
    }
    const review = await getReviewQueueItemById(client, userId, before.targetId);
    if (!review || review.status !== "open") {
      throw new FinanceDbError("Accept review suggestion proposal", { message: "Review item is no longer open." });
    }
    const patch = reviewSuggestionPatchFromProposal(before);
    await updateTransactionEnrichment(client, userId, review.transaction.id, {
      ...patch,
      reviewedAt: new Date().toISOString(),
      source: "ai"
    });
    await resolveReviewItem(
      client,
      userId,
      review.id,
      "resolved",
      "accepted_ai",
      "Accepted persisted agent proposal."
    );
  } else if (before.proposalType === "reimbursement_match") {
    const input = reimbursementMatchInputFromProposal(before);
    await linkReimbursementReceivedTransaction(client, userId, {
      ...input,
      actorId: options.actorId ?? userId,
      source: options.source ?? "agent_proposal_acceptance"
    });
  } else {
    throw new FinanceDbError("Accept agent proposal", { message: `Agent proposal type ${before.proposalType} does not have an acceptance path yet.` });
  }

  const accepted = await updateAgentProposalStatus(
    client,
    userId,
    proposalId,
    {
      accepted_at: new Date().toISOString(),
      status: "accepted"
    },
    "Accept agent proposal"
  );

  await recordAuditEvent(client, userId, {
    action: "agent_proposal.accepted",
    actorId: options.actorId ?? userId,
    afterData: agentProposalAuditData(accepted),
    beforeData: agentProposalAuditData(before),
    entityId: accepted.id,
    entityTable: "agent_proposals",
    metadata: {
      proposalId: accepted.id,
      source: options.source ?? "agent_proposal_store"
    }
  });

  return accepted;
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

async function getReimbursementRecordRow(
  client: FinanceSupabaseClient,
  userId: string,
  reimbursementId: string
): Promise<ReimbursementRecordRow> {
  const result = await client
    .from("reimbursement_records")
    .select("*")
    .eq("user_id", userId)
    .eq("id", reimbursementId)
    .single();

  return expectData(result, "Load reimbursement record");
}

async function listReimbursementRowsByReceivedTransactionId(
  client: FinanceSupabaseClient,
  userId: string,
  receivedTransactionId: string
): Promise<ReimbursementRecordRow[]> {
  const result = await client
    .from("reimbursement_records")
    .select("*")
    .eq("user_id", userId)
    .eq("received_transaction_id", receivedTransactionId);

  return expectData(result, "Load reimbursement records by received transaction");
}

export async function linkReimbursementReceivedTransaction(
  client: FinanceSupabaseClient,
  userId: string,
  input: LinkReimbursementInput
): Promise<ReimbursementRecord> {
  const before = await getReimbursementRecordRow(client, userId, input.reimbursementId);
  if (before.received_transaction_id) {
    throw new FinanceDbError("Link reimbursement received transaction", { message: "This reimbursement already has a linked received transaction." });
  }

  const receivedTransaction = await getTransactionById(client, userId, input.receivedTransactionId);

  if (!receivedTransaction) {
    throw new FinanceDbError("Link reimbursement received transaction", { message: "Received transaction was not found." });
  }
  if (receivedTransaction.intent === "transfer") {
    throw new FinanceDbError("Link reimbursement received transaction", { message: "Transfers cannot be linked as reimbursement income." });
  }
  const existingLinks = await listReimbursementRowsByReceivedTransactionId(client, userId, receivedTransaction.id);
  if (existingLinks.some((row) => row.id !== before.id)) {
    throw new FinanceDbError("Link reimbursement received transaction", { message: "This received transaction is already linked to another reimbursement." });
  }

  const decision = buildReimbursementLinkDecision(
    toReimbursementRecord(before),
    receivedTransaction,
    { appliedAmount: input.appliedAmount }
  );
  const update: ReimbursementRecordUpdate = {
    received_amount: decision.receivedAmount,
    received_at: decision.receivedAt,
    received_transaction_id: receivedTransaction.id,
    status: decision.status,
    updated_at: new Date().toISOString()
  };

  const result = await client
    .from("reimbursement_records")
    .update(update)
    .eq("user_id", userId)
    .eq("id", before.id)
    .select("*")
    .single();
  const after = expectData(result, "Update reimbursement received transaction");

  if (receivedTransaction.intent !== "reimbursable") {
    await updateTransactionEnrichment(client, userId, receivedTransaction.id, {
      intent: "reimbursable",
      source: "manual"
    });
  }

  await recordAuditEvent(client, userId, {
    action: "reimbursement.inflow_linked",
    actorId: input.actorId ?? userId,
    afterData: reimbursementAuditSnapshot(after),
    beforeData: reimbursementAuditSnapshot(before),
    entityId: after.id,
    entityTable: "reimbursement_records",
    metadata: {
      appliedAmount: decision.appliedAmount,
      outstandingAmount: decision.outstandingAmount,
      receivedTransactionAmount: receivedTransaction.amount,
      receivedTransactionId: receivedTransaction.id,
      receivedTransactionIntentBefore: receivedTransaction.intent,
      source: input.source ?? "reimbursement_link_helper",
      transactionId: after.enriched_transaction_id
    }
  });

  return toReimbursementRecord(after);
}

export async function unlinkReimbursementReceivedTransaction(
  client: FinanceSupabaseClient,
  userId: string,
  input: UnlinkReimbursementInput
): Promise<ReimbursementRecord> {
  const before = await getReimbursementRecordRow(client, userId, input.reimbursementId);
  const receivedTransactionId = before.received_transaction_id;
  const update: ReimbursementRecordUpdate = {
    received_amount: 0,
    received_at: null,
    received_transaction_id: null,
    status: "expected",
    updated_at: new Date().toISOString()
  };
  const result = await client
    .from("reimbursement_records")
    .update(update)
    .eq("user_id", userId)
    .eq("id", before.id)
    .select("*")
    .single();
  const after = expectData(result, "Unlink reimbursement received transaction");

  if (receivedTransactionId && input.restoredReceivedTransactionIntent) {
    await updateTransactionEnrichment(client, userId, receivedTransactionId, {
      intent: input.restoredReceivedTransactionIntent,
      source: "manual"
    });
  }

  await recordAuditEvent(client, userId, {
    action: "reimbursement.inflow_unlinked",
    actorId: input.actorId ?? userId,
    afterData: reimbursementAuditSnapshot(after),
    beforeData: reimbursementAuditSnapshot(before),
    entityId: after.id,
    entityTable: "reimbursement_records",
    metadata: {
      receivedTransactionId,
      restoredReceivedTransactionIntent: input.restoredReceivedTransactionIntent ?? null,
      source: input.source ?? "reimbursement_link_helper",
      transactionId: after.enriched_transaction_id
    }
  });

  return toReimbursementRecord(after);
}

export async function setReimbursementStatus(
  client: FinanceSupabaseClient,
  userId: string,
  input: SetReimbursementStatusInput
): Promise<ReimbursementRecord> {
  const before = await getReimbursementRecordRow(client, userId, input.reimbursementId);
  const transition = buildReimbursementStatusTransition(toReimbursementRecord(before), input.status);
  const beforeData = reimbursementAuditSnapshot(before);
  const previousStatus = before.status;

  const update: ReimbursementRecordUpdate = {
    status: transition.status,
    updated_at: new Date().toISOString()
  };

  const result = await client
    .from("reimbursement_records")
    .update(update)
    .eq("user_id", userId)
    .eq("id", before.id)
    .select("*")
    .single();
  const after = expectData(result, "Update reimbursement status");

  await recordAuditEvent(client, userId, {
    action: "reimbursement.status_changed",
    actorId: input.actorId ?? userId,
    afterData: reimbursementAuditSnapshot(after),
    beforeData,
    entityId: after.id,
    entityTable: "reimbursement_records",
    metadata: {
      previousStatus,
      source: input.source ?? "reimbursement_status_helper",
      status: transition.status,
      transactionId: after.enriched_transaction_id
    }
  });

  return toReimbursementRecord(after);
}

export interface AuditEventListFilters {
  entityTable?: string;
  actionPrefix?: string;
  fromDate?: string;
  toDate?: string;
  before?: string;
  searchText?: string;
  limit?: number;
}

export async function listAuditEvents(
  client: FinanceSupabaseClient,
  userId: string,
  filters: AuditEventListFilters = {}
): Promise<AuditEventRow[]> {
  let query = client
    .from("audit_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (filters.entityTable) {
    query = query.eq("entity_table", filters.entityTable);
  }
  if (filters.actionPrefix) {
    query = query.like("action", `${filters.actionPrefix}%`);
  }
  if (filters.fromDate) {
    query = query.gte("created_at", filters.fromDate);
  }
  if (filters.toDate) {
    query = query.lte("created_at", filters.toDate);
  }
  if (filters.before) {
    query = query.lt("created_at", filters.before);
  }
  if (filters.limit !== undefined) {
    query = query.limit(filters.limit);
  }

  const rows = expectData(await query, "List audit events");

  if (!filters.searchText) return rows;
  const needle = filters.searchText.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    row.action.toLowerCase().includes(needle) ||
    row.entity_table.toLowerCase().includes(needle) ||
    (row.entity_id?.toLowerCase().includes(needle) ?? false)
  );
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

  const auditClient = createServiceRoleClient(client) ?? client;
  const result = await auditClient
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
  resolutionKind: ReviewResolutionKind,
  resolutionNote?: string,
  options: { explanation?: string } = {}
): Promise<ReviewItemRecord> {
  const update: ReviewItemUpdate = {
    status,
    resolved_at: new Date().toISOString(),
    resolution_kind: resolutionKind,
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

async function listTransactionSplitRows(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string
): Promise<TransactionSplitRow[]> {
  const result = await client
    .from("transaction_splits")
    .select("*")
    .eq("user_id", userId)
    .eq("enriched_transaction_id", transactionId);

  return expectData(result, "Load transaction splits for replacement");
}

async function listReimbursementRowsByTransactionId(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string
): Promise<ReimbursementRecordRow[]> {
  const result = await client
    .from("reimbursement_records")
    .select("*")
    .eq("user_id", userId)
    .eq("enriched_transaction_id", transactionId);

  return expectData(result, "Load reimbursement records for transaction");
}

function splitMutationChanged(row: TransactionSplitRow, split: TransactionSplitMutationInput) {
  return (
    row.amount !== roundMoney(split.amount) ||
    row.category_id !== split.categoryId ||
    row.intent !== split.intent ||
    row.label !== split.label ||
    row.notes !== (split.notes ?? null)
  );
}

function reimbursementCanBeReplaced(row: ReimbursementRecordRow) {
  return (
    row.status === "expected" &&
    !row.received_transaction_id &&
    row.received_amount <= 0 &&
    !row.received_at
  );
}

function reimbursementExpectedNotes(split: TransactionSplitRecord) {
  return split.notes ?? "Expected reimbursement from reimbursable review split.";
}

function reimbursementCounterparty(split: TransactionSplitRecord) {
  return reimbursementCounterpartyFromLabel(split.label);
}

function reimbursementCounterpartyFromLabel(label: string) {
  const counterparty = label.replace(/^covered for\s+/i, "").trim();
  return counterparty || null;
}

function reimbursementExpectedUpdate(split: TransactionSplitRecord): ReimbursementRecordUpdate {
  return {
    counterparty: reimbursementCounterparty(split),
    expected_amount: roundMoney(Math.abs(split.amount)),
    notes: reimbursementExpectedNotes(split),
    updated_at: new Date().toISOString()
  };
}

function reimbursementExpectedChanged(row: ReimbursementRecordRow, update: ReimbursementRecordUpdate) {
  return (
    row.counterparty !== update.counterparty ||
    row.expected_amount !== update.expected_amount ||
    row.notes !== update.notes
  );
}

function assertReimbursementCanFollowSplitChange(row: ReimbursementRecordRow) {
  if (reimbursementCanBeReplaced(row)) return;
  throw new FinanceDbError("Sync split reimbursements", {
    message: "This split already has reimbursement history. Unlink or resolve that reimbursement before changing the split."
  });
}

function splitMutationChangesReimbursementFields(row: TransactionSplitRow, split: TransactionSplitMutationInput) {
  return (
    row.amount !== roundMoney(split.amount) ||
    row.intent !== split.intent ||
    row.label !== split.label ||
    row.notes !== (split.notes ?? null)
  );
}

function assertUniqueSubmittedSplitIds(splits: TransactionSplitMutationInput[]) {
  const seen = new Set<string>();
  for (const split of splits) {
    if (!split.id) continue;
    if (seen.has(split.id)) {
      throw new FinanceDbError("Replace transaction splits", {
        message: "Split rows cannot reuse the same split id."
      });
    }
    seen.add(split.id);
  }
}

async function recordReimbursementAuditEvent(
  client: FinanceSupabaseClient,
  userId: string,
  action: "reimbursement.expected_created" | "reimbursement.expected_updated" | "reimbursement.expected_removed",
  input: {
    after?: ReimbursementRecordRow | null;
    before?: ReimbursementRecordRow | null;
    options: ReimbursementSplitSyncOptions;
    split?: TransactionSplitRecord | null;
    transactionId: string;
  }
) {
  const row = input.after ?? input.before;
  await recordAuditEvent(client, userId, {
    action,
    actorId: input.options.actorId ?? userId,
    afterData: input.after ? reimbursementAuditSnapshot(input.after) : null,
    beforeData: input.before ? reimbursementAuditSnapshot(input.before) : null,
    entityId: row?.id ?? null,
    entityTable: "reimbursement_records",
    metadata: {
      source: input.options.source ?? "review_peer_to_peer_split_resolution",
      splitId: input.split?.id ?? row?.split_id ?? null,
      splitLabel: input.split?.label ?? null,
      transactionId: input.transactionId
    }
  });
}

async function removeExpectedSplitReimbursement(
  client: FinanceSupabaseClient,
  userId: string,
  row: ReimbursementRecordRow,
  input: {
    options: ReimbursementSplitSyncOptions;
    split?: TransactionSplitRecord | null;
    transactionId: string;
  }
) {
  assertReimbursementCanFollowSplitChange(row);

  const result = await client
    .from("reimbursement_records")
    .delete()
    .eq("user_id", userId)
    .eq("id", row.id);

  if (result.error) {
    throw new FinanceDbError("Remove expected split reimbursement", result.error);
  }

  await recordReimbursementAuditEvent(client, userId, "reimbursement.expected_removed", {
    before: row,
    options: input.options,
    split: input.split ?? null,
    transactionId: input.transactionId
  });
}

async function syncExpectedSplitReimbursements(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string,
  splits: TransactionSplitRecord[],
  options: ReimbursementSplitSyncOptions
) {
  const rows = await listReimbursementRowsByTransactionId(client, userId, transactionId);
  const rowBySplitId = new Map(rows.flatMap((row) => (row.split_id ? [[row.split_id, row]] : [])));
  const savedSplitIds = new Set(splits.map((split) => split.id));

  for (const row of rows) {
    if (!row.split_id || savedSplitIds.has(row.split_id)) continue;
    await removeExpectedSplitReimbursement(client, userId, row, {
      options,
      split: null,
      transactionId
    });
  }

  for (const split of splits) {
    const existing = rowBySplitId.get(split.id);
    if (split.intent !== "reimbursable") {
      if (existing) {
        await removeExpectedSplitReimbursement(client, userId, existing, {
          options,
          split,
          transactionId
        });
      }
      continue;
    }

    if (existing) {
      const update = reimbursementExpectedUpdate(split);
      if (!reimbursementExpectedChanged(existing, update)) continue;
      if (!reimbursementCanBeReplaced(existing)) continue;

      const result = await client
        .from("reimbursement_records")
        .update(update)
        .eq("user_id", userId)
        .eq("id", existing.id)
        .select("*")
        .single();
      const after = expectData(result, "Update expected split reimbursement");

      await recordReimbursementAuditEvent(client, userId, "reimbursement.expected_updated", {
        after,
        before: existing,
        options,
        split,
        transactionId
      });
      continue;
    }

    const insert: ReimbursementRecordInsert = {
      counterparty: reimbursementCounterparty(split),
      enriched_transaction_id: transactionId,
      expected_amount: roundMoney(Math.abs(split.amount)),
      notes: reimbursementExpectedNotes(split),
      received_amount: 0,
      split_id: split.id,
      status: "expected",
      user_id: userId
    };
    const result = await client
      .from("reimbursement_records")
      .insert(insert)
      .select("*")
      .single();
    const after = expectData(result, "Create expected split reimbursement");

    await recordReimbursementAuditEvent(client, userId, "reimbursement.expected_created", {
      after,
      options,
      split,
      transactionId
    });
  }
}

async function replaceTransactionSplitRows(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string,
  splits: TransactionSplitMutationInput[]
): Promise<TransactionSplitRow[]> {
  const existingRows = await listTransactionSplitRows(client, userId, transactionId);
  const existingById = byId(existingRows);
  const submittedExistingIds = new Set(
    splits
      .map((split) => split.id)
      .filter((id): id is string => Boolean(id && existingById.has(id)))
  );

  for (const row of existingRows) {
    if (submittedExistingIds.has(row.id)) continue;
    const deleteResult = await client
      .from("transaction_splits")
      .delete()
      .eq("user_id", userId)
      .eq("enriched_transaction_id", transactionId)
      .eq("id", row.id);

    if (deleteResult.error) {
      throw new FinanceDbError("Delete removed transaction split", deleteResult.error);
    }
  }

  const rows: TransactionSplitRow[] = [];

  for (const split of splits) {
    const existing = split.id ? existingById.get(split.id) : undefined;
    if (existing) {
      if (!splitMutationChanged(existing, split)) {
        rows.push(existing);
        continue;
      }

      const update: TransactionSplitUpdate = {
        amount: roundMoney(split.amount),
        category_id: split.categoryId,
        intent: split.intent,
        label: split.label,
        notes: split.notes ?? null,
        updated_at: new Date().toISOString()
      };
      const result = await client
        .from("transaction_splits")
        .update(update)
        .eq("user_id", userId)
        .eq("enriched_transaction_id", transactionId)
        .eq("id", existing.id)
        .select("*")
        .single();
      rows.push(expectData(result, "Update transaction split"));
      continue;
    }

    const insert: TransactionSplitInsert = {
      amount: roundMoney(split.amount),
      category_id: split.categoryId,
      enriched_transaction_id: transactionId,
      intent: split.intent,
      label: split.label,
      notes: split.notes ?? null,
      user_id: userId
    };
    const result = await client
      .from("transaction_splits")
      .insert(insert)
      .select("*")
      .single();
    rows.push(expectData(result, "Insert transaction split"));
  }

  return rows;
}

async function hydrateSplitRows(
  client: FinanceSupabaseClient,
  userId: string,
  rows: TransactionSplitRow[]
): Promise<TransactionSplitRecord[]> {
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

async function guardRemovedSplitReimbursements(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string,
  splits: TransactionSplitMutationInput[],
  options: ReimbursementSplitSyncOptions
) {
  const existingRows = await listTransactionSplitRows(client, userId, transactionId);
  const existingById = byId(existingRows);
  const submittedExistingIds = new Set(
    splits
      .map((split) => split.id)
      .filter((id): id is string => Boolean(id && existingById.has(id)))
  );
  const removedRows = existingRows.filter((row) => !submittedExistingIds.has(row.id));
  if (removedRows.length === 0) return;

  const reimbursements = await listReimbursementRowsByTransactionId(client, userId, transactionId);
  const reimbursementBySplitId = new Map(
    reimbursements.flatMap((row) => (row.split_id ? [[row.split_id, row]] : []))
  );
  const removals = removedRows
    .map((row) => ({
      reimbursement: reimbursementBySplitId.get(row.id),
      split: toSplitRecord(row)
    }))
    .filter((item): item is { reimbursement: ReimbursementRecordRow; split: TransactionSplitRecord } =>
      item.reimbursement !== undefined
    );

  removals.forEach(({ reimbursement }) => assertReimbursementCanFollowSplitChange(reimbursement));

  for (const { reimbursement, split } of removals) {
    await removeExpectedSplitReimbursement(client, userId, reimbursement, {
      options,
      split,
      transactionId
    });
  }
}

async function guardChangedSplitReimbursements(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string,
  splits: TransactionSplitMutationInput[]
) {
  const submittedIds = unique(splits.map((split) => split.id));
  if (submittedIds.length === 0) return;

  const existingRows = await listTransactionSplitRows(client, userId, transactionId);
  const existingById = byId(existingRows);
  const reimbursements = await listReimbursementRowsByTransactionId(client, userId, transactionId);
  const reimbursementBySplitId = new Map(
    reimbursements.flatMap((row) => (row.split_id ? [[row.split_id, row]] : []))
  );

  for (const split of splits) {
    if (!split.id) continue;
    const existingSplit = existingById.get(split.id);
    if (!existingSplit || !splitMutationChangesReimbursementFields(existingSplit, split)) continue;
    const reimbursement = reimbursementBySplitId.get(split.id);
    if (!reimbursement || reimbursementCanBeReplaced(reimbursement)) continue;
    assertReimbursementCanFollowSplitChange(reimbursement);
  }
}

export async function replaceTransactionSplits(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string,
  splits: TransactionSplitMutationInput[]
): Promise<TransactionSplitRecord[]> {
  assertUniqueSubmittedSplitIds(splits);
  const rows = await replaceTransactionSplitRows(client, userId, transactionId, splits);
  return hydrateSplitRows(client, userId, rows);
}

export async function replaceTransactionSplitsAndSyncReimbursements(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string,
  splits: TransactionSplitMutationInput[],
  options: ReimbursementSplitSyncOptions = {}
): Promise<TransactionSplitRecord[]> {
  assertUniqueSubmittedSplitIds(splits);
  await guardChangedSplitReimbursements(client, userId, transactionId, splits);
  await guardRemovedSplitReimbursements(client, userId, transactionId, splits, options);
  const rows = await replaceTransactionSplitRows(client, userId, transactionId, splits);
  const savedSplits = await hydrateSplitRows(client, userId, rows);
  await syncExpectedSplitReimbursements(client, userId, transactionId, savedSplits, options);
  return savedSplits;
}

export function asJsonObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
