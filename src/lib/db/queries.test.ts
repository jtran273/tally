import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnomalyAlerts,
  createAgentProposal,
  dismissAgentProposal,
  filterTransactionRecordsForList,
  type FinanceSupabaseClient,
  getAgentProposalById,
  listAgentProposals,
  listAnomalyAlerts,
  listAccounts,
  listReviewItems,
  listTransactions,
  recordClarificationAnswer,
  transactionMatchesSearch,
  updateAnomalyAlertStatus,
  upsertAgentProposalBySourceContext
} from "./queries";
import type {
  AccountRow,
  AnomalyAlertRow,
  AgentProposalRow,
  AuditEventRow,
  CategoryRow,
  EnrichedTransactionRow,
  InstitutionRow,
  PlaidItemRow,
  RawTransactionRow,
  ReimbursementRecordRow,
  ReviewItemRecord,
  ReviewItemRow,
  ReviewReason,
  ReviewStatus,
  TransactionSplitRow,
  TransactionIntent,
  TransactionRecord
} from "./types";

const userId = "11111111-1111-1111-1111-111111111111";
const otherUserId = "22222222-2222-2222-2222-222222222222";

function review(
  id: string,
  transactionId: string,
  status: ReviewStatus,
  reason: ReviewReason = "low-confidence"
): ReviewItemRecord {
  return {
    aiSuggestion: {},
    confidence: 0.71,
    createdAt: "2026-05-06T12:00:00.000Z",
    explanation: "Fixture review item",
    id,
    reason,
    resolutionNote: null,
    resolvedAt: null,
    status,
    transactionId
  };
}

function transaction(
  input: Pick<TransactionRecord, "id" | "merchant"> & Partial<TransactionRecord>
): TransactionRecord {
  const { id, merchant, ...overrides } = input;
  const reviewItems = input.reviewItems ?? [];

  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Everyday Checking",
    amount: -25,
    category: "Food / Restaurants",
    categoryId: "category-food",
    confidence: 0.91,
    date: "2026-05-06",
    institutionName: "Seed Bank",
    intent: "personal" as TransactionIntent,
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidTransactionId: `plaid-${input.id}`,
    rawTransactionId: `raw-${input.id}`,
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems,
    reviewReason: reviewItems.find((item) => item.status === "open")?.reason ?? null,
    reviewStatus: reviewItems.find((item) => item.status === "open")?.status ?? null,
    splits: [],
    status: "posted",
    userId,
    ...overrides,
    id,
    merchant,
    plaidName: overrides.plaidName ?? null
  };
}

export const transactionFilterFixture = [
  transaction({ id: "tx-coffee", merchant: "Blue Bottle" }),
  transaction({
    category: "Transfer",
    categoryId: "category-transfer",
    id: "tx-transfer",
    intent: "transfer",
    merchant: "Online Transfer"
  }),
  transaction({
    id: "tx-rideshare",
    merchant: "Lyft",
    note: "Airport ride",
    plaidCategory: "TRANSPORTATION / TAXIS_AND_RIDE_SHARES",
    plaidMerchant: "LYFT TRIP",
    reviewItems: [review("review-rideshare", "tx-rideshare", "open")]
  }),
  transaction({
    id: "tx-grocery",
    merchant: "Grocery Mart",
    reviewItems: [review("review-grocery", "tx-grocery", "resolved", "large")]
  }),
  transaction({
    category: "Uncategorized",
    categoryId: null,
    confidence: 0.43,
    id: "tx-uncategorized",
    merchant: "Unknown POS"
  })
] satisfies readonly TransactionRecord[];

export const transactionSearchFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  search: "ride shares"
});

export const transactionExcludeTransferFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  excludeTransfers: true
});

export const transactionOpenReviewFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  reviewStatus: "open"
});

export const transactionPagedFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  excludeTransfers: true,
  limit: 1,
  offset: 1
});

export const transactionFilterStaticAssertions = assertTransactionFilterFixtures();

test("transaction search matches normalized Plaid category text", () => {
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { search: "ride shares" }).map((item) => item.id),
    ["tx-rideshare"]
  );
});

test("transaction search covers merchant, raw Plaid merchant/name, category, account, mask, institution, and note", () => {
  const transactionUnderTest = transaction({
    accountMask: "9876",
    accountName: "Schools First Checking",
    category: "Food / Restaurants",
    id: "tx-search-surface",
    institutionName: "Schools First FCU",
    merchant: "Lyft",
    note: "Airport ride",
    plaidCategory: "TRANSPORTATION / TAXIS_AND_RIDE_SHARES",
    plaidMerchant: "LYFT TRIP",
    plaidName: "SQ *LYFT ORIGINAL DESCRIPTION"
  });

  [
    "Lyft",
    "LYFT TRIP",
    "original description",
    "restaurants",
    "schools first checking",
    "9876",
    "Schools First FCU",
    "airport ride",
    "taxis and ride shares"
  ].forEach((query) => {
    assert.equal(transactionMatchesSearch(transactionUnderTest, query), true, `Expected search to match ${query}`);
  });
});

