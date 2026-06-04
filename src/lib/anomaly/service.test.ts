import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord, AnomalyAlertRecord, TransactionRecord } from "@/lib/db";
import { runAnomalyAlertScan } from "./service";

const userId = "11111111-1111-4111-8111-111111111111";

function alert(input: Partial<AnomalyAlertRecord> = {}): AnomalyAlertRecord {
  return {
    body: "Body",
    createdAt: "2026-06-04T08:00:00.000Z",
    dedupeKey: "large_transaction:tx-existing",
    detectedAt: "2026-06-04T08:00:00.000Z",
    dismissedAt: null,
    evidence: {},
    firstSeenAt: "2026-06-04T08:00:00.000Z",
    id: "alert-existing",
    lastSeenAt: "2026-06-04T08:00:00.000Z",
    reasonCode: "large_transaction",
    resolvedAt: null,
    severity: "warning",
    status: "pending",
    title: "Title",
    updatedAt: "2026-06-04T08:00:00.000Z",
    userId,
    ...input
  };
}

test("runAnomalyAlertScan persists new alerts and refreshes existing pending alerts", async () => {
  const createdInputs: unknown[] = [];
  const refreshedIds: string[] = [];
  const existing = alert();

  const result = await runAnomalyAlertScan({} as never, userId, {
    now: new Date("2026-06-04T12:00:00.000Z")
  }, {
    analyzeAnomalies: () => [
      {
        body: "Existing large charge.",
        dedupeKey: "large_transaction:tx-existing",
        evidence: {},
        reasonCode: "large_transaction",
        severity: "warning",
        title: "Existing"
      },
      {
        body: "New large charge.",
        dedupeKey: "large_transaction:tx-new",
        evidence: {},
        reasonCode: "large_transaction",
        severity: "critical",
        title: "New"
      }
    ],
    createAnomalyAlerts: async (_client, _userId, inputs) => {
      createdInputs.push(...inputs);
      return inputs.map((input, index) => alert({
        body: input.body,
        dedupeKey: input.dedupeKey,
        id: `created-${index}`,
        reasonCode: input.reasonCode,
        severity: input.severity,
        title: input.title
      }));
    },
    listAccounts: async () => [] as AccountRecord[],
    listAnomalyAlerts: async () => [existing],
    listTransactions: async () => [] as TransactionRecord[],
    refreshAnomalyAlerts: async (_client, _userId, ids) => {
      refreshedIds.push(...ids);
      return ids.map((id) => alert({ id }));
    }
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.createdAlertCount, 1);
  assert.equal(result.refreshedAlertCount, 1);
  assert.equal(result.suppressedAlertCount, 1);
  assert.deepEqual(createdInputs.map((input) => (input as { dedupeKey: string }).dedupeKey), ["large_transaction:tx-new"]);
  assert.deepEqual(refreshedIds, ["alert-existing"]);
});

test("runAnomalyAlertScan returns a sanitized failed result when detection throws", async () => {
  const errors: unknown[] = [];
  const result = await runAnomalyAlertScan({} as never, userId, {
    now: new Date("2026-06-04T12:00:00.000Z")
  }, {
    analyzeAnomalies: () => {
      throw new Error("boom");
    },
    listAccounts: async () => [] as AccountRecord[],
    listAnomalyAlerts: async () => [],
    listTransactions: async () => [] as TransactionRecord[],
    logger: {
      error: (...args: unknown[]) => errors.push(args)
    }
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "detector_failed");
  assert.equal(result.createdAlertCount, 0);
  assert.equal(errors.length, 1);
});
