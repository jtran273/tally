import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AccountType as PlaidAccountType, Products, type AccountBase, type Transaction } from "plaid";
import {
  buildPlaidLinkTokenCreateRequest,
  deletePlaidItemLedgerData,
  getDefaultConfidence,
  getRemovedPlaidTransactionIdsToDelete,
  isPlaidRealtimeBalanceAuthorized,
  isRecentRunningPlaidSync,
  isSkippablePlaidTransactionsError,
  listPlaidConnections,
  mergePlaidAccountSourcesForSync,
  persistedSyncError,
  planPendingRawTransactionReplacements,
  revokePlaidConnection,
  shouldRefreshImportedEnrichment,
  shouldRefreshPlaidEnrichment,
  syncOpportunisticPlaidConnections,
  summarizeSyncRun
} from "./service";
import { encryptPlaidAccessToken } from "./token-vault";

function account(accountId: string, name: string, current: number): AccountBase {
  return {
    account_id: accountId,
    balances: {
      available: current,
      current,
      iso_currency_code: "USD",
      limit: null,
      unofficial_currency_code: null
    },
    mask: "1234",
    name,
    official_name: null,
    subtype: null,
    type: PlaidAccountType.Depository
  } as AccountBase;
}

const syncAccount = account("acct-sync", "Transactions sync account", 100);
const accountsGetAccount = account("acct-get", "Accounts get account", 250);
const balanceAccount = account("acct-get", "Accounts balance account", 275);
const userId = "11111111-1111-1111-1111-111111111111";
const otherUserId = "22222222-2222-2222-2222-222222222222";

const TOKEN_ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "NODE_ENV",
  "PLAID_CLIENT_ID",
  "PLAID_ENV",
  "PLAID_PRODUCTION_SECRET",
  "PLAID_REDIRECT_URI",
  "PLAID_SANDBOX_SECRET",
  "PLAID_SECRET",
  "PLAID_TOKEN_ENCRYPTION_KEY",
  "VERCEL_ENV",
  "VERCEL_URL"
] as const;

async function withPlaidTokenEnv<T>(fn: () => T | Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const previous = new Map(TOKEN_ENV_KEYS.map((key) => [key, env[key]]));

  Object.assign(env, {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NODE_ENV: "development",
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "sandbox",
    PLAID_SANDBOX_SECRET: "sandbox-secret"
  });
  delete env.PLAID_PRODUCTION_SECRET;
  delete env.PLAID_REDIRECT_URI;
  delete env.PLAID_SECRET;
  delete env.PLAID_TOKEN_ENCRYPTION_KEY;
  delete env.VERCEL_ENV;
  delete env.VERCEL_URL;

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }
  }
}

export const plaidAccountsGetFallbackFixture = mergePlaidAccountSourcesForSync({
  accountsGetAccounts: [accountsGetAccount],
  balanceAccounts: [],
  transactionSyncAccounts: []
});

export const plaidAccountSourceMergeFixture = mergePlaidAccountSourcesForSync({
  accountsGetAccounts: [accountsGetAccount],
  balanceAccounts: [balanceAccount],
  transactionSyncAccounts: [syncAccount]
});

export const plaidAccountSourceMergeStaticAssertions = assertPlaidAccountSourceMergeFixtures();
export const plaidPendingReplacementStaticAssertions = assertPlaidPendingReplacementFixtures();

test("Plaid Link token request uses Tally branding for new connections", () => {
  const request = buildPlaidLinkTokenCreateRequest({
    redirectUri: null,
    userEmail: "james@example.com",
    userId
  });

  assert.equal(request.client_name, "Tally");
  assert.deepEqual(request.products, [Products.Transactions]);
  assert.equal("access_token" in request, false);
  assert.deepEqual(request.country_codes, ["US"]);
  assert.equal(request.language, "en");
  assert.equal(request.redirect_uri, undefined);
  assert.deepEqual(request.user, {
    client_user_id: userId,
    email_address: "james@example.com"
  });
});

test("Plaid Link token request uses update mode without product creation fields", () => {
  const request = buildPlaidLinkTokenCreateRequest({
    accessToken: "access-sandbox-update",
    redirectUri: "https://app.example.com/settings",
    userEmail: null,
    userId
  });

  assert.equal(request.client_name, "Tally");
  assert.equal(request.access_token, "access-sandbox-update");
  assert.equal("products" in request, false);
  assert.equal(request.redirect_uri, "https://app.example.com/settings");
  assert.ok(request.user);
  assert.equal(request.user.client_user_id, userId);
  assert.equal(request.user.email_address, undefined);
});