test("transaction list filters compose review, transfer exclusion, limit, and offset after search", () => {
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { excludeTransfers: true }).map((item) => item.id),
    ["tx-coffee", "tx-rideshare", "tx-grocery", "tx-uncategorized"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { reviewStatus: "open" }).map((item) => item.id),
    ["tx-rideshare"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { reviewReason: "large" }).map((item) => item.id),
    ["tx-grocery"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { reviewReason: "low-confidence", reviewStatus: "open" }).map((item) => item.id),
    ["tx-rideshare"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, {
      excludeTransfers: true,
      limit: 1,
      offset: 1
    }).map((item) => item.id),
    ["tx-rideshare"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { quality: "needs-cleanup" }).map((item) => item.id),
    ["tx-rideshare", "tx-uncategorized"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { quality: "uncategorized" }).map((item) => item.id),
    ["tx-uncategorized"]
  );
});

test("transaction direction filters keep income and spending slices separate", () => {
  const rows = [
    transaction({
      amount: 120,
      category: "Shopping",
      categoryId: "category-shopping",
      id: "tx-shopping-income",
      merchant: "Marketplace refund"
    }),
    transaction({
      amount: -48,
      category: "Shopping",
      categoryId: "category-shopping",
      id: "tx-shopping-expense",
      merchant: "Marketplace purchase"
    }),
    transaction({
      amount: 90,
      category: "Transfer",
      categoryId: "category-transfer",
      id: "tx-transfer-income",
      intent: "transfer",
      merchant: "Bank transfer"
    }),
    transaction({
      amount: 42,
      category: "Reimbursements",
      categoryId: "category-reimbursements",
      id: "tx-reimbursable-income",
      intent: "reimbursable",
      merchant: "Reimbursement"
    })
  ];

  assert.deepEqual(
    filterTransactionRecordsForList(rows, { direction: "income" }).map((item) => item.id),
    ["tx-shopping-income"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(rows, { direction: "spending" }).map((item) => item.id),
    ["tx-shopping-expense"]
  );
});

function fixtureInstitution(): InstitutionRow {
  return {
    created_at: "2026-05-01T08:00:00.000Z",
    id: "institution-main",
    logo_url: null,
    name: "Seed Bank",
    plaid_institution_id: "ins_seed",
    primary_color: null,
    updated_at: "2026-05-01T08:00:00.000Z",
    user_id: userId,
    website_url: null
  };
}

function fixturePlaidItem(input: Partial<PlaidItemRow> = {}): PlaidItemRow {
  return {
    access_token_ciphertext: "ciphertext",
    auto_sync_enabled: true,
    available_products: ["transactions"],
    billed_products: ["transactions"],
    connection_source: "plaid",
    consent_expires_at: null,
    created_at: "2026-05-01T08:00:00.000Z",
    error_code: null,
    error_message: null,
    id: "plaid-item-main",
    institution_id: "institution-main",
    last_successful_sync_at: "2026-05-01T08:00:00.000Z",
    plaid_item_id: "provider-item-main",
    status: "active",
    transaction_cursor: "cursor",
    updated_at: "2026-05-01T08:00:00.000Z",
    user_id: userId,
    ...input
  };
}

function fixtureAccount(): AccountRow {
  return {
    available_balance: 1100,
    color: null,
    created_at: "2026-05-01T08:00:00.000Z",
    credit_limit: null,
    current_balance: 1200,
    id: "account-checking",
    institution_id: "institution-main",
    is_active: true,
    iso_currency_code: "USD",
    last_synced_at: null,
    last_statement_issue_date: null,
    last_statement_balance: null,
    next_payment_due_date: null,
    minimum_payment_amount: null,
    mask: "1111",
    name: "Everyday Checking",
    official_name: null,
    plaid_account_id: "plaid-account-checking",
    plaid_item_id: "plaid-item-main",
    subtype: "checking",
    type: "depository",
    updated_at: "2026-05-01T08:00:00.000Z",
    user_id: userId
  };
}

function fixtureRawTransaction(id: string, date: string, merchant: string): RawTransactionRow {
  return {
    account_id: "account-checking",
    amount: -20,
    authorized_date: null,
    authorized_datetime: null,
    date,
    datetime: null,
    first_seen_at: `${date}T08:00:00.000Z`,
    id,
    iso_currency_code: "USD",
    location: {},
    merchant_name: merchant,
    name: merchant,
    payment_channel: null,
    payment_meta: {},
    pending_transaction_id: null,
    plaid_category: null,
    plaid_category_id: null,
    plaid_item_id: "plaid-item-main",
    plaid_transaction_id: `plaid-${id}`,
    raw_payload: {},
    status: "posted",
    transaction_type: null,
    updated_at: `${date}T08:00:00.000Z`,
    user_id: userId
  };
}

function fixtureEnrichedTransaction(
  id: string,
  rawTransactionId: string,
  date: string,
  merchant: string
): EnrichedTransactionRow {
  return {
    account_id: "account-checking",
    amount: -20,
    category_id: null,
    category_name: "Uncategorized",
    confidence: 0.9,
    created_at: `${date}T08:00:00.000Z`,
    date,
    id,
    intent: "personal",
    is_recurring: false,
    merchant_name: merchant,
    note: "",
    raw_transaction_id: rawTransactionId,
    reviewed_at: null,
    source: "seed",
    status: "posted",
    updated_at: `${date}T08:00:00.000Z`,
    user_id: userId
  };
}

function fixtureReviewRow(
  id: string,
  transactionId: string,
  status: ReviewStatus,
  reason: ReviewReason = "low-confidence"
): ReviewItemRow {
  return {
    ai_suggestion: {},
    confidence: 0.7,
    created_at: "2026-05-13T08:00:00.000Z",
    enriched_transaction_id: transactionId,
    explanation: "Fixture review item",
    id,
    reason,
    resolution_note: null,
    resolved_at: status === "open" ? null : "2026-05-13T09:00:00.000Z",
    status,
    updated_at: "2026-05-13T08:00:00.000Z",
    user_id: userId
  };
}

function seedTransactionRows(client: FakeFinanceClient) {
  client.institutions.push(fixtureInstitution());
  client.plaidItems.push(fixturePlaidItem());
  client.accounts.push(fixtureAccount());
  client.rawTransactions.push(
    fixtureRawTransaction("raw-older", "2026-05-11", "Older Cafe"),
    fixtureRawTransaction("raw-middle", "2026-05-12", "Middle Market"),
    fixtureRawTransaction("raw-newest", "2026-05-13", "Newest Diner")
  );
  client.enrichedTransactions.push(
    fixtureEnrichedTransaction("tx-older", "raw-older", "2026-05-11", "Older Cafe"),
    fixtureEnrichedTransaction("tx-middle", "raw-middle", "2026-05-12", "Middle Market"),
    fixtureEnrichedTransaction("tx-newest", "raw-newest", "2026-05-13", "Newest Diner")
  );
}

test("listAccounts includes errored items and excludes inactive, revoked, and other-user accounts", async () => {
  const client = new FakeFinanceClient();
  client.institutions.push(fixtureInstitution());
  client.plaidItems.push(
    fixturePlaidItem(),
    fixturePlaidItem({
      error_code: "ITEM_LOGIN_REQUIRED",
      id: "plaid-item-error",
      plaid_item_id: "provider-item-error",
      status: "error"
    }),
    fixturePlaidItem({
      id: "plaid-item-revoked",
      plaid_item_id: "provider-item-revoked",
      status: "revoked"
    }),
    fixturePlaidItem({
      id: "plaid-item-other-user",
      plaid_item_id: "provider-item-other-user",
      user_id: otherUserId
    })
  );
  client.accounts.push(
    fixtureAccount(),
    {
      ...fixtureAccount(),
      id: "account-error",
      name: "Repairable Checking",
      plaid_account_id: "plaid-account-error",
      plaid_item_id: "plaid-item-error"
    },
    {
      ...fixtureAccount(),
      id: "account-inactive",
      is_active: false,
      name: "Inactive Checking",
      plaid_account_id: "plaid-account-inactive"
    },
    {
      ...fixtureAccount(),
      id: "account-revoked",
      name: "Old Checking",
      plaid_account_id: "plaid-account-revoked",
      plaid_item_id: "plaid-item-revoked"
    },
    {
      ...fixtureAccount(),
      id: "account-other-user",
      plaid_account_id: "plaid-account-other-user",
      plaid_item_id: "plaid-item-other-user",
      user_id: otherUserId
    }
  );

  const accounts = await listAccounts(client.asClient(), userId);

  assert.deepEqual(accounts.map((account) => account.id), ["account-checking", "account-error"]);
});

test("listTransactions excludes inactive and revoked account rows before applying limits", async () => {
  const client = new FakeFinanceClient();
  seedTransactionRows(client);
  client.plaidItems.push(fixturePlaidItem({
    id: "plaid-item-revoked",
    plaid_item_id: "provider-item-revoked",
    status: "revoked"
  }));
  client.accounts.push(
    {
      ...fixtureAccount(),
      id: "account-revoked",
      name: "Old Checking",
      plaid_account_id: "plaid-account-revoked",
      plaid_item_id: "plaid-item-revoked"
    },
    {
      ...fixtureAccount(),
      id: "account-inactive",
      is_active: false,
      name: "Inactive Checking",
      plaid_account_id: "plaid-account-inactive"
    }
  );
  client.rawTransactions.push(
    {
      ...fixtureRawTransaction("raw-revoked", "2026-05-14", "Old Row"),
      account_id: "account-revoked",
      plaid_item_id: "plaid-item-revoked"
    },
    {
      ...fixtureRawTransaction("raw-inactive", "2026-05-15", "Inactive Row"),
      account_id: "account-inactive"
    }
  );
  client.enrichedTransactions.push(
    {
      ...fixtureEnrichedTransaction("tx-revoked", "raw-revoked", "2026-05-14", "Old Row"),
      account_id: "account-revoked"
    },
    {
      ...fixtureEnrichedTransaction("tx-inactive", "raw-inactive", "2026-05-15", "Inactive Row"),
      account_id: "account-inactive"
    }
  );

  const transactions = await listTransactions(client.asClient(), userId, { limit: 2 });

  assert.deepEqual(transactions.map((item) => item.id), ["tx-newest", "tx-middle"]);
});

test("listTransactions applies database limits before hydration for simple filters", async () => {
  const client = new FakeFinanceClient();
  seedTransactionRows(client);

  const transactions = await listTransactions(client.asClient(), userId, { limit: 2 });

  assert.deepEqual(transactions.map((item) => item.id), ["tx-newest", "tx-middle"]);
  assert.deepEqual(client.limitCalls.enriched_transactions, [2]);
  assert.equal(
    client.selectCalls.raw_transactions?.at(-1),
    "id,merchant_name,name,plaid_category"
  );
  assert.doesNotMatch(client.selectCalls.raw_transactions?.at(-1) ?? "", /raw_payload/);
  assert.doesNotMatch(client.selectCalls.raw_transactions?.at(-1) ?? "", /plaid_transaction_id/);
});

test("listTransactions preserves hydrated filtering before applying limits", async () => {
  const client = new FakeFinanceClient();
  seedTransactionRows(client);

  const transactions = await listTransactions(client.asClient(), userId, { limit: 1, search: "older" });

  assert.deepEqual(transactions.map((item) => item.id), ["tx-older"]);
  assert.equal(client.limitCalls.enriched_transactions, undefined);
});

test("listTransactions applies direction filtering before row limits", async () => {
  const client = new FakeFinanceClient();
  seedTransactionRows(client);
  const middle = client.enrichedTransactions.find((row) => row.id === "tx-middle");
  if (!middle) throw new Error("Missing fixture transaction.");
  middle.amount = 250;
  middle.category_name = "Shopping";

  const transactions = await listTransactions(client.asClient(), userId, {
    direction: "income",
    limit: 1
  });

  assert.deepEqual(transactions.map((item) => item.id), ["tx-middle"]);
  assert.equal(client.limitCalls.enriched_transactions, undefined);
});

test("listTransactions can skip raw Plaid context when callers do not render it", async () => {
  const client = new FakeFinanceClient();
  seedTransactionRows(client);

  const transactions = await listTransactions(client.asClient(), userId, {
    includeRawContext: false,
    limit: 1
  });

  assert.deepEqual(transactions.map((item) => item.id), ["tx-newest"]);
  assert.equal(client.selectCalls.raw_transactions, undefined);
  assert.equal(transactions[0]?.plaidName, null);
  assert.equal(transactions[0]?.plaidMerchant, null);
});

test("listReviewItems can bound work and skip raw Plaid context for OpenClaw reads", async () => {
  const client = new FakeFinanceClient();
  seedTransactionRows(client);
  client.reviewItems.push(
    fixtureReviewRow("review-older", "tx-older", "open"),
    fixtureReviewRow("review-middle", "tx-middle", "open"),
    fixtureReviewRow("review-newest", "tx-newest", "open")
  );

  const reviewItems = await listReviewItems(client.asClient(), userId, "open", {
    includeRawContext: false,
    limit: 2
  });

  assert.equal(reviewItems.length, 2);
  assert.deepEqual(client.limitCalls.review_items, [2]);
  assert.equal(client.selectCalls.raw_transactions, undefined);
  assert.deepEqual(
    reviewItems.map((item) => item.transaction.plaidMerchant),
    [null, null]
  );
});

test("listTransactions pushes transfer and review filters before hydration limits", async () => {
  const client = new FakeFinanceClient();
  seedTransactionRows(client);
  const newest = client.enrichedTransactions.find((row) => row.id === "tx-newest");
  if (!newest) throw new Error("Missing fixture transaction.");
  newest.intent = "transfer";
  newest.category_name = "Transfer";
  client.reviewItems.push(
    fixtureReviewRow("review-middle", "tx-middle", "open"),
    fixtureReviewRow("review-older", "tx-older", "resolved", "large")
  );

  const nonTransfers = await listTransactions(client.asClient(), userId, {
    excludeTransfers: true,
    limit: 2
  });
  const openReviews = await listTransactions(client.asClient(), userId, {
    limit: 1,
    reviewStatus: "open"
  });
  const largeReviews = await listTransactions(client.asClient(), userId, {
    limit: 1,
    reviewReason: "large"
  });

  assert.deepEqual(nonTransfers.map((item) => item.id), ["tx-middle", "tx-older"]);
  assert.deepEqual(openReviews.map((item) => item.id), ["tx-middle"]);
  assert.deepEqual(largeReviews.map((item) => item.id), ["tx-older"]);
  assert.deepEqual(client.limitCalls.enriched_transactions, [2, 1, 1]);
  assert.deepEqual(
    client.selectCalls.review_items?.filter((columns) => columns === "enriched_transaction_id"),
    ["enriched_transaction_id", "enriched_transaction_id"]
  );
});

type FakeTableName =
  | "accounts"
  | "agent_proposals"
  | "anomaly_alerts"
  | "audit_events"
  | "categories"
  | "enriched_transactions"
  | "institutions"
  | "plaid_items"
  | "raw_transactions"
  | "reimbursement_records"
  | "review_items"
  | "transaction_splits";

class FakeQueryBuilder<Row extends Record<string, unknown>> {
  private filters: Array<(row: Row) => boolean> = [];
  private gteFilters: Array<(row: Row) => boolean> = [];
  private lteFilters: Array<(row: Row) => boolean> = [];
  private limitCount: number | null = null;
  private orders: Array<{ column: keyof Row; ascending: boolean }> = [];
  private singleResult = false;

  constructor(
    private rows: Row[],
    private operation: "select" | "insert" | "update" | "delete" | "upsert",
    private values?: Partial<Row> | Partial<Row>[],
    private onLimit?: (count: number) => void
  ) {}

  select() {
    return this;
  }

  eq(column: keyof Row & string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: keyof Row & string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  in(column: keyof Row & string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  gte(column: keyof Row & string, value: string | number) {
    this.gteFilters.push((row) => String(row[column]) >= String(value));
    return this;
  }

  lte(column: keyof Row & string, value: string | number) {
    this.lteFilters.push((row) => String(row[column]) <= String(value));
    return this;
  }

  order(column: keyof Row & string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending ?? true });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    this.onLimit?.(count);
    return this;
  }

  single() {
    this.singleResult = true;
    return this;
  }

  then<TResult1 = { data: Row[] | Row | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | Row | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    if (this.operation === "insert" || this.operation === "upsert") {
      const inserted = (Array.isArray(this.values) ? this.values : [this.values ?? {}]).map((value) => {
        const now = "2026-05-13T08:00:00.000Z";
        const rawValue = value as Record<string, unknown>;
        const existing = this.operation === "upsert" && typeof rawValue.source_context_id === "string"
          ? this.rows.find((row) =>
            row["user_id"] === rawValue.user_id &&
            row["source_agent"] === rawValue.source_agent &&
            row["source_context_id"] === rawValue.source_context_id
          )
          : null;
        if (existing) {
          Object.assign(existing, value);
          return existing;
        }
        const id = typeof rawValue.id === "string" ? rawValue.id : `row-${this.rows.length + 1}`;
        const row = {
          id,
          created_at: now,
          updated_at: now,
          status: "pending",
          ...value
        } as unknown as Row;
        this.rows.push(row);
        return row;
      });
      return { data: this.singleResult ? inserted[0] ?? null : inserted, error: null };
    }

    let matches = this.rows.filter((row) =>
      this.filters.every((filter) => filter(row)) &&
      this.gteFilters.every((filter) => filter(row)) &&
      this.lteFilters.every((filter) => filter(row))
    );

    if (this.operation === "update") {
      matches.forEach((row) => Object.assign(row, this.values));
    }

    if (this.orders.length > 0) {
      matches = [...matches].sort((left, right) => {
        for (const { column, ascending } of this.orders) {
          const comparison = String(left[column]).localeCompare(String(right[column]));
          if (comparison !== 0) return ascending ? comparison : -comparison;
        }
        return 0;
      });
    }

    if (this.limitCount !== null) {
      matches = matches.slice(0, this.limitCount);
    }

    return { data: this.singleResult ? matches[0] ?? null : matches, error: null };
  }
}

class FakeFinanceClient {
  accounts: AccountRow[] = [];
  agentProposals: AgentProposalRow[] = [];
  anomalyAlerts: AnomalyAlertRow[] = [];
  auditEvents: AuditEventRow[] = [];
  categories: CategoryRow[] = [];
  enrichedTransactions: EnrichedTransactionRow[] = [];
  institutions: InstitutionRow[] = [];
  limitCalls: Partial<Record<FakeTableName, number[]>> = {};
  plaidItems: PlaidItemRow[] = [];
  rawTransactions: RawTransactionRow[] = [];
  reimbursementRecords: ReimbursementRecordRow[] = [];
  reviewItems: ReviewItemRow[] = [];
  selectCalls: Partial<Record<FakeTableName, string[]>> = {};
  transactionSplits: TransactionSplitRow[] = [];

  asClient(): FinanceSupabaseClient {
    return this as unknown as FinanceSupabaseClient;
  }

  private rowsFor(table: FakeTableName): Array<Record<string, unknown>> {
    switch (table) {
      case "accounts":
        return this.accounts as unknown as Array<Record<string, unknown>>;
      case "agent_proposals":
        return this.agentProposals as unknown as Array<Record<string, unknown>>;
      case "anomaly_alerts":
        return this.anomalyAlerts as unknown as Array<Record<string, unknown>>;
      case "audit_events":
        return this.auditEvents as unknown as Array<Record<string, unknown>>;
      case "categories":
        return this.categories as unknown as Array<Record<string, unknown>>;
      case "enriched_transactions":
        return this.enrichedTransactions as unknown as Array<Record<string, unknown>>;
      case "institutions":
        return this.institutions as unknown as Array<Record<string, unknown>>;
      case "plaid_items":
        return this.plaidItems as unknown as Array<Record<string, unknown>>;
      case "raw_transactions":
        return this.rawTransactions as unknown as Array<Record<string, unknown>>;
      case "reimbursement_records":
        return this.reimbursementRecords as unknown as Array<Record<string, unknown>>;
      case "review_items":
        return this.reviewItems as unknown as Array<Record<string, unknown>>;
      case "transaction_splits":
        return this.transactionSplits as unknown as Array<Record<string, unknown>>;
    }
  }

  private recordLimit(table: FakeTableName, count: number) {
    this.limitCalls[table] = [...(this.limitCalls[table] ?? []), count];
  }

  private recordSelect(table: FakeTableName, columns?: string) {
    this.selectCalls[table] = [...(this.selectCalls[table] ?? []), columns ?? "*"];
  }

  from(table: FakeTableName) {
    const rows = this.rowsFor(table);
    return {
      delete: () => new FakeQueryBuilder(rows, "delete", undefined, (count) => this.recordLimit(table, count)),
      insert: (values: Partial<AgentProposalRow> | Partial<AnomalyAlertRow> | Partial<AuditEventRow> | Array<Partial<AgentProposalRow> | Partial<AnomalyAlertRow> | Partial<AuditEventRow>>) =>
        new FakeQueryBuilder(rows, "insert", values as Array<Partial<Record<string, unknown>>>, (count) => this.recordLimit(table, count)),
      select: (columns?: string) => {
        this.recordSelect(table, columns);
        return new FakeQueryBuilder(rows, "select", undefined, (count) => this.recordLimit(table, count));
      },
      update: (values: Partial<AgentProposalRow> | Partial<AnomalyAlertRow> | Partial<AuditEventRow>) =>
        new FakeQueryBuilder(rows, "update", values as Partial<Record<string, unknown>>, (count) => this.recordLimit(table, count)),
      upsert: (values: Partial<AgentProposalRow> | Partial<AgentProposalRow>[]) =>
        new FakeQueryBuilder(rows, "upsert", values, (count) => this.recordLimit(table, count))
    };
  }
}

class MissingSingleRowFinanceClient {
  asClient(): FinanceSupabaseClient {
    return this as unknown as FinanceSupabaseClient;
  }

  from() {
    return {
      eq() {
        return this;
      },
      select() {
        return this;
      },
      single() {
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST116",
            details: "The result contains 0 rows",
            message: "JSON object requested, multiple (or no) rows returned"
          }
        });
      }
    };
  }
}

