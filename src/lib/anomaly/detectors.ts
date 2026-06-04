import type { AccountRecord, TransactionRecord } from "@/lib/db";
import { accountSyncState } from "@/lib/finance/balances";
import { transactionSpendingAmount } from "@/lib/finance/spending";
import type { AnomalyAlertDraft } from "./types";

export interface AnomalyDetectorInput {
  accounts: readonly AccountRecord[];
  transactions: readonly TransactionRecord[];
  now?: Date;
}

export interface AnomalyDetectorThresholds {
  /** Minimum absolute amount for a charge to be considered a duplicate. */
  duplicateMinAmount: number;
  /** Days between two same-merchant, same-amount charges to flag a duplicate. */
  duplicateWindowDays: number;
  /** Absolute amount at which a single charge is flagged as large. */
  largeTransactionAmount: number;
  /** Absolute amount at which a large charge escalates to critical. */
  largeTransactionCriticalAmount: number;
  /** Credit utilization fraction (0-1) at which a card balance is flagged. */
  highCardUtilization: number;
  /** Credit utilization fraction (0-1) at which a card balance is critical. */
  highCardCriticalUtilization: number;
  /** Hours since last sync after which an account is considered stale. */
  staleAfterHours: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyDetectorThresholds = {
  duplicateMinAmount: 5,
  duplicateWindowDays: 3,
  largeTransactionAmount: 1500,
  largeTransactionCriticalAmount: 5000,
  highCardUtilization: 0.8,
  highCardCriticalUtilization: 0.95,
  staleAfterHours: 72
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: "currency"
});

function money(value: number) {
  return moneyFormatter.format(Math.abs(value));
}