test("pending raw transaction is planned for in-place posted replacement", () => {
  assert.deepEqual(
    planPendingRawTransactionReplacements({
      existingPendingRows: [
        {
          id: "raw-pending",
          plaid_transaction_id: "pending-tx",
          status: "pending"
        }
      ],
      incomingRows: [
        {
          pending_transaction_id: "pending-tx",
          plaid_transaction_id: "posted-tx",
          status: "posted"
        }
      ]
    }),
    [
      {
        incomingPlaidTransactionId: "posted-tx",
        pendingPlaidTransactionId: "pending-tx",
        rawTransactionId: "raw-pending"
      }
    ]
  );
});

test("manual or reviewed Plaid enrichment is not refreshed by Plaid modifications", () => {
  assert.equal(shouldRefreshPlaidEnrichment({
    reviewed_at: null,
    source: "plaid"
  }), true);
  assert.equal(shouldRefreshPlaidEnrichment({
    reviewed_at: null,
    source: "manual"
  }), false);
  assert.equal(shouldRefreshPlaidEnrichment({
    reviewed_at: "2026-05-07T08:00:00.000Z",
    source: "plaid"
  }), false);
});

test("removed pending id is skipped after a posted replacement preserves that raw row", () => {
  assert.deepEqual(
    getRemovedPlaidTransactionIdsToDelete(
      [
        { transaction_id: "pending-tx" },
        { transaction_id: "orphan-removed-tx" },
        { transaction_id: "orphan-removed-tx" }
      ],
      new Set(["pending-tx"])
    ),
    ["orphan-removed-tx"]
  );
});

test("imported enrichment refresh preserves manual and reviewed overrides", () => {
  assert.equal(shouldRefreshImportedEnrichment({ reviewed_at: null, source: "plaid" }), true);
  assert.equal(shouldRefreshImportedEnrichment({ reviewed_at: null, source: "rule" }), true);
  assert.equal(shouldRefreshImportedEnrichment({ reviewed_at: "2026-05-06T12:00:00.000Z", source: "plaid" }), false);
  assert.equal(shouldRefreshImportedEnrichment({ reviewed_at: "2026-05-06T12:00:00.000Z", source: "rule" }), false);
  assert.equal(shouldRefreshImportedEnrichment({ reviewed_at: null, source: "manual" }), false);
});

test("transactions product availability errors can be skipped while importing accounts", () => {
  assert.equal(
    isSkippablePlaidTransactionsError({
      response: {
        data: {
          error_code: "PRODUCT_NOT_ENABLED",
          error_type: "INVALID_REQUEST",
          request_id: "request-id"
        },
        status: 400
      }
    }),
    true
  );
  assert.equal(
    isSkippablePlaidTransactionsError({
      response: {
        data: {
          error_code: "ITEM_LOGIN_REQUIRED",
          error_type: "ITEM_ERROR",
          request_id: "request-id"
        },
        status: 400
      }
    }),
    false
  );
});

test("Plaid fallback category confidence stays reviewable when provider confidence is absent", () => {
  const baseTransaction = {
    amount: 12.34,
    category: null,
    merchant_name: null,
    name: "Plaid transaction",
    personal_finance_category: null
  } as Transaction;

  assert.equal(getDefaultConfidence(baseTransaction), 0.25);
  assert.equal(getDefaultConfidence({
    ...baseTransaction,
    category: ["Food and Drink", "Restaurants"]
  }), 0.65);
  assert.equal(getDefaultConfidence({
    ...baseTransaction,
    personal_finance_category: {
      confidence_level: "VERY_HIGH",
      detailed: "FOOD_AND_DRINK_RESTAURANT",
      primary: "FOOD_AND_DRINK"
    }
  }), 0.98);
});