function agentProposalRow(input: Partial<AgentProposalRow> = {}): AgentProposalRow {
  return {
    accepted_at: null,
    answered_at: null,
    clarification_answer: null,
    clarification_answer_kind: null,
    clarification_question: null,
    confidence: 0.74,
    created_at: "2026-05-13T08:00:00.000Z",
    dismissed_at: null,
    evidence: {},
    expires_at: null,
    id: "proposal-1",
    proposal_type: "clarification_request",
    proposed_patch: {},
    question_fingerprint: "fingerprint",
    source_agent: "test-agent",
    source_candidate_id: null,
    source_context_id: null,
    status: "pending",
    target_id: "11111111-1111-1111-1111-111111111111",
    target_kind: "enriched_transaction",
    updated_at: "2026-05-13T08:00:00.000Z",
    user_id: userId,
    ...input
  };
}

function anomalyAlertRow(input: Partial<AnomalyAlertRow> = {}): AnomalyAlertRow {
  return {
    body: "Possible duplicate charge.",
    created_at: "2026-06-04T08:00:00.000Z",
    dedupe_key: "duplicate_charge:tx-1:tx-2",
    detected_at: "2026-06-04T08:00:00.000Z",
    dismissed_at: null,
    evidence: {},
    first_seen_at: "2026-06-04T08:00:00.000Z",
    id: "alert-1",
    last_seen_at: "2026-06-04T08:00:00.000Z",
    reason_code: "duplicate_charge",
    resolved_at: null,
    severity: "warning",
    status: "pending",
    title: "Possible duplicate charge",
    updated_at: "2026-06-04T08:00:00.000Z",
    user_id: userId,
    ...input
  };
}

