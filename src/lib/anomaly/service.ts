import { createClient } from "@supabase/supabase-js";
import type { AnomalyAlertRecord, Database, FinanceSupabaseClient } from "@/lib/db";
import {
  createAnomalyAlerts,
  listAccounts,
  listAnomalyAlerts,
  listTransactions,
  refreshAnomalyAlerts,
  type AnomalyAlertListFilters,
  type AnomalyAlertMutationInput,
  type TransactionListFilters
} from "@/lib/db";
import { logSafeError } from "@/lib/security/logging";
import { getSupabaseConfig } from "@/lib/supabase/env";
import { analyzeAnomalies, reconcileAnomalyAlerts, type AnalyzeAnomaliesOptions } from "./analyzer";

export interface AnomalyAlertScanResult {
  createdAlertCount: number;
  errorCode: "detector_failed" | null;
  fromDate: string;
  maxTransactions: number;
  pendingAlertCount: number;
  refreshedAlertCount: number;
  scannedAccountCount: number;
  scannedTransactionCount: number;
  status: "failed" | "succeeded";
  suppressedAlertCount: number;
  toDate: string;
}

export interface AnomalyAlertScanDependencies {
  analyzeAnomalies?: typeof analyzeAnomalies;
  createAnomalyAlerts?: (
    client: FinanceSupabaseClient,
    userId: string,
    inputs: readonly AnomalyAlertMutationInput[],
    options?: { now?: Date }
  ) => Promise<AnomalyAlertRecord[]>;
  listAccounts?: typeof listAccounts;
  listAnomalyAlerts?: (
    client: FinanceSupabaseClient,
    userId: string,
    filters?: AnomalyAlertListFilters
  ) => Promise<AnomalyAlertRecord[]>;
  listTransactions?: (
    client: FinanceSupabaseClient,
    userId: string,
    filters?: TransactionListFilters
  ) => Promise<Awaited<ReturnType<typeof listTransactions>>>;
  logger?: Pick<Console, "error">;
  refreshAnomalyAlerts?: typeof refreshAnomalyAlerts;
}

export class AnomalyAlertScanConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnomalyAlertScanConfigurationError";
  }
}

const DEFAULT_MAX_TRANSACTIONS = 250;
const DEFAULT_LOOKBACK_DAYS = 120;

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const normalized = value?.trim();
  if (!normalized) return fallback;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

export function resolveAnomalyAlertScanMaxTransactions(value = process.env.ANOMALY_ALERT_SCAN_MAX_TX) {
  return parsePositiveInteger(value, DEFAULT_MAX_TRANSACTIONS);
}

export function resolveAnomalyAlertScanUserId() {
  return process.env.ANOMALY_ALERT_SCAN_USER_ID?.trim() || process.env.OPENCLAW_USER_ID?.trim() || null;
}

export function anomalyAlertScanWindow(now = new Date()) {
  const toDate = isoDate(now);
  return {
    fromDate: addDays(toDate, -DEFAULT_LOOKBACK_DAYS),
    toDate
  };
}

export function createAnomalyAlertScanServiceContext(): { client: FinanceSupabaseClient; userId: string } {
  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const userId = resolveAnomalyAlertScanUserId();

  if (!config || !serviceRoleKey || !userId) {
    throw new AnomalyAlertScanConfigurationError(
      "Missing anomaly alert scan configuration. Set ANOMALY_ALERT_SCAN_USER_ID or OPENCLAW_USER_ID plus SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return {
    client: createClient<Database>(config.url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }) as unknown as FinanceSupabaseClient,
    userId
  };
}

export async function runAnomalyAlertScan(
  client: FinanceSupabaseClient,
  userId: string,
  options: (AnalyzeAnomaliesOptions & {
    maxTransactions?: number;
    now?: Date;
  }) = {},
  dependencies: AnomalyAlertScanDependencies = {}
): Promise<AnomalyAlertScanResult> {
  const now = options.now ?? new Date();
  const maxTransactions = options.maxTransactions ?? resolveAnomalyAlertScanMaxTransactions();
  const { fromDate, toDate } = anomalyAlertScanWindow(now);
  const loadAccounts = dependencies.listAccounts ?? listAccounts;
  const loadTransactions = dependencies.listTransactions ?? listTransactions;
  const loadAlerts = dependencies.listAnomalyAlerts ?? listAnomalyAlerts;
  const createAlerts = dependencies.createAnomalyAlerts ?? createAnomalyAlerts;
  const refreshAlerts = dependencies.refreshAnomalyAlerts ?? refreshAnomalyAlerts;
  const detect = dependencies.analyzeAnomalies ?? analyzeAnomalies;
  const logger = dependencies.logger ?? { error: logSafeError };

  try {
    const [accounts, transactions, existingAlerts] = await Promise.all([
      loadAccounts(client, userId),
      loadTransactions(client, userId, {
        fromDate,
        includeRawContext: false,
        limit: maxTransactions,
        toDate
      }),
      loadAlerts(client, userId, {
        includeResolved: true,
        status: "all"
      })
    ]);
    const drafts = detect({ accounts, now, transactions }, {
      maxDrafts: options.maxDrafts,
      thresholds: options.thresholds
    });
    const reconciliation = reconcileAnomalyAlerts(drafts, existingAlerts);
    const created = await createAlerts(client, userId, reconciliation.toCreate, { now });
    const refreshed = await refreshAlerts(client, userId, reconciliation.toRefresh, { now });

    return {
      createdAlertCount: created.length,
      errorCode: null,
      fromDate,
      maxTransactions,
      pendingAlertCount: existingAlerts.filter((alert) => alert.status === "pending").length + created.length,
      refreshedAlertCount: refreshed.length,
      scannedAccountCount: accounts.length,
      scannedTransactionCount: transactions.length,
      status: "succeeded",
      suppressedAlertCount: reconciliation.suppressed.length,
      toDate
    };
  } catch (error) {
    logger.error("anomaly_alert_scan_failed", error);
    return {
      createdAlertCount: 0,
      errorCode: "detector_failed",
      fromDate,
      maxTransactions,
      pendingAlertCount: 0,
      refreshedAlertCount: 0,
      scannedAccountCount: 0,
      scannedTransactionCount: 0,
      status: "failed",
      suppressedAlertCount: 0,
      toDate
    };
  }
}
