import { assertAssistantContextSafe } from "@/lib/agents";
import {
  ANOMALY_ALERT_CONTRACT_VERSION,
  ANOMALY_SEVERITY_RANK,
  type AnomalyAlertRecord,
  type AnomalyReasonCode,
  type AnomalySeverity
} from "./types";

export type AnomalyPacketPriority = "normal" | "high";

export interface OpenClawAnomalyPacket {
  id: string;
  body: string;
  createdAt: string;
  priority: AnomalyPacketPriority;
  reasonCode: AnomalyReasonCode;
  severity: AnomalySeverity;
  target: "openclaw";
  title: string;
}

export interface OpenClawAnomalyPacketResponse {
  object: "ledger.openclaw.anomaly_alerts";
  contractVersion: typeof ANOMALY_ALERT_CONTRACT_VERSION;
  generatedAt: string;
  packets: OpenClawAnomalyPacket[];
  safety: {
    forbiddenFieldCheck: "passed";
    rawProviderPayloadIncluded: false;
    secretsIncluded: false;
    userScoped: true;
    writesAllowed: false;
  };
}

const MAX_BODY_LENGTH = 320;

export interface BuildOpenClawAnomalyPacketsOptions {
  generatedAt?: string;
  /** Lowest severity worth delivering. Defaults to high-signal alerts only. */
  minSeverity?: AnomalySeverity;
  packetLimit?: number;
}

function compact(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function packetPriority(severity: AnomalySeverity): AnomalyPacketPriority {
  return severity === "critical" ? "high" : "normal";
}

/**
 * Build OpenClaw-safe delivery packets from pending, high-priority alerts.
 *
 * Detector code never writes to OpenClaw directly; this exposes a minimized,
 * read-only view. Packets carry no transaction ids, account ids, or evidence
 * blobs — only the wording, reason code, and severity needed for delivery. The
 * whole response is run through the assistant safety contract before return.
 */
export function buildOpenClawAnomalyPackets(
  alerts: readonly AnomalyAlertRecord[],
  options: BuildOpenClawAnomalyPacketsOptions = {}
): OpenClawAnomalyPacketResponse {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const minSeverity = options.minSeverity ?? "warning";
  const packetLimit = Math.max(0, Math.min(options.packetLimit ?? 10, 50));
  const minRank = ANOMALY_SEVERITY_RANK[minSeverity];

  const packets = alerts
    .filter((alert) => alert.status === "pending")
    .filter((alert) => ANOMALY_SEVERITY_RANK[alert.severity] >= minRank)
    .sort((left, right) =>
      ANOMALY_SEVERITY_RANK[right.severity] - ANOMALY_SEVERITY_RANK[left.severity] ||
      right.detectedAt.localeCompare(left.detectedAt) ||
      left.id.localeCompare(right.id)
    )
    .slice(0, packetLimit)
    .map<OpenClawAnomalyPacket>((alert) => ({
      id: `openclaw-anomaly:${alert.id}`,
      body: compact(alert.body, MAX_BODY_LENGTH),
      createdAt: alert.detectedAt,
      priority: packetPriority(alert.severity),
      reasonCode: alert.reasonCode,
      severity: alert.severity,
      target: "openclaw",
      title: compact(alert.title, MAX_BODY_LENGTH)
    }));

  const response: OpenClawAnomalyPacketResponse = {
    object: "ledger.openclaw.anomaly_alerts",
    contractVersion: ANOMALY_ALERT_CONTRACT_VERSION,
    generatedAt,
    packets,
    safety: {
      forbiddenFieldCheck: "passed",
      rawProviderPayloadIncluded: false,
      secretsIncluded: false,
      userScoped: true,
      writesAllowed: false
    }
  };

  assertAssistantContextSafe(response);
  return response;
}
