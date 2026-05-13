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

  assert.equal(
    getPlaidConnectionIssue(connection({ errorCode: "PLAID_TOKEN_DECRYPTION_ERROR", status: "error" }))?.title,
    "Server configuration issue"
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
