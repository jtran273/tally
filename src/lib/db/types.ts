export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AccountType = "depository" | "credit" | "investment" | "retirement";
export type PlaidItemStatus = "active" | "error" | "revoked";
export type GoogleCalendarConnectionStatus = "active" | "error" | "revoked";
export type PlaidSyncRunSource = "initial" | "manual" | "opportunistic" | "scheduled";
export type PlaidSyncRunStatus = "running" | "succeeded" | "partial" | "failed";
export type TransactionStatus = "pending" | "posted";
export type TransactionIntent = "personal" | "business" | "shared" | "reimbursable" | "transfer";
export type ReviewReason =
  | "venmo"
  | "large"
  | "transfer-pair"
  | "new-recurring"
  | "low-confidence"
  | "missing-category"
  | "unclear-transfer"
  | "recurring-candidate";
export type ReviewStatus = "open" | "resolved" | "dismissed";
export type RecurringCadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
export type RecurringStatus = "active" | "pending" | "paused" | "dismissed";
export type ReimbursementStatus = "expected" | "requested" | "received" | "written-off";
export type InsightTone = "info" | "warn" | "ok";
export type AgentProposalStatus = "pending" | "accepted" | "dismissed" | "expired" | "answered";
export type AgentProposalType =
  | "review_suggestion"
  | "merchant_rule"
  | "possible_reimbursable_expense"
  | "reimbursement_candidate"
  | "reimbursement_match"
  | "safe_to_spend_warning"
  | "clarification_request"
  | "openclaw_briefing";
export type AgentTargetKind =
  | "review_item"
  | "enriched_transaction"
  | "reimbursement_record"
  | "merchant_rule"
  | "recurring_expense"
  | "openclaw_briefing";

type DbInsert<Row extends { user_id: string }> = Partial<Row> & Pick<Row, "user_id">;
type DbUpdate<Row> = Partial<Omit<Row, "id" | "user_id" | "created_at" | "first_seen_at">>;
type TableDefinition<Row extends { user_id: string }> = {
  Row: Row;
  Insert: DbInsert<Row>;
  Update: DbUpdate<Row>;
  Relationships: [];
};