test("anomaly alerts insert, list pending, refresh, and update status", async () => {
  const client = new FakeFinanceClient();
  client.anomalyAlerts.push(anomalyAlertRow({
    id: "resolved-alert",
    status: "resolved"
  }));

  const [created] = await createAnomalyAlerts(client.asClient(), userId, [
    {
      body: "A large charge posted on 2026-06-04.",
      dedupeKey: "large_transaction:tx-1",
      evidence: { amount: 1800, transactionIds: ["tx-1"] },
      reasonCode: "large_transaction",
      severity: "warning",
      title: "Large charge"
    }
  ], {
    now: new Date("2026-06-04T12:00:00.000Z")
  });
  const pending = await listAnomalyAlerts(client.asClient(), userId, { status: "pending" });
  const dismissed = await updateAnomalyAlertStatus(
    client.asClient(),
    userId,
    created!.id,
    "dismissed",
    { now: new Date("2026-06-04T13:00:00.000Z") }
  );

  assert.equal(created?.status, "pending");
  assert.deepEqual(pending.map((alert) => alert.id), [created!.id]);
  assert.equal(dismissed.status, "dismissed");
  assert.equal(dismissed.dismissedAt, "2026-06-04T13:00:00.000Z");
});

test("anomaly alert safety rejects forbidden evidence before insert", async () => {
  const client = new FakeFinanceClient();

  await assert.rejects(
    () => createAnomalyAlerts(client.asClient(), userId, [
      {
        body: "Unsafe evidence",
        dedupeKey: "large_transaction:tx-unsafe",
        evidence: { raw_payload: { secret: true } },
        reasonCode: "large_transaction",
        severity: "warning",
        title: "Unsafe evidence"
      }
    ]),
    /forbidden data|forbidden fields/i
  );
  assert.equal(client.anomalyAlerts.length, 0);
});