test("low Plaid category confidence is raised only for clear ordinary merchant-category signals", () => {
  const clearFoodTransaction = {
    amount: 12.34,
    category: null,
    merchant_name: "Sweetgreen",
    name: "SWEETGREEN 123",
    personal_finance_category: {
      confidence_level: "LOW",
      detailed: "FOOD_AND_DRINK_RESTAURANT",
      primary: "FOOD_AND_DRINK"
    }
  } as Transaction;

  assert.equal(getDefaultConfidence(clearFoodTransaction), 0.78);
  assert.equal(getDefaultConfidence({
    ...clearFoodTransaction,
    merchant_name: null
  }), 0.5);
  assert.equal(getDefaultConfidence({
    ...clearFoodTransaction,
    merchant_name: "Venmo Rachel"
  }), 0.5);
  assert.equal(getDefaultConfidence({
    ...clearFoodTransaction,
    personal_finance_category: {
      confidence_level: "LOW",
      detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      primary: "TRANSFER_OUT"
    }
  }), 0.5);
  assert.equal(getDefaultConfidence({
    ...clearFoodTransaction,
    personal_finance_category: {
      confidence_level: "LOW",
      detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      primary: "GENERAL_MERCHANDISE_OTHER"
    }
  }), 0.5);
  assert.equal(getDefaultConfidence({
    ...clearFoodTransaction,
    personal_finance_category: {
      confidence_level: "UNKNOWN",
      detailed: "FOOD_AND_DRINK_RESTAURANT",
      primary: "FOOD_AND_DRINK"
    }
  }), 0.25);
});

test("sync run summary marks partial failures and excludes provider ids", () => {
  const summary = summarizeSyncRun(
    [
      {
        accountsUpserted: 2,
        balanceSnapshotsUpserted: 2,
        enrichedTransactionsInserted: 3,
        enrichedTransactionsUpdated: 1,
        id: "internal-item-id",
        lastSuccessfulSyncAt: "2026-05-07T08:00:00.000Z",
        rawTransactionsSkipped: 1,
        rawTransactionsUpserted: 4,
        transactionsRemoved: 0,
        warningCode: "PRODUCT_NOT_ENABLED",
        warningMessage: "Plaid transactions are not available for this connection yet."
      },
      {
        accountsUpserted: 0,
        balanceSnapshotsUpserted: 0,
        enrichedTransactionsInserted: 0,
        enrichedTransactionsUpdated: 0,
        errorCode: "ITEM_LOGIN_REQUIRED",
        errorMessage: "Plaid sync failed.",
        id: "internal-error-item-id",
        lastSuccessfulSyncAt: null,
        rawTransactionsSkipped: 0,
        rawTransactionsUpserted: 0,
        transactionsRemoved: 0
      }
    ],
    {
      runId: "run-id",
      source: "scheduled",
      startedAt: "2026-05-07T08:00:00.000Z"
    }
  );

  assert.equal(summary.status, "partial");
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.items[0]?.warningCode, "PRODUCT_NOT_ENABLED");
  assert.equal(summary.rawTransactionsUpserted, 4);
  assert.equal("plaidItemId" in summary.items[0], false);
  assert.equal("transactionCursor" in summary.items[0], false);
});

test("persisted sync errors distinguish Plaid request failures from internal save failures", () => {
  assert.deepEqual(
    persistedSyncError({
      response: {
        data: {
          error_type: "API_ERROR",
          request_id: "request-safe"
        },
        status: 502
      }
    }),
    {
      error_code: "PLAID_REQUEST_FAILED",
      error_message: "Plaid request failed with HTTP status 502, Plaid error type API_ERROR."
    }
  );

  assert.deepEqual(
    persistedSyncError(Object.assign(new Error("timeout"), { code: "ECONNABORTED" })),
    {
      error_code: "PLAID_REQUEST_FAILED",
      error_message: "Plaid request failed with transport code ECONNABORTED."
    }
  );

  assert.deepEqual(
    persistedSyncError(new Error("Upsert raw Plaid transactions: duplicate key value violates unique constraint")),
    {
      error_code: "PLAID_SYNC_INTERNAL_ERROR",
      error_message: "Tally sync failed while saving imported Plaid data during Upsert raw Plaid transactions."
    }
  );
});

test("Plaid connection summaries do not treat server config failures as item attention", async () => {
  const client = new PurgeFinanceClient({
    institutions: [
      institutionRow()
    ],
    plaid_items: [
      {
        ...plaidItemRow("ciphertext"),
        error_code: "PLAID_CONFIGURATION_ERROR",
        error_message: "Plaid sync failed.",
        status: "error"
      }
    ]
  });

  const connections = await listPlaidConnections(client.asClient(), userId);

  assert.equal(connections.length, 1);
  assert.equal(connections[0]?.status, "active");
  assert.equal(connections[0]?.errorCode, null);
  assert.equal(connections[0]?.issue, null);
});