export interface InstitutionRow {
  id: string;
  user_id: string;
  name: string;
  plaid_institution_id: string | null;
  logo_url: string | null;
  primary_color: string | null;
  website_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaidItemRow {
  id: string;
  user_id: string;
  institution_id: string;
  plaid_item_id: string;
  access_token_ciphertext: string;
  status: PlaidItemStatus;
  available_products: string[];
  billed_products: string[];
  error_code: string | null;
  error_message: string | null;
  consent_expires_at: string | null;
  last_successful_sync_at: string | null;
  transaction_cursor: string | null;
  auto_sync_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarConnectionRow {
  id: string;
  user_id: string;
  google_calendar_id: string;
  calendar_summary: string | null;
  calendar_list: Json;
  selected_calendar_ids: string[];
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  scope: string;
  token_type: string;
  expires_at: string;
  status: GoogleCalendarConnectionStatus;
  error_code: string | null;
  error_message: string | null;
  last_successful_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountRow {
  id: string;
  user_id: string;
  institution_id: string;
  plaid_item_id: string;
  plaid_account_id: string;
  name: string;
  official_name: string | null;
  type: AccountType;
  subtype: string | null;
  mask: string | null;
  current_balance: number;
  available_balance: number | null;
  credit_limit: number | null;
  iso_currency_code: string;
  color: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaidSyncRunRow {
  id: string;
  user_id: string;
  source: PlaidSyncRunSource;
  status: PlaidSyncRunStatus;
  started_at: string;
  completed_at: string | null;
  total_items: number;
  succeeded_items: number;
  failed_items: number;
  accounts_upserted: number;
  balance_snapshots_upserted: number;
  raw_transactions_upserted: number;
  raw_transactions_skipped: number;
  enriched_transactions_inserted: number;
  enriched_transactions_updated: number;
  transactions_removed: number;
  safe_error_code: string | null;
  safe_error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaidSyncRunItemRow {
  id: string;
  user_id: string;
  sync_run_id: string;
  plaid_item_id: string;
  status: Exclude<PlaidSyncRunStatus, "running" | "partial">;
  started_at: string;
  completed_at: string;
  accounts_upserted: number;
  balance_snapshots_upserted: number;
  raw_transactions_upserted: number;
  raw_transactions_skipped: number;
  enriched_transactions_inserted: number;
  enriched_transactions_updated: number;
  transactions_removed: number;
  safe_error_code: string | null;
  safe_error_message: string | null;
  last_successful_sync_at: string | null;
  created_at: string;
}

export interface BalanceSnapshotRow {
  id: string;
  user_id: string;
  account_id: string;
  snapshot_date: string;
  current_balance: number;
  available_balance: number | null;
  credit_limit: number | null;
  iso_currency_code: string;
  source: string;
  created_at: string;
}

export interface CategoryRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface RawTransactionRow {
  id: string;
  user_id: string;
  account_id: string;
  plaid_item_id: string;
  plaid_transaction_id: string;
  date: string;
  authorized_date: string | null;
  datetime: string | null;
  authorized_datetime: string | null;
  name: string;
  merchant_name: string | null;
  amount: number;
  iso_currency_code: string;
  status: TransactionStatus;
  pending_transaction_id: string | null;
  payment_channel: string | null;
  plaid_category: string | null;
  plaid_category_id: string | null;
  transaction_type: string | null;
  location: Json;
  payment_meta: Json;
  raw_payload: Json;
  first_seen_at: string;
  updated_at: string;
}

export interface EnrichedTransactionRow {
  id: string;
  user_id: string;
  raw_transaction_id: string;
  account_id: string;
  category_id: string | null;
  date: string;
  merchant_name: string;
  category_name: string;
  intent: TransactionIntent;
  amount: number;
  status: TransactionStatus;
  confidence: number;
  note: string;
  is_recurring: boolean;
  reviewed_at: string | null;
  source: "seed" | "plaid" | "manual" | "rule" | "ai";
  created_at: string;
  updated_at: string;
}

export interface MerchantRuleRow {
  id: string;
  user_id: string;
  merchant_pattern: string;
  normalized_merchant_name: string | null;
  category_id: string | null;
  intent: TransactionIntent | null;
  is_recurring: boolean | null;
  min_amount: number | null;
  max_amount: number | null;
  priority: number;
  enabled: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewItemRow {
  id: string;
  user_id: string;
  enriched_transaction_id: string;
  reason: ReviewReason;
  status: ReviewStatus;
  explanation: string;
  ai_suggestion: Json;
  confidence: number | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionSplitRow {
  id: string;
  user_id: string;
  enriched_transaction_id: string;
  category_id: string | null;
  label: string;
  intent: TransactionIntent;
  amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringExpenseRow {
  id: string;
  user_id: string;
  merchant_rule_id: string | null;
  category_id: string | null;
  account_id: string | null;
  last_transaction_id: string | null;
  merchant_name: string;
  amount: number;
  cadence: RecurringCadence;
  next_due_date: string;
  last_charge_date: string | null;
  last_amount: number | null;
  status: RecurringStatus;
  is_new: boolean;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface ReimbursementRecordRow {
  id: string;
  user_id: string;
  enriched_transaction_id: string;
  split_id: string | null;
  received_transaction_id: string | null;
  counterparty: string | null;
  expected_amount: number;
  received_amount: number;
  status: ReimbursementStatus;
  due_date: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsightRow {
  id: string;
  user_id: string;
  insight_key: string;
  title: string;
  body: string;
  tone: InsightTone;
  action_label: string | null;
  payload: Json;
  status: "active" | "dismissed" | "expired";
  generated_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentProposalRow {
  id: string;
  user_id: string;
  proposal_type: AgentProposalType;
  target_kind: AgentTargetKind;
  target_id: string;
  evidence: Json;
  confidence: number | null;
  proposed_patch: Json;
  status: AgentProposalStatus;
  clarification_question: string | null;
  clarification_answer: string | null;
  clarification_answer_kind: string | null;
  question_fingerprint: string | null;
  source_context_id: string | null;
  source_candidate_id: string | null;
  source_agent: string;
  expires_at: string | null;
  accepted_at: string | null;
  dismissed_at: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEventRow {
  id: string;
  user_id: string;
  entity_table: string;
  entity_id: string | null;
  action: string;
  actor_id: string | null;
  before_data: Json | null;
  after_data: Json | null;
  metadata: Json;
  created_at: string;
}

export type Database = {
  public: {
    Tables: {
      institutions: TableDefinition<InstitutionRow>;
      plaid_items: TableDefinition<PlaidItemRow>;
      google_calendar_connections: TableDefinition<GoogleCalendarConnectionRow>;
      plaid_sync_runs: TableDefinition<PlaidSyncRunRow>;
      plaid_sync_run_items: TableDefinition<PlaidSyncRunItemRow>;
      accounts: TableDefinition<AccountRow>;
      balance_snapshots: TableDefinition<BalanceSnapshotRow>;
      categories: TableDefinition<CategoryRow>;
      raw_transactions: TableDefinition<RawTransactionRow>;
      enriched_transactions: TableDefinition<EnrichedTransactionRow>;
      merchant_rules: TableDefinition<MerchantRuleRow>;
      review_items: TableDefinition<ReviewItemRow>;
      transaction_splits: TableDefinition<TransactionSplitRow>;
      recurring_expenses: TableDefinition<RecurringExpenseRow>;
      reimbursement_records: TableDefinition<ReimbursementRecordRow>;
      insights: TableDefinition<InsightRow>;
      agent_proposals: TableDefinition<AgentProposalRow>;
      audit_events: TableDefinition<AuditEventRow>;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      account_type: AccountType;
      plaid_item_status: PlaidItemStatus;
      plaid_sync_run_source: PlaidSyncRunSource;
      plaid_sync_run_status: PlaidSyncRunStatus;
      transaction_status: TransactionStatus;
      transaction_intent: TransactionIntent;
      review_reason: ReviewReason;
      review_status: ReviewStatus;
      recurring_cadence: RecurringCadence;
      recurring_status: RecurringStatus;
      reimbursement_status: ReimbursementStatus;
      insight_tone: InsightTone;
      agent_proposal_status: AgentProposalStatus;
      agent_proposal_type: AgentProposalType;
      agent_target_kind: AgentTargetKind;
    };
    CompositeTypes: Record<never, never>;
  };
};

export interface AccountRecord {
  id: string;
  userId: string;
  institutionId: string;
  institutionName: string;
  plaidAccountId: string;
  name: string;
  officialName: string | null;
  type: AccountType;
  subtype: string | null;
  mask: string | null;
  balance: number;
  availableBalance: number | null;
  creditLimit: number | null;
  currency: string;
  color: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  manualValuation?: ManualInvestmentValuationRecord;
}

export interface ManualInvestmentValuationRecord {
  accountId: string;
  asOf: string;
  cash: number;
  holdings: ManualInvestmentHoldingRecord[];
  source: "manual_holdings";
  staleSymbols: string[];
  totalValue: number;
}

export interface ManualInvestmentHoldingRecord {
  symbol: string;
  shares: number;
  price: number;
  value: number;
}

export interface CategoryRecord {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  isSystem: boolean;
}

export interface TransactionSplitRecord {
  id: string;
  transactionId: string;
  categoryId: string | null;
  categoryName: string | null;
  label: string;
  intent: TransactionIntent;
  amount: number;
  notes: string | null;
}

export interface ReimbursementRecord {
  id: string;
  transactionId: string;
  splitId: string | null;
  receivedTransactionId: string | null;
  counterparty: string | null;
  expectedAmount: number;
  receivedAmount: number;
  status: ReimbursementStatus;
  dueDate: string | null;
  receivedAt: string | null;
  notes: string | null;
}

export interface ReviewItemRecord {
  id: string;
  transactionId: string;
  reason: ReviewReason;
  status: ReviewStatus;
  explanation: string;
  aiSuggestion: Json;
  confidence: number | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  rawTransactionId: string;
  plaidTransactionId: string | null;
  accountId: string;
  accountName: string;
  accountMask: string | null;
  institutionName: string;
  date: string;
  merchant: string;
  amount: number;
  categoryId: string | null;
  category: string;
  intent: TransactionIntent;
  status: TransactionStatus;
  confidence: number;
  reviewReason: ReviewReason | null;
  reviewStatus: ReviewStatus | null;
  reviewItems: ReviewItemRecord[];
  plaidCategory: string | null;
  plaidMerchant: string | null;
  plaidName: string | null;
  note: string;
  recurring: boolean;
  splits: TransactionSplitRecord[];
  reimbursements: ReimbursementRecord[];
  reviewedAt: string | null;
}

export interface ReviewQueueItem extends ReviewItemRecord {
  transaction: TransactionRecord;
}

export interface AgentProposalRecord {
  id: string;
  userId: string;
  proposalType: AgentProposalType;
  targetKind: AgentTargetKind;
  targetId: string;
  evidence: Json;
  confidence: number | null;
  proposedPatch: Json;
  status: AgentProposalStatus;
  clarificationQuestion: string | null;
  clarificationAnswer: string | null;
  clarificationAnswerKind: string | null;
  questionFingerprint: string | null;
  sourceContextId: string | null;
  sourceCandidateId: string | null;
  sourceAgent: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  dismissedAt: string | null;
  answeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringExpenseRecord {
  id: string;
  merchant: string;
  amount: number;
  cadence: RecurringCadence;
  categoryId: string | null;
  category: string | null;
  accountId: string | null;
  accountName: string | null;
  nextDueDate: string;
  lastChargeDate: string | null;
  lastAmount: number | null;
  status: RecurringStatus;
  isNew: boolean;
  confidence: number | null;
}

export interface BalanceSnapshotRecord {
  id: string;
  accountId: string;
  snapshotDate: string;
  currentBalance: number;
  availableBalance: number | null;
  creditLimit: number | null;
  currency: string;
  source: string;
}

export interface InsightRecord {
  id: string;
  key: string;
  title: string;
  body: string;
  tone: InsightTone;
  actionLabel: string | null;
  payload: Json;
  generatedAt: string;
  expiresAt: string | null;
}

export interface FinanceDashboardTotals {
  cash: number;
  credit: number;
  investments: number;
  retirement: number;
  netWorth: number;
}

export interface FinanceDashboardData {
  totals: FinanceDashboardTotals;
  accounts: AccountRecord[];
  recentTransactions: TransactionRecord[];
  reviewItems: ReviewQueueItem[];
  recurringExpenses: RecurringExpenseRecord[];
  insights: InsightRecord[];
}