test("agent proposals insert, list pending, and filter expired rows", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposalRow({
    expires_at: "2026-05-12T08:00:00.000Z",
    id: "expired"
  }));

  const created = await createAgentProposal(client.asClient(), userId, {
    clarificationQuestion: "Was this reimbursable?",
    evidence: { merchant: "Dinner" },
    proposedPatch: { suggestedIntent: "reimbursable" },
    proposalType: "clarification_request",
    sourceAgent: "test-agent",
    targetId: "22222222-2222-2222-2222-222222222222",
    targetKind: "enriched_transaction"
  });

  assert.equal(created.status, "pending");
  const pending = await listAgentProposals(client.asClient(), userId, { status: "pending" });
  assert.deepEqual(pending.map((proposal) => proposal.id), [created.id]);
});

test("upsertAgentProposalBySourceContext updates an existing briefing instead of duplicating it", async () => {
  const client = new FakeFinanceClient();
  const sourceContextId = "openclaw-briefing:weekly:2026-05-06:2026-05-12";
  const targetId = "22222222-2222-5222-9222-222222222222";

  const created = await upsertAgentProposalBySourceContext(client.asClient(), userId, {
    evidence: { briefing: { spending: 100 } },
    proposedPatch: { suggestedQuestions: ["first question"] },
    proposalType: "openclaw_briefing",
    sourceAgent: "ledger-openclaw-briefing-compiler",
    sourceContextId,
    targetId,
    targetKind: "openclaw_briefing"
  });
  const updated = await upsertAgentProposalBySourceContext(
    client.asClient(),
    userId,
    {
      evidence: { briefing: { spending: 125 } },
      proposedPatch: { suggestedQuestions: ["updated question"] },
      proposalType: "openclaw_briefing",
      sourceAgent: "ledger-openclaw-briefing-compiler",
      sourceContextId,
      targetId,
      targetKind: "openclaw_briefing"
    },
    { now: new Date("2026-05-13T10:00:00.000Z") }
  );

  assert.equal(updated.id, created.id);
  assert.equal(client.agentProposals.length, 1);
  assert.deepEqual(updated.evidence, { briefing: { spending: 125 } });
  assert.deepEqual(updated.proposedPatch, { suggestedQuestions: ["updated question"] });
  assert.equal(updated.updatedAt, "2026-05-13T10:00:00.000Z");
});