test("manual connection placeholders are hidden from Plaid connection summaries", async () => {
  const client = new PurgeFinanceClient({
    institutions: [
      institutionRow(),
      {
        ...institutionRow(),
        id: "institution-manual",
        name: "Fidelity (manual)",
        plaid_institution_id: null
      }
    ],
    plaid_items: [
      plaidItemRow("ciphertext"),
      {
        ...plaidItemRow("manual-no-provider:placeholder"),
        connection_source: "manual",
        error_code: "PLAID_TOKEN_DECRYPTION_ERROR",
        id: "item-manual",
        institution_id: "institution-manual",
        plaid_item_id: "manual-fidelity",
        status: "error"
      }
    ]
  });

  const connections = await listPlaidConnections(client.asClient(), userId);

  assert.deepEqual(connections.map((connection) => connection.institutionName), ["Old Bank"]);
});

test("Plaid item ledger purge removes item-scoped finance rows and leaves other items intact", async () => {
  const client = new PurgeFinanceClient({
    accounts: [
      row("account-old", { plaid_item_id: "item-old" }),
      row("account-new", { plaid_item_id: "item-new" })
    ],
    agent_proposals: [
      row("proposal-tx-old", { target_id: "tx-old", target_kind: "enriched_transaction" }),
      row("proposal-review-old", { target_id: "review-old", target_kind: "review_item" }),
      row("proposal-reimbursement-old", { target_id: "reimbursement-old", target_kind: "reimbursement_record" }),
      row("proposal-recurring-old", { target_id: "recurring-old", target_kind: "recurring_expense" }),
      row("proposal-new", { target_id: "tx-new", target_kind: "enriched_transaction" })
    ],
    audit_events: [
      row("audit-account-old", { entity_id: "account-old", entity_table: "accounts" }),
      row("audit-tx-old", { entity_id: "tx-old", entity_table: "enriched_transactions" }),
      row("audit-proposal-old", { entity_id: "proposal-tx-old", entity_table: "agent_proposals" }),
      row("audit-item-old", { entity_id: "item-old", entity_table: "plaid_items" }),
      row("audit-sync-item-old", { entity_id: "sync-item-old", entity_table: "plaid_sync_run_items" }),
      row("audit-new", { entity_id: "tx-new", entity_table: "enriched_transactions" })
    ],
    balance_snapshots: [
      row("snapshot-old", { account_id: "account-old" }),
      row("snapshot-new", { account_id: "account-new" })
    ],
    enriched_transactions: [
      row("tx-old", { account_id: "account-old", raw_transaction_id: "raw-old" }),
      row("tx-new", { account_id: "account-new", raw_transaction_id: "raw-new" })
    ],
    plaid_items: [
      row("item-old"),
      row("item-new")
    ],
    plaid_sync_run_items: [
      row("sync-item-old", { plaid_item_id: "item-old" }),
      row("sync-item-new", { plaid_item_id: "item-new" })
    ],
    raw_transactions: [
      row("raw-old", { account_id: "account-old", plaid_item_id: "item-old" }),
      row("raw-new", { account_id: "account-new", plaid_item_id: "item-new" })
    ],
    recurring_expenses: [
      row("recurring-old", { account_id: "account-old", last_transaction_id: null }),
      row("recurring-old-tx", { account_id: null, last_transaction_id: "tx-old" }),
      row("recurring-new", { account_id: "account-new", last_transaction_id: "tx-new" })
    ],
    reimbursement_records: [
      row("reimbursement-old", { enriched_transaction_id: "tx-old", received_transaction_id: null, split_id: "split-old" }),
      row("reimbursement-received-old", { enriched_transaction_id: "tx-new", received_transaction_id: "tx-old", split_id: null }),
      row("reimbursement-new", { enriched_transaction_id: "tx-new", received_transaction_id: null, split_id: null })
    ],
    review_items: [
      row("review-old", { enriched_transaction_id: "tx-old" }),
      row("review-new", { enriched_transaction_id: "tx-new" })
    ],
    transaction_splits: [
      row("split-old", { enriched_transaction_id: "tx-old" }),
      row("split-new", { enriched_transaction_id: "tx-new" })
    ]
  });

  const summary = await deletePlaidItemLedgerData({
    client: client.asClient(),
    itemId: "item-old",
    userId
  });

  assert.deepEqual(summary, {
    accountsDeleted: 1,
    agentProposalsDeleted: 4,
    auditEventsDeleted: 5,
    balanceSnapshotsDeleted: 1,
    enrichedTransactionsDeleted: 1,
    plaidSyncRunItemsDeleted: 1,
    rawTransactionsDeleted: 1,
    recurringExpensesDeleted: 2,
    reimbursementRecordsDeleted: 2,
    reviewItemsDeleted: 1,
    transactionSplitsDeleted: 1
  });
  assert.deepEqual(client.ids("accounts"), ["account-new"]);
  assert.deepEqual(client.ids("raw_transactions"), ["raw-new"]);
  assert.deepEqual(client.ids("enriched_transactions"), ["tx-new"]);
  assert.deepEqual(client.ids("reimbursement_records"), ["reimbursement-new"]);
  assert.deepEqual(client.ids("recurring_expenses"), ["recurring-new"]);
  assert.deepEqual(client.ids("agent_proposals"), ["proposal-new"]);
  assert.deepEqual(client.ids("audit_events"), ["audit-new"]);
  assert.deepEqual(client.ids("plaid_items"), ["item-old", "item-new"]);
  assert.deepEqual(client.ids("plaid_sync_run_items"), ["sync-item-new"]);
});

