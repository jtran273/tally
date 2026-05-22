import type { PlaidItemStatus } from "@/lib/db/types";

export type PlaidConnectionIssueAction = "repair" | "retry" | "reconnect" | "wait";

export interface PlaidConnectionIssue {
  action: PlaidConnectionIssueAction;
  detail: string;
  title: string;
}

export interface PlaidConnectionStatusInput {
  errorCode: string | null;
  institutionName?: string | null;
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
  warningCode?: string;
  warningMessage?: string;
}

export interface PlaidSyncResultInput {
  accountsUpserted?: number | null;
  enrichedTransactionsInserted?: number | null;
  enrichedTransactionsUpdated?: number | null;
  failed?: number | null;
  items?: readonly PlaidSyncResultItemInput[] | null;
  rawTransactionsSkipped?: number | null;
  rawTransactionsUpserted?: number | null;
  status?: "succeeded" | "partial" | "failed" | null;
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
  "INVALID_PRODUCT",
  "PRODUCT_NOT_READY",
  "PRODUCT_NOT_ENABLED",
  "INSTITUTION_NOT_AVAILABLE"
]);

const SERVER_CONFIGURATION_ERROR_CODES = new Set([
  "PLAID_CONFIGURATION_ERROR",
  "PLAID_ROUTE_CONFIGURATION_ERROR"
]);

const TOKEN_DECRYPTION_ERROR_CODE = "PLAID_TOKEN_DECRYPTION_ERROR";
const GENERIC_PLAID_REQUEST_ERROR_CODE = "PLAID_REQUEST_FAILED";
const INTERNAL_SYNC_ERROR_CODE = "PLAID_SYNC_INTERNAL_ERROR";

function normalizedCode(code: string | null) {
  return code?.trim().toUpperCase() ?? null;
}

export function isPlaidServerConfigurationErrorCode(code: string | null) {
  const normalized = normalizedCode(code);
  return Boolean(normalized && SERVER_CONFIGURATION_ERROR_CODES.has(normalized));
}

function validTimestamp(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : { time, value };
}

function safeCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeSyncItems(sync: PlaidSyncResultInput) {
  return Array.isArray(sync.items) ? sync.items : [];
}