test("agent proposal safety rejects forbidden evidence before insert", async () => {
  const client = new FakeFinanceClient();

  await assert.rejects(
    () => createAgentProposal(client.asClient(), userId, {
      evidence: { raw_payload: { provider: "secret" } },
      proposalType: "safe_to_spend_warning",
      sourceAgent: "test-agent",
      targetId: "22222222-2222-2222-2222-222222222222",
      targetKind: "enriched_transaction"
    }),
    /forbidden data|forbidden fields/i
  );
  assert.equal(client.agentProposals.length, 0);
});

test("dismissAgentProposal is idempotent and records audit once", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposalRow());

  const dismissed = await dismissAgentProposal(client.asClient(), userId, "proposal-1");
  const dismissedAgain = await dismissAgentProposal(client.asClient(), userId, "proposal-1");

  assert.equal(dismissed.status, "dismissed");
  assert.equal(dismissedAgain.status, "dismissed");
  assert.equal(client.auditEvents.length, 1);
});

test("recordClarificationAnswer normalizes terse replies and stores answered status", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposalRow({
    clarification_question: "Who reimbursed you?"
  }));

  const answered = await recordClarificationAnswer(client.asClient(), userId, "proposal-1", "Ryan dinner");

  assert.equal(answered.status, "answered");
  assert.equal(answered.clarificationAnswer, "Ryan dinner");
  assert.equal(answered.clarificationAnswerKind, "counterparty");
  assert.deepEqual(answered.proposedPatch, { counterparties: ["Ryan"] });
});

