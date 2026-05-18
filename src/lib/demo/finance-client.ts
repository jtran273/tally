import { BASE_DATE, ledgerData, type LedgerTransaction } from "@/components/ledger/data";
import type {
  AccountRow,
  AgentProposalRow,
  AuditEventRow,
  BalanceSnapshotRow,
  CategoryRow,
  Database,
  EnrichedTransactionRow,
  FinanceSupabaseClient,
  GoogleCalendarConnectionRow,
  InstitutionRow,
  InsightRow,
  Json,
  PlaidItemRow,
  PlaidSyncRunItemRow,
  PlaidSyncRunRow,
  RawTransactionRow,
  RecurringCadence,
  RecurringExpenseRow,
  ReimbursementRecordRow,
  ReviewItemRow,
  TransactionSplitRow
} from "@/lib/db";
import { getPlaidConnectionIssue } from "@/lib/plaid/status";

export const DEMO_USER_ID = "demo-user";

type FinanceTables = Database["public"]["Tables"];
type FinanceTableName = Extract<keyof FinanceTables, string>;
type TableRow<Table extends FinanceTableName> = FinanceTables[Table]["Row"];
type QueryError = { message: string };
type QueryResult<Row> = { data: Row[] | Row | null; error: QueryError | null };

const DAY_MS = 86_400_000;
const NOW = BASE_DATE.toISOString();
const EMPTY_JSON: Json = {};
const DEFAULT_CATEGORY_NAMES = ["Auto / Car Maintenance", "Education", "Entertainment"];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isoDaysFromBase(daysFromBase: number) {
  return new Date(BASE_DATE.getTime() + daysFromBase * DAY_MS).toISOString().slice(0, 10);
}

function institutionId(name: string) {
  return `demo-inst-${slug(name)}`;
}

function categoryId(name: string) {
  return `demo-cat-${slug(name)}`;
}

function reviewReason(transaction: LedgerTransaction) {
  if (transaction.reviewReason === "low-confidence") return "low-confidence";
  return transaction.reviewReason;
}

function cadence(value: string): RecurringCadence {
  if (value === "weekly" || value === "annual") return value;
  return "monthly";
}

const institutions: InstitutionRow[] = [...new Set(ledgerData.accounts.map((account) => account.institution))].map(
  (name) => ({
    created_at: NOW,
    id: institutionId(name),
    logo_url: null,
    name,
    plaid_institution_id: `ins_${slug(name)}`,
    primary_color: null,
    updated_at: NOW,
    user_id: DEMO_USER_ID,
    website_url: null
  })
);

const plaidItems: PlaidItemRow[] = institutions.map((institution) => ({
  access_token_ciphertext: "demo-token",
  available_products: ["transactions"],
  billed_products: ["transactions"],
  consent_expires_at: null,
  created_at: NOW,
  error_code: null,
  error_message: null,
  id: `demo-item-${slug(institution.name)}`,
  institution_id: institution.id,
  last_successful_sync_at: NOW,
  plaid_item_id: `item_${slug(institution.name)}`,
  status: "active",
  transaction_cursor: "demo-cursor",
  updated_at: NOW,
  user_id: DEMO_USER_ID
}));

const itemByInstitution = new Map(plaidItems.map((item) => [item.institution_id, item]));

const accounts: AccountRow[] = ledgerData.accounts.map((account) => {
  const instId = institutionId(account.institution);
  return {
    available_balance: account.type === "credit" ? null : account.balance,
    color: account.color,
    created_at: NOW,
    credit_limit: account.limit ?? null,
    current_balance: account.balance,
    id: account.id,
    institution_id: instId,
    is_active: true,
    iso_currency_code: "USD",
    last_synced_at: NOW,
    mask: account.mask,
    name: account.name,
    official_name: account.name,
    plaid_account_id: `plaid-${account.id}`,
    plaid_item_id: itemByInstitution.get(instId)?.id ?? plaidItems[0]?.id ?? "demo-item",
    subtype: account.type === "depository" ? "checking" : account.type === "credit" ? "credit card" : null,
    type: account.type,
    updated_at: NOW,
    user_id: DEMO_USER_ID
  };
});

