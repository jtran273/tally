import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlaidConnectionsStatusSummary,
  formatPlaidSyncResultMessage,
  getPlaidConnectionIssue,
  getPlaidSyncResultErrorDetails,
  type PlaidConnectionStatusInput
} from "./status";

function connection(overrides: Partial<PlaidConnectionStatusInput> = {}): PlaidConnectionStatusInput {
  return {
    errorCode: null,
    lastSuccessfulSyncAt: "2026-05-07T12:00:00.000Z",
    status: "active",
    ...overrides
  };
}

test("Plaid connection issues use safe repair copy for common item errors", () => {
  assert.deepEqual(
    getPlaidConnectionIssue(connection({ errorCode: "ITEM_LOGIN_REQUIRED", status: "error" })),
    {
      action: "repair",
      detail: "Plaid needs the institution connection refreshed before new balances or transactions can import.",
      title: "Repair required"
    }
  );

  assert.equal(
    getPlaidConnectionIssue(connection({ errorCode: "PRODUCT_NOT_READY", status: "error" }))?.action,
    "wait"
  );
  assert.equal(
    getPlaidConnectionIssue(connection({ errorCode: "INVALID_PRODUCT" }))?.action,
    "wait"
  );
  assert.equal(
    getPlaidConnectionIssue(connection({ errorCode: "INVALID_ACCESS_TOKEN", status: "error" }))?.action,
    "reconnect"
  );
});

test("Plaid server configuration errors use actionable safe copy", () => {
  assert.deepEqual(
    getPlaidConnectionIssue(connection({ errorCode: "PLAID_CONFIGURATION_ERROR", status: "error" })),
    {
      action: "retry",
      detail: "Plaid server configuration needs attention before sync can run. Check production environment variables and retry sync.",
      title: "Server configuration issue"
    }
  );
});

test("generic Plaid request failures use retryable copy instead of a raw fallback label", () => {
  assert.deepEqual(
    getPlaidConnectionIssue(connection({ errorCode: "PLAID_REQUEST_FAILED", status: "error" })),
    {
      action: "retry",
      detail: "Plaid did not return a specific item error for the last request. Retry sync; if it repeats, check safe server logs for the Plaid request id.",
      title: "Plaid request failed"
    }
  );
});

test("internal sync failures use save-failure copy instead of a Plaid request label", () => {
  assert.deepEqual(
    getPlaidConnectionIssue(connection({ errorCode: "PLAID_SYNC_INTERNAL_ERROR", status: "error" })),
    {
      action: "retry",
      detail: "Plaid returned data, but Tally could not finish saving the imported sync result. Check safe server logs for the failing sync step.",
      title: "Sync save failed"
    }
  );
});

test("Plaid token decryption errors ask for reconnect while preserving balance context", () => {
  assert.deepEqual(
    getPlaidConnectionIssue(connection({
      errorCode: "PLAID_TOKEN_DECRYPTION_ERROR",
      institutionName: "SchoolsFirst Federal Credit Union",
      status: "error"
    })),
    {
      action: "reconnect",
      detail: "Tally can still show saved balances for SchoolsFirst Federal Credit Union, but transaction sync cannot run because the bank connection token is unreadable. Reconnect the institution to resume imports.",
      title: "Reconnect SchoolsFirst Federal Credit Union"
    }
  );
});