test("recordClarificationAnswer supports reimbursement candidates that ask a question", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposalRow({
    clarification_question: "Who reimbursed you?",
    proposal_type: "reimbursement_candidate",
    proposed_patch: { suggestedIntent: "reimbursable" }
  }));

  const answered = await recordClarificationAnswer(client.asClient(), userId, "proposal-1", "Ryan dinner");

  assert.equal(answered.status, "answered");
  assert.equal(answered.clarificationAnswer, "Ryan dinner");
  assert.equal(answered.clarificationAnswerKind, "counterparty");
  assert.deepEqual(answered.proposedPatch, {
    counterparties: ["Ryan"],
    suggestedIntent: "reimbursable"
  });
});

test("getAgentProposalById treats Supabase single 0-row responses as missing", async () => {
  const client = new MissingSingleRowFinanceClient();

  const proposal = await getAgentProposalById(client.asClient(), userId, "missing");

  assert.equal(proposal, null);
});

function assertTransactionFilterFixtures(): true {
  if (transactionSearchFixture.length !== 1 || transactionSearchFixture[0]?.id !== "tx-rideshare") {
    throw new Error("Expected transaction search to include raw Plaid category and merchant text.");
  }

  if (transactionExcludeTransferFixture.some((item) => item.intent === "transfer")) {
    throw new Error("Expected excludeTransfers to remove transfer-intent transactions.");
  }

  if (transactionOpenReviewFixture.length !== 1 || transactionOpenReviewFixture[0]?.id !== "tx-rideshare") {
    throw new Error("Expected reviewStatus=open to include only transactions with open review items.");
  }

  if (transactionPagedFixture.length !== 1 || transactionPagedFixture[0]?.id !== "tx-rideshare") {
    throw new Error("Expected limit and offset to apply after search/review/transfer filters.");
  }

  return true;
}
