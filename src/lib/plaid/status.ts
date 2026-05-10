import type { PlaidItemStatus } from "@/lib/db/types";

export type PlaidConnectionIssueAction = "repair" | "retry" | "reconnect" | "wait";

export interface PlaidConnectionIssue {
  action: PlaidConnectionIssueAction;
  detail: string;
  title: string;
}

export interface PlaidConnectionStatusInput {
  errorCode: string | null;
  lastSuccessfulSyncAt: string | null;
  status: PlaidItemStatus;
}

export interface PlaidConnectionsStatusSummary {
  active: number;
  errored: number;
  latestSuccessfulSyncAt: string | null;
  needsRepair: number;
  revoked: number;
  status: "empty" | "healthy" | "needs_attention" | "never_synced";
  syncable: number;
  total: number;
}

export interface PlaidSyncResultItemInput {
  errorCode?: string;
  errorMessage?: string;
}

export interface PlaidSyncResultInput {
  accountsUpserted: number;
  enrichedTransactionsInserted: number;
  enrichedTransactionsUpdated: number;
  failed: number;
  items: readonly PlaidSyncResultItemInput[];
  rawTransactionsUpserted: number;
  status: "succeeded" | "partial" | "failed";
}

const REPAIR_ERROR_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "ITEM_LOCKED",
  "USER_PERMISSION_REVOKED",
  "INVALID_CREDENTIALS"
]);

const RECONNECT_ERROR_CODES = new Set([
  "INVALID_ACCESS_TOKEN",
  "ITEM_NOT_FOUND"
]);

const WAIT_ERROR_CODES = new Set([
  "PRODUCT_NOT_READY",
  "PRODUCT_NOT_ENABLED",
  "INSTITUTION_NOT_AVAILABLE"
]);

function normalizedCode(code: string | null) {
  return code?.trim().toUpperCase() ?? null;
}

export function getPlaidConnectionIssue(input: PlaidConnectionStatusInput): PlaidConnectionIssue | null {
  if (input.status === "revoked") {
    return {
      action: "reconnect",
      detail: "This institution was disconnected. Connect it again to resume future imports.",
      title: "Disconnected"
    };
  }

  const code = normalizedCode(input.errorCode);

  if (code && REPAIR_ERROR_CODES.has(code)) {
    return {
      action: "repair",
      detail: "Plaid needs the institution connection refreshed before new balances or transactions can import.",
      title: "Repair required"
    };
  }

  if (code && RECONNECT_ERROR_CODES.has(code)) {
    return {
      action: "reconnect",
      detail: "This connection can no longer be used for sync. Reconnect the institution to continue importing data.",
      title: "Reconnect required"
    };
  }

  if (code && WAIT_ERROR_CODES.has(code)) {
    return {
      action: "wait",
      detail: "Plaid has not finished making transaction data available. Retry sync later.",
      title: "Transactions pending"
    };
  }

  if (input.status === "error") {
    return {
      action: "retry",
      detail: "The last Plaid sync failed. Retry sync from Settings; server logs contain safe request metadata.",
      title: "Sync failed"
    };
  }

  if (!input.lastSuccessfulSyncAt) {
    return {
      action: "retry",
      detail: "This connection has not completed a successful sync yet.",
      title: "Never synced"
    };
  }

  return null;
}

export function buildPlaidConnectionsStatusSummary(
  connections: readonly PlaidConnectionStatusInput[]
): PlaidConnectionsStatusSummary {
  const latestSuccessfulSyncAt = connections
    .map((connection) => connection.lastSuccessfulSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const active = connections.filter((connection) => connection.status === "active").length;
  const errored = connections.filter((connection) => connection.status === "error").length;
  const revoked = connections.filter((connection) => connection.status === "revoked").length;
  const syncable = connections.filter((connection) => connection.status !== "revoked").length;
  const needsRepair = connections.filter((connection) =>
    getPlaidConnectionIssue(connection)?.action === "repair"
  ).length;
  const total = connections.length;

  return {
    active,
    errored,
    latestSuccessfulSyncAt,
    needsRepair,
    revoked,
    status: total === 0
      ? "empty"
      : errored > 0 || needsRepair > 0
        ? "needs_attention"
        : !latestSuccessfulSyncAt && syncable > 0
          ? "never_synced"
          : "healthy",
    syncable,
    total
  };
}

export function getPlaidSyncResultErrorDetails(sync: PlaidSyncResultInput): string | null {
  const details = sync.items
    .filter((item) => item.errorCode || item.errorMessage)
    .map((item) => [item.errorCode, item.errorMessage].filter(Boolean).join(": "));

  return details.length > 0 ? [...new Set(details)].join("; ") : null;
}

export function formatPlaidSyncResultMessage(sync: PlaidSyncResultInput) {
  const enrichedTransactions = sync.enrichedTransactionsInserted + sync.enrichedTransactionsUpdated;
  const resultLabel = sync.status === "succeeded" ? "Sync complete" : "Sync incomplete";
  const errorDetails = getPlaidSyncResultErrorDetails(sync);
  const summary = `${sync.accountsUpserted} accounts, ${sync.rawTransactionsUpserted} raw transactions, ${enrichedTransactions} enriched transactions, ${sync.failed} failures.`;

  return errorDetails ? `${resultLabel}: ${summary} ${errorDetails}` : `${resultLabel}: ${summary}`;
}