test("Plaid item ledger purge leaves rows for other users intact", async () => {
  const client = new PurgeFinanceClient({
    accounts: [
      row("account-old", { plaid_item_id: "item-old" }),
      otherUserRow("other-account", { plaid_item_id: "item-old" })
    ],
    balance_snapshots: [
      row("snapshot-old", { account_id: "account-old" }),
      otherUserRow("other-snapshot", { account_id: "account-old" })
    ],
    enriched_transactions: [
      row("tx-old", { account_id: "account-old", raw_transaction_id: "raw-old" }),
      otherUserRow("other-tx", { account_id: "account-old", raw_transaction_id: "raw-old" })
    ],
    plaid_items: [
      row("item-old"),
      otherUserRow("other-item")
    ],
    raw_transactions: [
      row("raw-old", { account_id: "account-old", plaid_item_id: "item-old" }),
      otherUserRow("other-raw", { account_id: "account-old", plaid_item_id: "item-old" })
    ]
  });

  await deletePlaidItemLedgerData({
    client: client.asClient(),
    itemId: "item-old",
    userId
  });

  assert.deepEqual(client.ids("accounts"), ["other-account"]);
  assert.deepEqual(client.ids("balance_snapshots"), ["other-snapshot"]);
  assert.deepEqual(client.ids("enriched_transactions"), ["other-tx"]);
  assert.deepEqual(client.ids("raw_transactions"), ["other-raw"]);
  assert.deepEqual(client.ids("plaid_items"), ["item-old", "other-item"]);
});

test("Plaid item ledger purge skips optional tables missing from local schema", async () => {
  const client = new PurgeFinanceClient(
    {
      accounts: [
        row("account-old", { plaid_item_id: "item-old" })
      ],
      balance_snapshots: [
        row("snapshot-old", { account_id: "account-old" })
      ],
      enriched_transactions: [
        row("tx-old", { account_id: "account-old", raw_transaction_id: "raw-old" })
      ],
      plaid_items: [
        row("item-old")
      ],
      raw_transactions: [
        row("raw-old", { account_id: "account-old", plaid_item_id: "item-old" })
      ]
    },
    [
      "agent_proposals",
      "audit_events",
      "plaid_sync_run_items",
      "recurring_expenses",
      "reimbursement_records",
      "review_items",
      "transaction_splits"
    ]
  );

  const summary = await deletePlaidItemLedgerData({
    client: client.asClient(),
    itemId: "item-old",
    userId
  });

  assert.deepEqual(summary, {
    accountsDeleted: 1,
    agentProposalsDeleted: 0,
    auditEventsDeleted: 0,
    balanceSnapshotsDeleted: 1,
    enrichedTransactionsDeleted: 1,
    plaidSyncRunItemsDeleted: 0,
    rawTransactionsDeleted: 1,
    recurringExpensesDeleted: 0,
    reimbursementRecordsDeleted: 0,
    reviewItemsDeleted: 0,
    transactionSplitsDeleted: 0
  });
  assert.deepEqual(client.ids("accounts"), []);
  assert.deepEqual(client.ids("plaid_items"), ["item-old"]);
});