test("Plaid connection summary derives latest sync and repair counts without provider identifiers", () => {
  const summary = buildPlaidConnectionsStatusSummary([
    connection({ lastSuccessfulSyncAt: "2026-05-06T12:00:00.000Z" }),
    connection({
      errorCode: "ITEM_LOGIN_REQUIRED",
      lastSuccessfulSyncAt: "2026-05-07T12:00:00.000Z",
      status: "error"
    }),
    connection({ status: "revoked" })
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.syncable, 2);
  assert.equal(summary.needsRepair, 1);
  assert.equal(summary.status, "needs_attention");
  assert.equal(summary.latestSuccessfulSyncAt, "2026-05-07T12:00:00.000Z");
  assert.equal("plaidItemId" in summary, false);
});

test("Plaid connection summary distinguishes empty and never-synced states", () => {
  assert.equal(buildPlaidConnectionsStatusSummary([]).status, "empty");
  assert.equal(
    buildPlaidConnectionsStatusSummary([connection({ lastSuccessfulSyncAt: null })]).status,
    "never_synced"
  );
});

test("Plaid connection summary ignores invalid latest sync timestamps", () => {
  const summary = buildPlaidConnectionsStatusSummary([
    connection({ lastSuccessfulSyncAt: "not-a-date" }),
    connection({ lastSuccessfulSyncAt: "2026-05-07T12:00:00.000Z" }),
    connection({ lastSuccessfulSyncAt: "2026-05-06T12:00:00.000Z" })
  ]);

  assert.equal(summary.latestSuccessfulSyncAt, "2026-05-07T12:00:00.000Z");
  assert.equal(summary.status, "healthy");
});

test("Plaid connection summary treats all invalid sync timestamps as never synced", () => {
  const summary = buildPlaidConnectionsStatusSummary([
    connection({ lastSuccessfulSyncAt: "not-a-date" })
  ]);

  assert.equal(summary.latestSuccessfulSyncAt, null);
  assert.equal(summary.status, "never_synced");
});

test("Plaid connection issues treat invalid sync timestamps as never synced", () => {
  assert.deepEqual(
    getPlaidConnectionIssue(connection({ lastSuccessfulSyncAt: "not-a-date" })),
    {
      action: "retry",
      detail: "This connection has not completed a successful sync yet.",
      title: "Never synced"
    }
  );
});

test("Plaid connection summary does not mark revoked-only connections healthy", () => {
  const summary = buildPlaidConnectionsStatusSummary([
    connection({ status: "revoked" })
  ]);

  assert.equal(summary.revoked, 1);
  assert.equal(summary.syncable, 0);
  assert.equal(summary.status, "needs_attention");
});

test("Plaid sync result messages include safe API error details", () => {
  const sync = {
    accountsUpserted: 0,
    enrichedTransactionsInserted: 0,
    enrichedTransactionsUpdated: 0,
    failed: 2,
    items: [
      { errorCode: "PLAID_CONFIGURATION_ERROR", errorMessage: "Plaid configuration is incomplete." },
      { errorCode: "PLAID_CONFIGURATION_ERROR", errorMessage: "Plaid configuration is incomplete." }
    ],
    rawTransactionsUpserted: 0,
    status: "failed" as const
  };

  assert.equal(
    getPlaidSyncResultErrorDetails(sync),
    "PLAID_CONFIGURATION_ERROR: Plaid configuration is incomplete."
  );
  assert.equal(
    formatPlaidSyncResultMessage(sync),
    "Sync incomplete: 0 accounts, 0 raw transactions, 0 enriched transactions, 2 failures. PLAID_CONFIGURATION_ERROR: Plaid configuration is incomplete."
  );
});

test("Plaid sync result messages explain token decryption reconnects", () => {
  const sync = {
    accountsUpserted: 0,
    enrichedTransactionsInserted: 0,
    enrichedTransactionsUpdated: 0,
    failed: 1,
    items: [
      { errorCode: "PLAID_TOKEN_DECRYPTION_ERROR" }
    ],
    rawTransactionsUpserted: 0,
    status: "failed" as const
  };

  assert.equal(
    getPlaidSyncResultErrorDetails(sync),
    "PLAID_TOKEN_DECRYPTION_ERROR: Reconnect the institution. Tally can still show saved balances, but transaction sync cannot run because the bank connection token is unreadable."
  );
});

test("Plaid sync result messages explain generic request failures without provider details", () => {
  const sync = {
    accountsUpserted: 7,
    enrichedTransactionsInserted: 2,
    enrichedTransactionsUpdated: 0,
    failed: 1,
    items: [
      { errorCode: "PLAID_REQUEST_FAILED", errorMessage: "Plaid sync failed. Request ID: request_123." }
    ],
    rawTransactionsUpserted: 2,
    status: "partial" as const
  };

  assert.equal(
    getPlaidSyncResultErrorDetails(sync),
    "PLAID_REQUEST_FAILED: Plaid did not return a specific item error for this request. Retry sync; if it repeats, inspect safe server logs."
  );
  assert.equal(
    formatPlaidSyncResultMessage(sync),
    "Sync incomplete: 7 accounts, 2 raw transactions, 2 enriched transactions, 1 failures. PLAID_REQUEST_FAILED: Plaid did not return a specific item error for this request. Retry sync; if it repeats, inspect safe server logs."
  );
});

test("Plaid sync result messages surface concrete safe backend reasons", () => {
  assert.equal(
    getPlaidSyncResultErrorDetails({
      failed: 1,
      items: [
        {
          errorCode: "PLAID_REQUEST_FAILED",
          errorMessage: "Plaid request failed with HTTP status 502, Plaid error type API_ERROR."
        }
      ],
      status: "partial"
    }),
    "PLAID_REQUEST_FAILED: Plaid request failed with HTTP status 502, Plaid error type API_ERROR."
  );

  assert.equal(
    getPlaidSyncResultErrorDetails({
      failed: 1,
      items: [
        {
          errorCode: "PLAID_SYNC_INTERNAL_ERROR",
          errorMessage: "Tally sync failed while saving imported Plaid data during Upsert raw Plaid transactions."
        }
      ],
      status: "partial"
    }),
    "PLAID_SYNC_INTERNAL_ERROR: Tally sync failed while saving imported Plaid data during Upsert raw Plaid transactions."
  );
});

test("Plaid sync result messages include skipped raw transaction counts and warnings", () => {
  const sync = {
    accountsUpserted: 2,
    enrichedTransactionsInserted: 0,
    enrichedTransactionsUpdated: 0,
    failed: 0,
    items: [
      {
        warningCode: "PRODUCT_NOT_ENABLED",
        warningMessage: "Plaid transactions are not available for this connection yet."
      }
    ],
    rawTransactionsSkipped: 3,
    rawTransactionsUpserted: 0,
    status: "succeeded" as const
  };

  assert.equal(
    getPlaidSyncResultErrorDetails(sync),
    "PRODUCT_NOT_ENABLED: Plaid transactions are not available for this connection yet."
  );
  assert.equal(
    formatPlaidSyncResultMessage(sync),
    "Sync complete: 2 accounts, 0 raw transactions, 3 skipped, 0 enriched transactions, 0 failures. PRODUCT_NOT_ENABLED: Plaid transactions are not available for this connection yet."
  );
});

test("Plaid sync result messages tolerate incomplete failed payloads", () => {
  const sync = {
    failed: null,
    items: null,
    status: "failed" as const
  };

  assert.equal(getPlaidSyncResultErrorDetails(sync), null);
  assert.equal(
    formatPlaidSyncResultMessage(sync),
    "Sync incomplete: 0 accounts, 0 raw transactions, 0 enriched transactions, 0 failures."
  );
});
