import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord, AnomalyAlertRecord, TransactionRecord } from "@/lib/db";
import {
  analyzeAnomalies,
  reconcileAnomalyAlerts
} from "./analyzer";
import {
  detectDuplicateCharges,
  detectHighCardBalances,
  detectLargeTransactions,
  detectStaleSync
} from "./detectors";
import { buildOpenClawAnomalyPackets } from "./packet";

const userId = "11111111-1111-4111-8111-111111111111";

function account(input: Partial<AccountRecord> = {}): AccountRecord {
  return {
    availableBalance: null,
    balance: 100,
    color: null,
    creditLimit: null,
    currency: "USD",
    id: "account-1",
    institutionId: "institution-1",
    institutionName: "Test Bank",
    isActive: true,
    lastSyncedAt: "2026-06-04T08:00:00.000Z",
    mask: "1234",
    name: "Checking",
    officialName: null,
    plaidAccountId: "plaid-account-1",
    subtype: null,
    type: "depository",
    userId,
    ...input
  };
}

function transaction(input: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    accountId: "account-1",
    accountMask: "1234",
    accountName: "Checking",
    amount: -25,
    category: "Dining",
    categoryId: "category-1",
    confidence: 0.95,
    date: "2026-06-01",
    id: "tx-1",
    institutionName: "Test Bank",
    intent: "personal",
    merchant: "Coffee Shop",
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidName: null,
    plaidTransactionId: null,
    rawTransactionId: "raw-1",
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId,
    ...input
  };
}

function alert(input: Partial<AnomalyAlertRecord> = {}): AnomalyAlertRecord {
  return {
    body: "Body",
    createdAt: "2026-06-04T08:00:00.000Z",
    dedupeKey: "large_transaction:tx-1",
    detectedAt: "2026-06-04T08:00:00.000Z",
    dismissedAt: null,
    evidence: {},
    firstSeenAt: "2026-06-04T08:00:00.000Z",
    id: "alert-1",
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

test("detectors find duplicate, large, high-card, and stale-sync alerts with minimized evidence", () => {
  const input = {
    accounts: [
      account({
        balance: 960,
        creditLimit: 1000,
        id: "card-1",
        name: "Rewards Card",
        type: "credit"
      }),
      account({
        id: "stale-account",
        lastSyncedAt: "2026-05-30T08:00:00.000Z",
        name: "Old Checking"
      })
    ],
    now: new Date("2026-06-04T12:00:00.000Z"),
    transactions: [
      transaction({ id: "tx-1", merchant: "Cafe", amount: -12.34, date: "2026-06-01" }),
      transaction({ id: "tx-2", merchant: "Cafe", amount: -12.34, date: "2026-06-03" }),
      transaction({ id: "tx-large", merchant: "Contractor", amount: -5200, date: "2026-06-02" })
    ]
  };

  assert.equal(detectDuplicateCharges(input).length, 1);
  assert.equal(detectLargeTransactions(input)[0]?.severity, "critical");
  assert.equal(detectHighCardBalances(input)[0]?.reasonCode, "high_card_balance");
  assert.equal(detectStaleSync(input)[0]?.dedupeKey, "stale_sync:stale-account");
});

test("spending anomaly detectors ignore pending Plaid holds", () => {
  const input = {
    accounts: [],
    transactions: [
      transaction({ id: "pending-large", amount: -6000, merchant: "Hotel", status: "pending" }),
      transaction({ id: "pending-dupe-1", amount: -120, merchant: "Rental Car", status: "pending" }),
      transaction({ id: "pending-dupe-2", amount: -120, merchant: "Rental Car", date: "2026-06-02", status: "pending" })
    ]
  };

  assert.deepEqual(detectLargeTransactions(input), []);
  assert.deepEqual(detectDuplicateCharges(input), []);
});

test("stale sync detector ignores manual and app-open-disabled accounts", () => {
  const input = {
    accounts: [
      account({
        id: "manual-investment",
        lastSyncedAt: null,
        name: "Manual Fidelity",
        plaidConnectionSource: "manual",
        type: "investment"
      }),
      account({
        id: "sync-disabled",
        lastSyncedAt: "2026-05-30T08:00:00.000Z",
        name: "Paused Checking",
        plaidAutoSyncEnabled: false
      }),
      account({
        id: "syncable-stale",
        lastSyncedAt: "2026-05-30T08:00:00.000Z",
        name: "Old Checking"
      })
    ],
    now: new Date("2026-06-04T12:00:00.000Z"),
    transactions: []
  };

  assert.deepEqual(detectStaleSync(input).map((draft) => draft.dedupeKey), ["stale_sync:syncable-stale"]);
});

test("analyzer de-duplicates and sorts drafts by severity", () => {
  const drafts = analyzeAnomalies({
    accounts: [],
    transactions: [
      transaction({ id: "tx-small", amount: -1600, merchant: "Appliance", date: "2026-06-01" }),
      transaction({ id: "tx-critical", amount: -6000, merchant: "Roof", date: "2026-06-02" })
    ]
  });

  assert.deepEqual(drafts.map((draft) => draft.severity), ["critical", "warning"]);
  assert.deepEqual(drafts.map((draft) => draft.reasonCode), ["large_transaction", "large_transaction"]);
});

test("reconciliation creates new alerts and refreshes only pending matches", () => {
  const drafts = [
    {
      body: "Large charge",
      dedupeKey: "large_transaction:tx-1",
      evidence: {},
      reasonCode: "large_transaction" as const,
      severity: "warning" as const,
      title: "Large charge"
    },
    {
      body: "Large charge",
      dedupeKey: "large_transaction:tx-2",
      evidence: {},
      reasonCode: "large_transaction" as const,
      severity: "warning" as const,
      title: "Large charge"
    }
  ];

  const result = reconcileAnomalyAlerts(drafts, [
    alert({ dedupeKey: "large_transaction:tx-1", id: "pending-alert", status: "pending" }),
    alert({ dedupeKey: "large_transaction:tx-dismissed", id: "dismissed-alert", status: "dismissed" })
  ]);

  assert.deepEqual(result.toCreate.map((draft) => draft.dedupeKey), ["large_transaction:tx-2"]);
  assert.deepEqual(result.toRefresh, ["pending-alert"]);
  assert.deepEqual(result.suppressed.map((draft) => draft.dedupeKey), ["large_transaction:tx-1"]);
});

test("OpenClaw anomaly packets expose delivery copy without evidence ids", () => {
  const response = buildOpenClawAnomalyPackets([
    alert({
      body: "A very large card charge needs review.",
      evidence: { transactionIds: ["tx-secret"] },
      id: "alert-1",
      severity: "critical",
      title: "Large card charge"
    })
  ], {
    generatedAt: "2026-06-04T12:00:00.000Z"
  });

  assert.equal(response.packets.length, 1);
  assert.equal(response.packets[0]?.priority, "high");
  assert.equal("evidence" in response.packets[0]!, false);
  assert.equal(JSON.stringify(response).includes("tx-secret"), false);
});