test("revokePlaidConnection preserves history and revokes locally when Plaid removal API fails", async () => {
  await withPlaidTokenEnv(async () => {
    const ciphertext = encryptPlaidAccessToken("access-token-old");
    const client = new PurgeFinanceClient(revokeTables(ciphertext));
    const plaidClient = {
      itemRemove: async () => {
        throw plaidApiError("API_ERROR", 500);
      }
    };

    const connection = await revokePlaidConnection({
      client: client.asClient(),
      itemId: "item-old",
      plaidClient,
      userId
    });

    assert.equal(connection.status, "revoked");
    assert.deepEqual(client.ids("accounts"), ["account-old"]);
    assert.deepEqual(client.ids("raw_transactions"), ["raw-old"]);
    assert.deepEqual(client.ids("plaid_items"), ["item-old"]);
    assert.equal(client.row("plaid_items", "item-old")?.status, "revoked");
    assert.equal(client.row("plaid_items", "item-old")?.transaction_cursor, null);
    assert.notEqual(client.row("plaid_items", "item-old")?.access_token_ciphertext, ciphertext);
  });
});

test("revokePlaidConnection preserves history and revokes locally when Plaid removal has no provider response", async () => {
  await withPlaidTokenEnv(async () => {
    const ciphertext = encryptPlaidAccessToken("access-token-old");
    const client = new PurgeFinanceClient(revokeTables(ciphertext));
    const plaidClient = {
      itemRemove: async () => {
        throw new Error("network unavailable");
      }
    };

    const connection = await revokePlaidConnection({
      client: client.asClient(),
      itemId: "item-old",
      plaidClient,
      userId
    });

    assert.equal(connection.status, "revoked");
    assert.deepEqual(client.ids("accounts"), ["account-old"]);
    assert.deepEqual(client.ids("raw_transactions"), ["raw-old"]);
    assert.equal(client.row("plaid_items", "item-old")?.status, "revoked");
    assert.equal(client.row("plaid_items", "item-old")?.transaction_cursor, null);
    assert.notEqual(client.row("plaid_items", "item-old")?.access_token_ciphertext, ciphertext);
  });
});

test("revokePlaidConnection preserves history for terminal Plaid removal errors and keeps a revoked tombstone", async () => {
  await withPlaidTokenEnv(async () => {
    const ciphertext = encryptPlaidAccessToken("access-token-old");
    const client = new PurgeFinanceClient(revokeTables(ciphertext));
    const plaidClient = {
      itemRemove: async () => {
        throw plaidApiError("ITEM_NOT_FOUND", 400);
      }
    };

    const connection = await revokePlaidConnection({
      client: client.asClient(),
      itemId: "item-old",
      plaidClient,
      userId
    });

    assert.equal(connection.status, "revoked");
    assert.deepEqual(client.ids("accounts"), ["account-old"]);
    assert.deepEqual(client.ids("raw_transactions"), ["raw-old"]);
    assert.deepEqual(client.ids("plaid_items"), ["item-old"]);
    assert.equal(client.row("plaid_items", "item-old")?.status, "revoked");
    assert.equal(client.row("plaid_items", "item-old")?.transaction_cursor, null);
    assert.notEqual(client.row("plaid_items", "item-old")?.access_token_ciphertext, ciphertext);
  });
});

test("revokePlaidConnection can revoke locally when stored token ciphertext is unsupported", async () => {
  await withPlaidTokenEnv(async () => {
    const ciphertext = "unsupported-ciphertext";
    const client = new PurgeFinanceClient(revokeTables(ciphertext));

    const connection = await revokePlaidConnection({
      client: client.asClient(),
      itemId: "item-old",
      userId
    });

    assert.equal(connection.status, "revoked");
    assert.deepEqual(client.ids("accounts"), ["account-old"]);
    assert.deepEqual(client.ids("raw_transactions"), ["raw-old"]);
    assert.equal(client.row("plaid_items", "item-old")?.status, "revoked");
    assert.equal(client.row("plaid_items", "item-old")?.transaction_cursor, null);
    assert.notEqual(client.row("plaid_items", "item-old")?.access_token_ciphertext, ciphertext);
  });
});

test("realtime balance fetch only runs for items with the Balance product", () => {
  assert.equal(isPlaidRealtimeBalanceAuthorized({
    available_products: ["transactions"],
    billed_products: ["transactions"]
  }), false);
  assert.equal(isPlaidRealtimeBalanceAuthorized({
    available_products: ["balance"],
    billed_products: ["transactions"]
  }), true);
  assert.equal(isPlaidRealtimeBalanceAuthorized({
    available_products: ["transactions"],
    billed_products: [Products.Balance]
  }), true);
});