const categories: CategoryRow[] = [
  ...new Set([
    ...ledgerData.txns.map((transaction) => transaction.category),
    ...ledgerData.recurring.map((expense) => expense.category),
    ...DEFAULT_CATEGORY_NAMES
  ])
].map(
  (name) => ({
    color: null,
    created_at: NOW,
    icon: null,
    id: categoryId(name),
    is_system: true,
    name,
    parent_id: null,
    updated_at: NOW,
    user_id: DEMO_USER_ID
  })
);

const rawTransactions: RawTransactionRow[] = ledgerData.txns.map((transaction) => ({
  amount: transaction.amount,
  authorized_date: transaction.date,
  authorized_datetime: null,
  date: transaction.date,
  datetime: null,
  first_seen_at: `${transaction.date}T12:00:00.000Z`,
  id: `raw-${transaction.id}`,
  iso_currency_code: "USD",
  location: EMPTY_JSON,
  merchant_name: transaction.plaidMerchant,
  name: transaction.plaidMerchant,
  payment_channel: "online",
  payment_meta: EMPTY_JSON,
  pending_transaction_id: null,
  plaid_category: transaction.plaidCategory,
  plaid_category_id: null,
  plaid_item_id: accounts.find((account) => account.id === transaction.account)?.plaid_item_id ?? "demo-item",
  plaid_transaction_id: `plaid-${transaction.id}`,
  raw_payload: EMPTY_JSON,
  status: transaction.status,
  transaction_type: "place",
  updated_at: NOW,
  user_id: DEMO_USER_ID,
  account_id: transaction.account
}));

const enrichedTransactions: EnrichedTransactionRow[] = ledgerData.txns.map((transaction) => ({
  account_id: transaction.account,
  amount: transaction.amount,
  category_id: categoryId(transaction.category),
  category_name: transaction.category,
  confidence: transaction.confidence,
  created_at: `${transaction.date}T12:00:00.000Z`,
  date: transaction.date,
  id: transaction.id,
  intent: transaction.intent,
  is_recurring: transaction.recurring,
  merchant_name: transaction.merchant,
  note: transaction.note,
  raw_transaction_id: `raw-${transaction.id}`,
  reviewed_at: transaction.reviewReason ? null : `${transaction.date}T13:00:00.000Z`,
  source: "seed",
  status: transaction.status,
  updated_at: NOW,
  user_id: DEMO_USER_ID
}));

const reviewItems: ReviewItemRow[] = ledgerData.txns.flatMap((transaction) => {
  const reason = reviewReason(transaction);
  if (!reason) return [];

  return [{
    ai_suggestion: transaction.aiSuggested ? transaction.aiSuggested as Json : {},
    confidence: transaction.aiSuggested?.confidence ?? transaction.confidence,
    created_at: `${transaction.date}T14:00:00.000Z`,
    enriched_transaction_id: transaction.id,
    explanation: transaction.aiSuggested?.reason ?? "Demo data flagged this transaction for review.",
    id: `demo-review-${transaction.id}`,
    reason,
    resolution_note: null,
    resolved_at: null,
    status: "open",
    updated_at: NOW,
    user_id: DEMO_USER_ID
  }];
});

const transactionSplits: TransactionSplitRow[] = ledgerData.txns.flatMap((transaction) =>
  (transaction.split ?? []).map((split) => ({
    amount: split.amount,
    category_id: categoryId(split.category),
    created_at: NOW,
    enriched_transaction_id: transaction.id,
    id: split.id,
    intent: split.intent,
    label: split.label,
    notes: null,
    updated_at: NOW,
    user_id: DEMO_USER_ID
  }))
);