function roundCents(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeMerchant(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function daysBetween(left: string, right: string) {
  const leftMs = Date.parse(`${left}T12:00:00.000Z`);
  const rightMs = Date.parse(`${right}T12:00:00.000Z`);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftMs - rightMs) / (24 * 60 * 60 * 1000);
}

function spendingTransactions(transactions: readonly TransactionRecord[]) {
  return transactions.filter((transaction) =>
    transaction.status === "posted" && transactionSpendingAmount(transaction) > 0
  );
}

function isSyncableAccount(account: AccountRecord) {
  return account.plaidConnectionSource !== "manual" && account.plaidAutoSyncEnabled !== false;
}

/**
 * Duplicate charge: two or more posted spending transactions from the same
 * merchant for the same amount inside a short window. High precision: the
 * window and identical cents amount keep recurring-but-legitimate charges out.
 */
export function detectDuplicateCharges(
  input: AnomalyDetectorInput,
  thresholds: AnomalyDetectorThresholds = DEFAULT_ANOMALY_THRESHOLDS
): AnomalyAlertDraft[] {
  const groups = new Map<string, TransactionRecord[]>();

  for (const transaction of spendingTransactions(input.transactions)) {
    const amount = roundCents(Math.abs(transaction.amount));
    if (amount < thresholds.duplicateMinAmount) continue;

    const key = `${normalizeMerchant(transaction.merchant)}|${amount.toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  const drafts: AnomalyAlertDraft[] = [];

  for (const candidates of groups.values()) {
    if (candidates.length < 2) continue;

    const sorted = [...candidates].sort(
      (left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)
    );

    // Cluster transactions whose neighbours are within the dedupe window.
    let cluster: TransactionRecord[] = [sorted[0]];
    const flushCluster = () => {
      if (cluster.length < 2) return;

      const ids = cluster.map((transaction) => transaction.id).sort();
      const amount = roundCents(Math.abs(cluster[0].amount));
      const merchant = cluster[0].merchant;

      drafts.push({
        reasonCode: "duplicate_charge",
        severity: "warning",
        dedupeKey: `duplicate_charge:${ids.join(":")}`,
        title: `Possible duplicate charge at ${merchant}`,
        body: `${cluster.length} charges of ${money(amount)} at ${merchant} posted between ${cluster[0].date} and ${cluster[cluster.length - 1].date}.`,
        evidence: {
          count: cluster.length,
          merchant,
          amount,
          transactionIds: ids,
          dates: cluster.map((transaction) => transaction.date)
        }
      });
    };

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = cluster[cluster.length - 1];
      const current = sorted[index];
      if (daysBetween(previous.date, current.date) <= thresholds.duplicateWindowDays) {
        cluster.push(current);
      } else {
        flushCluster();
        cluster = [current];
      }
    }
    flushCluster();
  }

  return drafts;
}

/**
 * Large transaction: a single spending charge above an absolute threshold.
 */
export function detectLargeTransactions(
  input: AnomalyDetectorInput,
  thresholds: AnomalyDetectorThresholds = DEFAULT_ANOMALY_THRESHOLDS
): AnomalyAlertDraft[] {
  const drafts: AnomalyAlertDraft[] = [];

  for (const transaction of spendingTransactions(input.transactions)) {
    const amount = roundCents(Math.abs(transaction.amount));
    if (amount < thresholds.largeTransactionAmount) continue;

    const severity = amount >= thresholds.largeTransactionCriticalAmount ? "critical" : "warning";

    drafts.push({
      reasonCode: "large_transaction",
      severity,
      dedupeKey: `large_transaction:${transaction.id}`,
      title: `Large charge at ${transaction.merchant}`,
      body: `${money(amount)} at ${transaction.merchant} on ${transaction.date} is above the ${money(thresholds.largeTransactionAmount)} review threshold.`,
      evidence: {
        merchant: transaction.merchant,
        amount,
        date: transaction.date,
        category: transaction.category,
        transactionIds: [transaction.id]
      }
    });
  }

  return drafts;
}

/**
 * High card balance: a credit account whose utilization crosses a threshold.
 */
export function detectHighCardBalances(
  input: AnomalyDetectorInput,
  thresholds: AnomalyDetectorThresholds = DEFAULT_ANOMALY_THRESHOLDS
): AnomalyAlertDraft[] {
  const drafts: AnomalyAlertDraft[] = [];

  for (const account of input.accounts) {
    if (account.type !== "credit") continue;
    if (!account.creditLimit || account.creditLimit <= 0) continue;

    // Credit balances are stored as the amount owed (positive).
    const owed = Math.max(0, account.balance);
    const utilization = owed / account.creditLimit;
    if (utilization < thresholds.highCardUtilization) continue;

    const severity = utilization >= thresholds.highCardCriticalUtilization ? "critical" : "warning";
    const percent = Math.round(utilization * 100);

    drafts.push({
      reasonCode: "high_card_balance",
      severity,
      dedupeKey: `high_card_balance:${account.id}`,
      title: `${account.name} is near its credit limit`,
      body: `${account.name} at ${account.institutionName} is at ${percent}% utilization (${money(owed)} of ${money(account.creditLimit)}).`,
      evidence: {
        accountId: account.id,
        accountName: account.name,
        institutionName: account.institutionName,
        balance: roundCents(owed),
        creditLimit: roundCents(account.creditLimit),
        utilization: Math.round(utilization * 1000) / 1000
      }
    });
  }

  return drafts;
}

/**
 * Stale sync: an active account that has not synced inside the freshness window.
 */
export function detectStaleSync(
  input: AnomalyDetectorInput,
  thresholds: AnomalyDetectorThresholds = DEFAULT_ANOMALY_THRESHOLDS
): AnomalyAlertDraft[] {
  const now = input.now ?? new Date();
  const drafts: AnomalyAlertDraft[] = [];

  for (const account of input.accounts) {
    if (!account.isActive) continue;
    if (!isSyncableAccount(account)) continue;

    const state = accountSyncState(account, { now, staleAfterHours: thresholds.staleAfterHours });
    if (state === "fresh") continue;

    const detail = state === "never"
      ? "has never synced"
      : `last synced ${account.lastSyncedAt ?? "unknown"}`;

    drafts.push({
      reasonCode: "stale_sync",
      severity: "warning",
      dedupeKey: `stale_sync:${account.id}`,
      title: `${account.name} needs a fresh sync`,
      body: `${account.name} at ${account.institutionName} ${detail}; balances and insights may be out of date.`,
      evidence: {
        accountId: account.id,
        accountName: account.name,
        institutionName: account.institutionName,
        state,
        lastSyncedAt: account.lastSyncedAt
      }
    });
  }

  return drafts;
}

export const anomalyDetectors = [
  detectDuplicateCharges,
  detectLargeTransactions,
  detectHighCardBalances,
  detectStaleSync
] as const;