test("opportunistic Plaid sync running helper ignores stale runs", () => {
  const now = new Date("2026-05-16T12:00:00.000Z");

  assert.equal(isRecentRunningPlaidSync(null, now), false);
  assert.equal(isRecentRunningPlaidSync({ started_at: "2026-05-16T11:45:00.000Z", status: "running" }, now), true);
  assert.equal(isRecentRunningPlaidSync({ started_at: "2026-05-16T11:00:00.000Z", status: "running" }, now), false);
  assert.equal(isRecentRunningPlaidSync({ started_at: "not-a-date", status: "running" }, now), true);
  assert.equal(isRecentRunningPlaidSync({ started_at: "2026-05-16T11:45:00.000Z", status: "succeeded" }, now), false);
});

test("opportunistic Plaid sync skips when app-open sync is disabled", async () => {
  const client = new PurgeFinanceClient({
    plaid_items: [
      {
        ...plaidItemRow("unsupported-ciphertext"),
        auto_sync_enabled: false,
        last_successful_sync_at: "2026-05-15T08:00:00.000Z"
      }
    ],
    plaid_sync_runs: []
  });

  const result = await syncOpportunisticPlaidConnections(
    client.asClient(),
    userId,
    new Date("2026-05-17T12:00:00.000Z")
  );

  assert.equal(result.reason, "no_items");
  assert.equal(result.sync, null);
  assert.deepEqual(client.ids("plaid_sync_runs"), []);
});

test("opportunistic Plaid sync skips manual placeholders even when app-open sync is enabled", async () => {
  const client = new PurgeFinanceClient({
    plaid_items: [
      {
        ...plaidItemRow("manual-no-provider:placeholder"),
        auto_sync_enabled: true,
        connection_source: "manual",
        error_code: "PLAID_TOKEN_DECRYPTION_ERROR",
        last_successful_sync_at: null,
        status: "error"
      }
    ],
    plaid_sync_runs: []
  });

  const result = await syncOpportunisticPlaidConnections(
    client.asClient(),
    userId,
    new Date("2026-05-17T12:00:00.000Z")
  );

  assert.equal(result.reason, "no_items");
  assert.equal(result.sync, null);
  assert.deepEqual(client.ids("plaid_sync_runs"), []);
  assert.equal(client.row("plaid_items", "item-old")?.status, "error");
  assert.equal(client.row("plaid_items", "item-old")?.error_code, "PLAID_TOKEN_DECRYPTION_ERROR");
});

function row(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    user_id: userId,
    ...fields
  };
}

function otherUserRow(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    user_id: otherUserId,
    ...fields
  };
}

function plaidApiError(errorCode: string, status: number) {
  return {
    response: {
      data: {
        error_code: errorCode,
        error_type: "ITEM_ERROR",
        request_id: "request-id"
      },
      status
    }
  };
}

function institutionRow() {
  return {
    created_at: "2026-05-01T08:00:00.000Z",
    id: "institution-old",
    logo_url: null,
    name: "Old Bank",
    plaid_institution_id: "ins-old",
    primary_color: null,
    updated_at: "2026-05-01T08:00:00.000Z",
    user_id: userId,
    website_url: null
  };
}

function plaidItemRow(ciphertext: string) {
  return {
    access_token_ciphertext: ciphertext,
    available_products: ["transactions"],
    billed_products: ["transactions"],
    connection_source: "plaid",
    consent_expires_at: null,
    created_at: "2026-05-01T08:00:00.000Z",
    error_code: null,
    error_message: null,
    id: "item-old",
    institution_id: "institution-old",
    last_successful_sync_at: "2026-05-01T08:00:00.000Z",
    plaid_item_id: "provider-item-old",
    status: "active",
    transaction_cursor: "cursor-old",
    auto_sync_enabled: true,
    updated_at: "2026-05-01T08:00:00.000Z",
    user_id: userId
  };
}

function revokeTables(ciphertext: string) {
  return {
    accounts: [
      row("account-old", { plaid_item_id: "item-old" })
    ],
    balance_snapshots: [
      row("snapshot-old", { account_id: "account-old" })
    ],
    enriched_transactions: [
      row("tx-old", { account_id: "account-old", raw_transaction_id: "raw-old" })
    ],
    institutions: [
      institutionRow()
    ],
    plaid_items: [
      plaidItemRow(ciphertext)
    ],
    raw_transactions: [
      row("raw-old", { account_id: "account-old", plaid_item_id: "item-old" })
    ]
  };
}

class PurgeQueryBuilder {
  private filters: Array<(row: Record<string, unknown>) => boolean> = [];
  private maybeSingleResult = false;
  private singleResult = false;