const reimbursementRecords: ReimbursementRecordRow[] = [
  ...transactionSplits
    .filter((split) => split.intent === "reimbursable")
    .map((split) => ({
      counterparty: split.label.replace(/^covered for\s+/i, "") || null,
      created_at: NOW,
      due_date: isoDaysFromBase(12),
      enriched_transaction_id: split.enriched_transaction_id,
      expected_amount: split.amount,
      id: `demo-reimbursement-${split.id}`,
      notes: "Demo reimbursement tracked from a reimbursable split.",
      received_amount: 0,
      received_at: null,
      received_transaction_id: null,
      split_id: split.id,
      status: "expected" as const,
      updated_at: NOW,
      user_id: DEMO_USER_ID
    })),
  {
    counterparty: "Chris L.",
    created_at: NOW,
    due_date: isoDaysFromBase(12),
    enriched_transaction_id: "t28",
    expected_amount: 60,
    id: "demo-reimbursement-t28-chris",
    notes: "Demo reimbursement awaiting approval from an incoming payment.",
    received_amount: 0,
    received_at: null,
    received_transaction_id: null,
    split_id: null,
    status: "expected",
    updated_at: NOW,
    user_id: DEMO_USER_ID
  }
];

const recurringExpenses: RecurringExpenseRow[] = ledgerData.recurring.map((expense) => ({
  account_id: accounts.find((account) => account.type === "credit")?.id ?? null,
  amount: expense.amount,
  cadence: cadence(expense.cadence),
  category_id: categoryId(expense.category),
  confidence: expense.new ? 0.78 : 0.96,
  created_at: NOW,
  id: expense.id,
  is_new: Boolean(expense.new),
  last_amount: expense.lastAmount,
  last_charge_date: isoDaysFromBase(-Math.max(1, 32 - expense.nextDate)),
  last_transaction_id: ledgerData.txns.find((transaction) => transaction.merchant === expense.merchant)?.id ?? null,
  merchant_name: expense.merchant,
  merchant_rule_id: null,
  next_due_date: isoDaysFromBase(expense.nextDate),
  status: expense.status,
  updated_at: NOW,
  user_id: DEMO_USER_ID
}));

const balanceSnapshots: BalanceSnapshotRow[] = ledgerData.trend
  .filter((_, index) => index % 15 === 0)
  .flatMap((point) => {
    const date = isoDaysFromBase(-point.d);
    const currentNetWorth = accounts.reduce((sum, account) => sum + (account.type === "credit" ? -Math.abs(account.current_balance) : account.current_balance), 0);
    const scale = currentNetWorth ? point.v / currentNetWorth : 1;

    return accounts.map((account) => ({
      account_id: account.id,
      available_balance: account.available_balance === null ? null : Math.round(account.available_balance * scale * 100) / 100,
      created_at: NOW,
      credit_limit: account.credit_limit,
      current_balance: Math.round(account.current_balance * scale * 100) / 100,
      id: `demo-snapshot-${account.id}-${date}`,
      iso_currency_code: "USD",
      snapshot_date: date,
      source: "demo",
      user_id: DEMO_USER_ID
    }));
  });

const plaidSyncRuns: PlaidSyncRunRow[] = [{
  accounts_upserted: accounts.length,
  balance_snapshots_upserted: balanceSnapshots.length,
  completed_at: NOW,
  created_at: NOW,
  enriched_transactions_inserted: enrichedTransactions.length,
  enriched_transactions_updated: 0,
  failed_items: 0,
  id: "demo-sync-run-latest",
  raw_transactions_skipped: 0,
  raw_transactions_upserted: rawTransactions.length,
  safe_error_code: null,
  safe_error_message: null,
  source: "scheduled",
  started_at: NOW,
  status: "succeeded",
  succeeded_items: plaidItems.length,
  total_items: plaidItems.length,
  transactions_removed: 0,
  updated_at: NOW,
  user_id: DEMO_USER_ID
}];

