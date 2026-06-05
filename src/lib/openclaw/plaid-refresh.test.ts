import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantContextSafe } from "@/lib/agents";
import type { PlaidOpportunisticSyncSummary, PlaidSyncRunSummary } from "@/lib/plaid/service";
import { buildOpenClawPlaidRefreshResponse } from "./plaid-refresh";

function syncSummary(input: Partial<PlaidSyncRunSummary> = {}): PlaidSyncRunSummary {
  return {
    accountsUpserted: 1,
    balanceSnapshotsUpserted: 1,
    enrichedTransactionsInserted: 2,
    enrichedTransactionsUpdated: 3,
    failed: 0,
    items: [],
    pendingTransactionsReplaced: 0,
    rawTransactionsSkipped: 0,
    rawTransactionsUpserted: 5,
    runId: "sync-run-1",
    source: "opportunistic",
    startedAt: "2026-05-21T12:00:00.000Z",
    status: "succeeded",
    succeeded: 1,
    totalItems: 1,
    transactionsRemoved: 0,
    ...input
  };
}

test("OpenClaw Plaid refresh response summarizes successful sync safely", () => {
  const response = buildOpenClawPlaidRefreshResponse(
    {
      checkedAt: "2026-05-21T12:00:00.000Z",
      reason: "synced",
      sync: syncSummary()
    },
    { finishedAt: "2026-05-21T12:00:03.000Z" }
  );

  assert.equal(response.object, "ledger.openclaw.plaid_refresh");
  assert.equal(response.status, "succeeded");
  assert.equal(response.durationMs, 3000);
  assert.equal(response.sync.totalItems, 1);
  assert.equal(response.sync.rawTransactionsUpserted, 5);
  assert.deepEqual(response.sync.errorSummary, []);
  assertAssistantContextSafe(response);
});

test("OpenClaw Plaid refresh response omits per-item ids and raw provider details", () => {
  const summary: PlaidOpportunisticSyncSummary = {
    checkedAt: "2026-05-21T12:00:00.000Z",
    reason: "synced",
    sync: syncSummary({
      failed: 1,
      items: [{
        accountsUpserted: 0,
        balanceSnapshotsUpserted: 0,
        enrichedTransactionsInserted: 0,
        enrichedTransactionsUpdated: 0,
        errorCode: "ITEM_LOGIN_REQUIRED",
        errorMessage: "The Plaid item requires repair.",
        id: "plaid-item-row-id",
        lastSuccessfulSyncAt: null,
        pendingTransactionsReplaced: 0,
        rawTransactionsSkipped: 0,
        rawTransactionsUpserted: 0,
        transactionsRemoved: 0
      }],
      status: "failed",
      succeeded: 0
    })
  };

  const response = buildOpenClawPlaidRefreshResponse(summary, {
    finishedAt: "2026-05-21T12:00:01.000Z"
  });
  const serialized = JSON.stringify(response);

  assert.equal(response.status, "failed");
  assert.deepEqual(response.sync.errorSummary, [{
    code: "ITEM_LOGIN_REQUIRED",
    count: 1,
    message: "The Plaid item requires repair."
  }]);
  assert.doesNotMatch(serialized, /plaid-item-row-id|access_token|service_role|accountMask/i);
  assertAssistantContextSafe(response);
});

test("OpenClaw Plaid refresh response handles skipped sync safely", () => {
  const response = buildOpenClawPlaidRefreshResponse(
    {
      checkedAt: "2026-05-21T12:00:00.000Z",
      reason: "no_items",
      sync: null
    },
    { finishedAt: "2026-05-21T12:00:00.000Z" }
  );

  assert.equal(response.status, "skipped");
  assert.equal(response.sync.totalItems, 0);
  assert.equal(response.sync.source, null);
  assertAssistantContextSafe(response);
});

test("OpenClaw Plaid refresh response rejects secret-shaped error messages", () => {
  assert.throws(
    () => buildOpenClawPlaidRefreshResponse({
      checkedAt: "2026-05-21T12:00:00.000Z",
      reason: "synced",
      sync: syncSummary({
        failed: 1,
        items: [{
          accountsUpserted: 0,
          balanceSnapshotsUpserted: 0,
          enrichedTransactionsInserted: 0,
          enrichedTransactionsUpdated: 0,
          errorCode: "PLAID_ERROR",
          errorMessage: "Bearer should-not-leak-this-token",
          id: "plaid-item-row-id",
          lastSuccessfulSyncAt: null,
          pendingTransactionsReplaced: 0,
          rawTransactionsSkipped: 0,
          rawTransactionsUpserted: 0,
          transactionsRemoved: 0
        }]
      })
    }),
    /forbidden data/
  );
});