  constructor(
    private rows: Array<Record<string, unknown>>,
    private operation: "delete" | "select" | "update",
    private error: { code: string; message: string } | null = null,
    private values: Record<string, unknown> = {}
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  select() {
    return this;
  }

  maybeSingle() {
    this.maybeSingleResult = true;
    return this;
  }

  single() {
    this.singleResult = true;
    return this;
  }

  then<TResult1 = PurgeQueryResult, TResult2 = never>(
    onfulfilled?: ((value: PurgeQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): PurgeQueryResult {
    if (this.error) return { data: null, error: this.error };

    const matches = this.rows.filter((row) => this.filters.every((filter) => filter(row)));

    if (this.operation === "update") {
      matches.forEach((row) => Object.assign(row, this.values));
    }

    if (this.operation === "delete") {
      const deletedIds = new Set(matches.map((row) => row.id));
      for (let index = this.rows.length - 1; index >= 0; index -= 1) {
        if (deletedIds.has(this.rows[index]?.id)) {
          this.rows.splice(index, 1);
        }
      }
    }

    return {
      data: this.singleResult || this.maybeSingleResult ? matches[0] ?? null : matches,
      error: null
    };
  }
}

type PurgeQueryResult =
  | { data: Array<Record<string, unknown>> | Record<string, unknown> | null; error: null }
  | { data: null; error: { code: string; message: string } };

class PurgeFinanceClient {
  private tables: Record<string, Array<Record<string, unknown>>>;
  private missingTables: Set<string>;

  constructor(tables: Record<string, Array<Record<string, unknown>>>, missingTables: string[] = []) {
    this.tables = tables;
    this.missingTables = new Set(missingTables);
  }

  asClient() {
    return this as unknown as SupabaseClient;
  }

  ids(table: string) {
    return (this.tables[table] ?? []).map((row) => row.id as string);
  }

  from(table: string) {
    const rows = this.tables[table] ?? [];
    this.tables[table] = rows;
    const error = this.missingTables.has(table)
      ? {
        code: "PGRST205",
        message: `Could not find the table 'public.${table}' in the schema cache`
      }
      : null;

    return {
      delete: () => new PurgeQueryBuilder(rows, "delete", error),
      select: () => new PurgeQueryBuilder(rows, "select", error),
      update: (values: Record<string, unknown>) => new PurgeQueryBuilder(rows, "update", error, values)
    };
  }

  row(table: string, id: string) {
    return (this.tables[table] ?? []).find((row) => row.id === id);
  }
}

function assertPlaidAccountSourceMergeFixtures(): true {
  if (!plaidAccountsGetFallbackFixture.some((item) => item.account_id === "acct-get")) {
    throw new Error("Expected accounts/get accounts to sync when transactions/sync returns no account rows.");
  }

  if (plaidAccountSourceMergeFixture.length !== 2) {
    throw new Error("Expected duplicate Plaid account ids to be collapsed across account sources.");
  }

  const dedupedAccount = plaidAccountSourceMergeFixture.find((item) => item.account_id === "acct-get");
  if (dedupedAccount?.name !== "Accounts balance account") {
    throw new Error("Expected accounts/balance rows to win when they refresh an accounts/get account.");
  }

  return true;
}

function assertPlaidPendingReplacementFixtures(): true {
  const replacements = planPendingRawTransactionReplacements({
    existingPendingRows: [
      {
        id: "raw-pending",
        plaid_transaction_id: "pending-tx",
        status: "pending"
      }
    ],
    incomingRows: [
      {
        pending_transaction_id: "pending-tx",
        plaid_transaction_id: "posted-tx",
        status: "posted"
      }
    ]
  });

  if (replacements[0]?.rawTransactionId !== "raw-pending") {
    throw new Error("Expected posted Plaid transaction to replace the matching pending raw row.");
  }

  if (shouldRefreshImportedEnrichment({ reviewed_at: null, source: "manual" })) {
    throw new Error("Expected manual enrichment to survive imported transaction updates.");
  }

  const removedIds = getRemovedPlaidTransactionIdsToDelete(
    [{ transaction_id: "pending-tx" }, { transaction_id: "removed-tx" }],
    new Set(["pending-tx"])
  );

  if (removedIds.includes("pending-tx") || removedIds[0] !== "removed-tx") {
    throw new Error("Expected removed pending id to be ignored after posted replacement.");
  }

  return true;
}