const plaidSyncRunItems: PlaidSyncRunItemRow[] = plaidItems.map((item) => ({
  accounts_upserted: accounts.filter((account) => account.plaid_item_id === item.id).length,
  balance_snapshots_upserted: balanceSnapshots.filter((snapshot) =>
    accounts.find((account) => account.id === snapshot.account_id)?.plaid_item_id === item.id
  ).length,
  completed_at: NOW,
  created_at: NOW,
  enriched_transactions_inserted: enrichedTransactions.filter((transaction) =>
    rawTransactions.find((raw) => raw.id === transaction.raw_transaction_id)?.plaid_item_id === item.id
  ).length,
  enriched_transactions_updated: 0,
  id: `demo-sync-item-${item.id}`,
  last_successful_sync_at: NOW,
  plaid_item_id: item.id,
  raw_transactions_skipped: 0,
  raw_transactions_upserted: rawTransactions.filter((transaction) => transaction.plaid_item_id === item.id).length,
  safe_error_code: null,
  safe_error_message: null,
  started_at: NOW,
  status: "succeeded",
  sync_run_id: "demo-sync-run-latest",
  transactions_removed: 0,
  user_id: DEMO_USER_ID
}));

const insights: InsightRow[] = [
  {
    action_label: "Review transfers",
    body: "Several peer-to-peer payments are waiting for category and split confirmation.",
    created_at: NOW,
    expires_at: null,
    generated_at: NOW,
    id: "demo-insight-review",
    insight_key: "demo-review-queue",
    payload: {},
    status: "active",
    title: "Demo review queue has open items",
    tone: "warn",
    updated_at: NOW,
    user_id: DEMO_USER_ID
  },
  {
    action_label: "Open recurring",
    body: "Recurring software and membership charges are seeded across the last year.",
    created_at: NOW,
    expires_at: null,
    generated_at: NOW,
    id: "demo-insight-recurring",
    insight_key: "demo-recurring",
    payload: {},
    status: "active",
    title: "Recurring charges are ready to inspect",
    tone: "info",
    updated_at: NOW,
    user_id: DEMO_USER_ID
  }
];

const auditEvents: AuditEventRow[] = [
  {
    id: "demo-audit-seed",
    user_id: DEMO_USER_ID,
    entity_table: "seed",
    entity_id: null,
    action: "ledger_seed_loaded",
    actor_id: null,
    before_data: null,
    after_data: { accounts: 4, transactions: 28, review_items: 6, recurring_expenses: 5 },
    metadata: { source: "demo.seed" },
    created_at: NOW
  },
  {
    id: "demo-audit-review-accept",
    user_id: DEMO_USER_ID,
    entity_table: "review_items",
    entity_id: "demo-review-001",
    action: "review.suggestion_accepted",
    actor_id: DEMO_USER_ID,
    before_data: { merchantName: "AMAZON MKT", categoryName: "Uncategorized", confidence: 0.4 },
    after_data: { merchantName: "Amazon", categoryName: "Household", confidence: 0.93 },
    metadata: { reason: "merchant_cleanup" },
    created_at: NOW
  },
  {
    id: "demo-audit-merchant-rule",
    user_id: DEMO_USER_ID,
    entity_table: "merchant_rules",
    entity_id: "demo-rule-001",
    action: "merchant_rule.ai_accepted_upserted",
    actor_id: DEMO_USER_ID,
    before_data: null,
    after_data: { merchantName: "Spotify", categoryName: "Subscriptions" },
    metadata: { source: "review_accept" },
    created_at: NOW
  },
  {
    id: "demo-audit-recurring",
    user_id: DEMO_USER_ID,
    entity_table: "recurring_expenses",
    entity_id: "demo-recurring-001",
    action: "recurring.candidate_confirmed",
    actor_id: DEMO_USER_ID,
    before_data: { status: "pending" },
    after_data: { status: "active", merchant: "Netflix", monthlyAverage: 15.49 },
    metadata: { source: "review" },
    created_at: NOW
  },
  {
    id: "demo-audit-reimbursement",
    user_id: DEMO_USER_ID,
    entity_table: "reimbursement_records",
    entity_id: "demo-reimbursement-001",
    action: "reimbursement.inflow_linked",
    actor_id: DEMO_USER_ID,
    before_data: { status: "expected" },
    after_data: { status: "received", appliedAmount: 42.75, transactionId: "demo-tx-venmo-001" },
    metadata: { source: "review" },
    created_at: NOW
  }
];

