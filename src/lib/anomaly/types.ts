import type {
  AnomalyAlertReasonCode,
  AnomalyAlertRecord,
  AnomalyAlertSeverity,
  AnomalyAlertStatus,
  Json
} from "@/lib/db";

/**
 * Deterministic anomaly detection contract.
 *
 * Detectors decide *whether* an alert exists from deterministic finance data.
 * Wording can be layered on later, but it must never gate alert existence.
 */
export const ANOMALY_ALERT_CONTRACT_VERSION = "2026-06-04" as const;

export type AnomalyReasonCode = AnomalyAlertReasonCode;
export type AnomalySeverity = AnomalyAlertSeverity;
export type AnomalyStatus = AnomalyAlertStatus;
export type { AnomalyAlertRecord };

export const anomalyReasonCodes: readonly AnomalyReasonCode[] = [
  "duplicate_charge",
  "subscription_increase",
  "unusual_merchant",
  "large_transaction",
  "category_spike",
  "overdue_reimbursement",
  "high_card_balance",
  "stale_sync"
];

export const anomalySeverities: readonly AnomalySeverity[] = ["info", "warning", "critical"];

export const anomalyStatuses: readonly AnomalyStatus[] = ["pending", "dismissed", "resolved"];

export const ANOMALY_SEVERITY_RANK: Record<AnomalySeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2
};

/**
 * A draft is what a detector emits before it is reconciled against persisted
 * alerts. It is fully deterministic given the same inputs.
 */
export interface AnomalyAlertDraft {
  reasonCode: AnomalyReasonCode;
  severity: AnomalySeverity;
  /** Stable across re-runs for the same underlying condition. Drives dedupe. */
  dedupeKey: string;
  title: string;
  body: string;
  /** Minimized evidence. Must never contain forbidden / raw provider fields. */
  evidence: Json;
}
