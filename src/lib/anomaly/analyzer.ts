import { assertAssistantContextSafe } from "@/lib/agents";
import {
  DEFAULT_ANOMALY_THRESHOLDS,
  anomalyDetectors,
  type AnomalyDetectorInput,
  type AnomalyDetectorThresholds
} from "./detectors";
import { ANOMALY_SEVERITY_RANK, type AnomalyAlertDraft, type AnomalyAlertRecord } from "./types";

export interface AnalyzeAnomaliesOptions {
  thresholds?: AnomalyDetectorThresholds;
  /** Hard cap on drafts returned, highest severity first. Keeps alerts high-signal. */
  maxDrafts?: number;
}

const DEFAULT_MAX_DRAFTS = 25;

function compareDrafts(left: AnomalyAlertDraft, right: AnomalyAlertDraft) {
  const severityDelta = ANOMALY_SEVERITY_RANK[right.severity] - ANOMALY_SEVERITY_RANK[left.severity];
  if (severityDelta !== 0) return severityDelta;
  return left.dedupeKey.localeCompare(right.dedupeKey);
}

/**
 * Run every deterministic detector and return a stable, de-duplicated,
 * severity-ordered set of drafts. Output is fully determined by the inputs.
 *
 * Each draft's evidence is validated against the assistant safety contract so a
 * forbidden field can never reach persistence or an OpenClaw packet.
 */
export function analyzeAnomalies(
  input: AnomalyDetectorInput,
  options: AnalyzeAnomaliesOptions = {}
): AnomalyAlertDraft[] {
  const thresholds = options.thresholds ?? DEFAULT_ANOMALY_THRESHOLDS;
  const maxDrafts = options.maxDrafts ?? DEFAULT_MAX_DRAFTS;

  const byKey = new Map<string, AnomalyAlertDraft>();
  for (const detector of anomalyDetectors) {
    for (const draft of detector(input, thresholds)) {
      assertAssistantContextSafe(draft.evidence);
      // Detectors own disjoint dedupe namespaces; first writer wins defensively.
      if (!byKey.has(draft.dedupeKey)) {
        byKey.set(draft.dedupeKey, draft);
      }
    }
  }

  return [...byKey.values()].sort(compareDrafts).slice(0, Math.max(0, maxDrafts));
}

export interface AnomalyReconciliation {
  /** Drafts with no existing alert for their dedupe key. Should be inserted. */
  toCreate: AnomalyAlertDraft[];
  /** Ids of still-pending alerts whose condition was re-detected. Should be touched. */
  toRefresh: string[];
  /** Drafts suppressed because an alert already exists for their dedupe key. */
  suppressed: AnomalyAlertDraft[];
}

/**
 * Reconcile fresh drafts against persisted alerts. Application-level dedupe that
 * mirrors the `(user_id, dedupe_key)` unique constraint: an existing alert for a
 * key (in any lifecycle state) suppresses a new insert, so a dismissed alert
 * never re-pages and a re-detected pending alert is only refreshed.
 */
export function reconcileAnomalyAlerts(
  drafts: readonly AnomalyAlertDraft[],
  existing: readonly Pick<AnomalyAlertRecord, "id" | "dedupeKey" | "status">[]
): AnomalyReconciliation {
  const existingByKey = new Map(existing.map((alert) => [alert.dedupeKey, alert]));

  const toCreate: AnomalyAlertDraft[] = [];
  const toRefresh: string[] = [];
  const suppressed: AnomalyAlertDraft[] = [];

  for (const draft of drafts) {
    const match = existingByKey.get(draft.dedupeKey);
    if (!match) {
      toCreate.push(draft);
      continue;
    }

    suppressed.push(draft);
    if (match.status === "pending") {
      toRefresh.push(match.id);
    }
  }

  return { toCreate, toRefresh, suppressed };
}