const rows = {
  accounts,
  agent_proposals: [] as AgentProposalRow[],
  audit_events: auditEvents,
  balance_snapshots: balanceSnapshots,
  categories,
  enriched_transactions: enrichedTransactions,
  google_calendar_connections: [] as GoogleCalendarConnectionRow[],
  insights,
  institutions,
  merchant_rules: [],
  plaid_items: plaidItems,
  plaid_sync_run_items: plaidSyncRunItems,
  plaid_sync_runs: plaidSyncRuns,
  raw_transactions: rawTransactions,
  recurring_expenses: recurringExpenses,
  reimbursement_records: reimbursementRecords,
  review_items: reviewItems,
  transaction_splits: transactionSplits
} satisfies { [Table in FinanceTableName]: TableRow<Table>[] };

function likePatternToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
  let body = "^";
  for (const char of pattern) {
    if (char === "%") body += ".*";
    else if (char === "_") body += ".";
    else body += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  body += "$";
  return new RegExp(body, caseInsensitive ? "i" : "");
}

function compareValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

class DemoFilterBuilder<Row extends Record<string, unknown>> implements PromiseLike<QueryResult<Row>> {
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ ascending: boolean; column: string }> = [];
  private limitCount: number | null = null;
  private singleResult = false;

  constructor(private readonly sourceRows: Row[]) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    const allowed = new Set(values);
    this.filters.push((row) => allowed.has(row[column]));
    return this;
  }

  gte(column: string, value: string | number) {
    this.filters.push((row) => compareValues(row[column], value) >= 0);
    return this;
  }

  lte(column: string, value: string | number) {
    this.filters.push((row) => compareValues(row[column], value) <= 0);
    return this;
  }

  like(column: string, pattern: string) {
    const regex = likePatternToRegExp(pattern, false);
    this.filters.push((row) => typeof row[column] === "string" && regex.test(row[column] as string));
    return this;
  }

  ilike(column: string, pattern: string) {
    const regex = likePatternToRegExp(pattern, true);
    this.filters.push((row) => typeof row[column] === "string" && regex.test(row[column] as string));
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ ascending: options.ascending ?? true, column });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.singleResult = true;
    return this;
  }

  delete() {
    return this;
  }

  insert() {
    return this;
  }

  update() {
    return this;
  }

  upsert() {
    return this;
  }

  then<TResult1 = QueryResult<Row>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<Row>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }

  private result(): QueryResult<Row> {
    let data = this.sourceRows.filter((row) => this.filters.every((filter) => filter(row)));

    this.orders.forEach(({ ascending, column }) => {
      data = [...data].sort((left, right) => {
        const result = compareValues(left[column], right[column]);
        return ascending ? result : -result;
      });
    });

    if (this.limitCount !== null) data = data.slice(0, this.limitCount);

    return {
      data: this.singleResult ? data[0] ?? null : data,
      error: null
    };
  }
}

export function createDemoFinanceClient(): FinanceSupabaseClient {
  return {
    from(table) {
      return new DemoFilterBuilder(rows[table] as Array<Record<string, unknown>>) as never;
    }
  };
}

export function listDemoPlaidConnections() {
  return plaidItems.map((item) => {
    const institution = institutions.find((row) => row.id === item.institution_id);
    const issue = getPlaidConnectionIssue({
      errorCode: item.error_code,
      lastSuccessfulSyncAt: item.last_successful_sync_at,
      status: item.status
    });

    return {
      availableProducts: item.available_products,
      billedProducts: item.billed_products,
      consentExpiresAt: item.consent_expires_at,
      createdAt: item.created_at,
      errorCode: item.error_code,
      errorMessage: issue?.detail ?? null,
      id: item.id,
      institutionId: item.institution_id,
      institutionName: institution?.name ?? "Demo institution",
      issue,
      lastSuccessfulSyncAt: item.last_successful_sync_at,
      updatedAt: item.updated_at,
      status: item.status
    };
  });
}
