import assert from "node:assert/strict";
import test from "node:test";
import { AccountType as PlaidAccountType, type AccountBase, type Transaction } from "plaid";
import {
  getDefaultConfidence,
  getRemovedPlaidTransactionIdsToDelete,
  isSkippablePlaidTransactionsError,
  mergePlaidAccountSourcesForSync,
  planPendingRawTransactionReplacements,
  shouldRefreshImportedEnrichment,
  shouldRefreshPlaidEnrichment,
  summarizeSyncRun
} from "./service";

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
        transactionsRemoved: 0
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
  assert.equal(summary.rawTransactionsUpserted, 4);
  assert.equal("plaidItemId" in summary.items[0], false);
  assert.equal("transactionCursor" in summary.items[0], false);
});

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
