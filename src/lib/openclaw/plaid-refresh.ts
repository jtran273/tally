import { assertAssistantContextSafe } from "@/lib/agents";
import type { PlaidOpportunisticSyncSummary, PlaidSyncRunSummary } from "@/lib/plaid/service";

export type OpenClawPlaidRefreshStatus = "failed" | "partial" | "skipped" | "succeeded";

export interface OpenClawPlaidRefreshSafety {
  accountNumbersIncluded: false;
  callerSelectedConnectionAllowed: false;
  directPlaidAccessAllowed: false;
  manualTransactionMutationAllowed: false;
  rawProviderPayloadIncluded: false;
  secretsIncluded: false;
  userScoped: true;
}

export interface OpenClawPlaidRefreshErrorSummary {
  code: string | null;
  count: number;
  message: string | null;
}

export interface OpenClawPlaidRefreshResponse {
  object: "ledger.openclaw.plaid_refresh";
  durationMs: number;
  finishedAt: string;
  generatedAt: string;
  reason: PlaidOpportunisticSyncSummary["reason"];
  safety: OpenClawPlaidRefreshSafety;
  startedAt: string;
  status: OpenClawPlaidRefreshStatus;
  sync: {
    accountsUpserted: number;
    balanceSnapshotsUpserted: number;
    enrichedTransactionsInserted: number;
    enrichedTransactionsUpdated: number;
    errorSummary: OpenClawPlaidRefreshErrorSummary[];
    failed: number;
    pendingTransactionsReplaced: number;
    rawTransactionsSkipped: number;
    rawTransactionsUpserted: number;
    source: PlaidSyncRunSummary["source"] | null;
    succeeded: number;
    totalItems: number;
    transactionsRemoved: number;
  };
}

export function openClawPlaidRefreshSafety(): OpenClawPlaidRefreshSafety {
  return {
    accountNumbersIncluded: false,
    callerSelectedConnectionAllowed: false,
    directPlaidAccessAllowed: false,
    manualTransactionMutationAllowed: false,
    rawProviderPayloadIncluded: false,
    secretsIncluded: false,
    userScoped: true
  };
}

function safeDurationMs(startedAt: string, finishedAt: string) {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function statusForSummary(summary: PlaidOpportunisticSyncSummary): OpenClawPlaidRefreshStatus {
  if (!summary.sync) return "skipped";
  return summary.sync.status;
}

function summarizeItemErrors(sync: PlaidSyncRunSummary | null): OpenClawPlaidRefreshErrorSummary[] {
  if (!sync) return [];

  const groups = new Map<string, OpenClawPlaidRefreshErrorSummary>();
  sync.items.forEach((item) => {
    const code = item.errorCode?.trim() || null;
    const message = item.errorMessage?.trim() || null;
    if (!code && !message) return;

    const key = `${code ?? ""}\n${message ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }

    groups.set(key, { code, count: 1, message });
  });

  return [...groups.values()];
}

function emptySync() {
  return {
    accountsUpserted: 0,
    balanceSnapshotsUpserted: 0,
    enrichedTransactionsInserted: 0,
    enrichedTransactionsUpdated: 0,
    errorSummary: [],
    failed: 0,
    pendingTransactionsReplaced: 0,
    rawTransactionsSkipped: 0,
    rawTransactionsUpserted: 0,
    source: null,
    succeeded: 0,
    totalItems: 0,
    transactionsRemoved: 0
  };
}

export function buildOpenClawPlaidRefreshResponse(
  summary: PlaidOpportunisticSyncSummary,
  options: { finishedAt?: string } = {}
): OpenClawPlaidRefreshResponse {
  const finishedAt = options.finishedAt ?? new Date().toISOString();
  const startedAt = summary.sync?.startedAt ?? summary.checkedAt;
  const sync = summary.sync;
  const response: OpenClawPlaidRefreshResponse = {
    object: "ledger.openclaw.plaid_refresh",
    durationMs: safeDurationMs(startedAt, finishedAt),
    finishedAt,
    generatedAt: finishedAt,
    reason: summary.reason,
    safety: openClawPlaidRefreshSafety(),
    startedAt,
    status: statusForSummary(summary),
    sync: sync
      ? {
        accountsUpserted: sync.accountsUpserted,
        balanceSnapshotsUpserted: sync.balanceSnapshotsUpserted,
        enrichedTransactionsInserted: sync.enrichedTransactionsInserted,
        enrichedTransactionsUpdated: sync.enrichedTransactionsUpdated,
        errorSummary: summarizeItemErrors(sync),
        failed: sync.failed,
        pendingTransactionsReplaced: sync.pendingTransactionsReplaced,
        rawTransactionsSkipped: sync.rawTransactionsSkipped,
        rawTransactionsUpserted: sync.rawTransactionsUpserted,
        source: sync.source,
        succeeded: sync.succeeded,
        totalItems: sync.totalItems,
        transactionsRemoved: sync.transactionsRemoved
      }
      : emptySync()
  };

  assertAssistantContextSafe(response);
  return response;
}