function stripProviderRequestIds(message: string) {
  return message
    .replace(/\s*Request ID:\s*[A-Za-z0-9_-]+\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeItemMessage(item: PlaidSyncResultItemInput) {
  const message = item.errorMessage ?? item.warningMessage;
  if (!message) return null;

  const sanitized = stripProviderRequestIds(message);
  return sanitized && sanitized !== "Plaid sync failed." ? sanitized : null;
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

  if (code === TOKEN_DECRYPTION_ERROR_CODE) {
    const institutionName = input.institutionName?.trim();
    return {
      action: "reconnect",
      detail: `Tally can still show saved balances${institutionName ? ` for ${institutionName}` : ""}, but transaction sync cannot run because the bank connection token is unreadable. Reconnect the institution to resume imports.`,
      title: institutionName ? `Reconnect ${institutionName}` : "Reconnect required"
    };
  }

  if (code && WAIT_ERROR_CODES.has(code)) {
    return {
      action: "wait",
      detail: "Plaid has not finished making transaction data available. Retry sync later.",
      title: "Transactions pending"
    };
  }

  if (isPlaidServerConfigurationErrorCode(code)) {
    return {
      action: "retry",
      detail: "Plaid server configuration needs attention before sync can run. Check production environment variables and retry sync.",
      title: "Server configuration issue"
    };
  }

  if (code === INTERNAL_SYNC_ERROR_CODE) {
    return {
      action: "retry",
      detail: "Plaid returned data, but Tally could not finish saving the imported sync result. Check safe server logs for the failing sync step.",
      title: "Sync save failed"
    };
  }

  if (code === GENERIC_PLAID_REQUEST_ERROR_CODE) {
    return {
      action: "retry",
      detail: "Plaid did not return a specific item error for the last request. Retry sync; if it repeats, check safe server logs for the Plaid request id.",
      title: "Plaid request failed"
    };
  }

  if (input.status === "error") {
    return {
      action: "retry",
      detail: "The last Plaid sync failed. Retry sync from Settings; server logs contain safe request metadata.",
      title: "Sync failed"
    };
  }

  if (!validTimestamp(input.lastSuccessfulSyncAt)) {
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
    .filter((connection) => connection.status !== "revoked")
    .map((connection) => validTimestamp(connection.lastSuccessfulSyncAt))
    .filter((value): value is { time: number; value: string } => Boolean(value))
    .sort((a, b) => b.time - a.time)[0]?.value ?? null;
  const active = connections.filter((connection) => connection.status === "active").length;
  const errored = connections.filter((connection) => connection.status === "error").length;
  const revoked = connections.filter((connection) => connection.status === "revoked").length;
  const syncable = connections.filter((connection) => connection.status !== "revoked").length;
  const needsRepair = connections.filter((connection) =>
    getPlaidConnectionIssue(connection)?.action === "repair"
  ).length;
  const needsAttention = connections.filter((connection) => {
    if (connection.status === "revoked") return false;
    const issue = getPlaidConnectionIssue(connection);
    return Boolean(issue && issue.title !== "Never synced");
  }).length;
  const total = connections.length;

  return {
    active,
    errored,
    latestSuccessfulSyncAt,
    needsRepair,
    revoked,
    status: total === 0
      ? "empty"
      : errored > 0 || needsAttention > 0 || syncable === 0
        ? "needs_attention"
        : !latestSuccessfulSyncAt && syncable > 0
          ? "never_synced"
          : "healthy",
    syncable,
    total
  };
}

export function getPlaidSyncResultErrorDetails(sync: PlaidSyncResultInput): string | null {
  const details = safeSyncItems(sync)
    .filter((item) => item.errorCode || item.errorMessage || item.warningCode || item.warningMessage)
    .map((item) => {
      if (normalizedCode(item.errorCode ?? null) === TOKEN_DECRYPTION_ERROR_CODE) {
        return "PLAID_TOKEN_DECRYPTION_ERROR: Reconnect the institution. Tally can still show saved balances, but transaction sync cannot run because the bank connection token is unreadable.";
      }

      if (normalizedCode(item.errorCode ?? null) === GENERIC_PLAID_REQUEST_ERROR_CODE) {
        const message = safeItemMessage(item);
        return message
          ? `PLAID_REQUEST_FAILED: ${message}`
          : "PLAID_REQUEST_FAILED: Plaid did not return a specific item error for this request. Retry sync; if it repeats, inspect safe server logs.";
      }

      if (normalizedCode(item.errorCode ?? null) === INTERNAL_SYNC_ERROR_CODE) {
        const message = safeItemMessage(item);
        return message
          ? `PLAID_SYNC_INTERNAL_ERROR: ${message}`
          : "PLAID_SYNC_INTERNAL_ERROR: Tally sync failed while saving imported Plaid data.";
      }

      return [
        item.errorCode ?? item.warningCode,
        safeItemMessage(item)
      ].filter(Boolean).join(": ");
    });

  return details.length > 0 ? [...new Set(details)].join("; ") : null;
}

export function formatPlaidSyncResultMessage(sync: PlaidSyncResultInput) {
  const enrichedTransactions = safeCount(sync.enrichedTransactionsInserted) + safeCount(sync.enrichedTransactionsUpdated);
  const resultLabel = sync.status === "succeeded" ? "Sync complete" : "Sync incomplete";
  const errorDetails = getPlaidSyncResultErrorDetails(sync);
  const rawTransactionsSkipped = safeCount(sync.rawTransactionsSkipped);
  const skipped = rawTransactionsSkipped > 0
    ? `, ${rawTransactionsSkipped} skipped`
    : "";
  const summary = `${safeCount(sync.accountsUpserted)} accounts, ${safeCount(sync.rawTransactionsUpserted)} raw transactions${skipped}, ${enrichedTransactions} enriched transactions, ${safeCount(sync.failed)} failures.`;

  return errorDetails ? `${resultLabel}: ${summary} ${errorDetails}` : `${resultLabel}: ${summary}`;
}
