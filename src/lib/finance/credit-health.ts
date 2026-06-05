import type { AccountRecord } from "@/lib/db";
import type { LiabilitiesDueSummary } from "./liabilities";

export type CreditScoreSource = "manual_bureau" | "manual_issuer" | "demo";
export type CreditScoreModel = "fico" | "vantagescore" | "unknown";
export type CreditScoreTrendDirection = "up" | "down" | "flat" | "unknown";
export type CreditHealthConfidence = "high" | "medium" | "low" | "none";

export interface CreditScoreSnapshotInput {
  asOfDate: string;
  createdAt?: string;
  model: CreditScoreModel;
  score: number;
  source: CreditScoreSource;
}

export interface CreditScoreSnapshot extends CreditScoreSnapshotInput {
  confidence: CreditHealthConfidence;
}

export interface CreditScoreSummary {
  current: CreditScoreSnapshot | null;
  delta: number | null;
  liveProvider: "none";
  sourceCopy: string;
  trend: CreditScoreTrendDirection;
}

export interface CreditHealthGuidance {
  confidence: CreditHealthConfidence;
  reason: string;
  title: string;
}

export interface CreditHealthSummary {
  guidance: CreditHealthGuidance[];
  score: CreditScoreSummary;
}

export type RewardsBenefitsLiveDataStatus = "not_supported_by_current_plaid_integration";

export interface RewardsBenefitsCapability {
  confidence: CreditHealthConfidence;
  liveDataStatus: RewardsBenefitsLiveDataStatus;
  supportedNow: string[];
  unsupportedNow: string[];
  nextSteps: string[];
}

const MIN_SCORE = 300;
const MAX_SCORE = 850;
const HIGH_UTILIZATION_PERCENT = 50;
const WATCH_UTILIZATION_PERCENT = 30;
const IDEAL_UTILIZATION_PERCENT = 10;

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.getTime();
}

function confidenceForScoreSource(source: CreditScoreSource): CreditHealthConfidence {
  if (source === "demo") return "low";
  return "medium";
}

export function normalizeCreditScoreSnapshot(input: CreditScoreSnapshotInput): CreditScoreSnapshot {
  const score = Math.round(input.score);
  if (score < MIN_SCORE || score > MAX_SCORE) {
    throw new Error("Credit score snapshots must be between 300 and 850.");
  }
  if (parseIsoDate(input.asOfDate) === null) {
    throw new Error("Credit score snapshots require an ISO date.");
  }

  return {
    asOfDate: input.asOfDate,
    confidence: confidenceForScoreSource(input.source),
    createdAt: input.createdAt,
    model: input.model,
    score,
    source: input.source
  };
}

function sortSnapshots(snapshots: readonly CreditScoreSnapshotInput[]) {
  return snapshots
    .map((snapshot, index) => ({
      index,
      snapshot: normalizeCreditScoreSnapshot(snapshot)
    }))
    .sort((a, b) => {
      const dateDiff = b.snapshot.asOfDate.localeCompare(a.snapshot.asOfDate);
      if (dateDiff !== 0) return dateDiff;
      if (a.snapshot.createdAt && b.snapshot.createdAt) {
        const createdDiff = b.snapshot.createdAt.localeCompare(a.snapshot.createdAt);
        if (createdDiff !== 0) return createdDiff;
      }
      return a.index - b.index;
    })
    .map(({ snapshot }) => snapshot);
}

function trendForDelta(delta: number | null): CreditScoreTrendDirection {
  if (delta === null) return "unknown";
  if (Math.abs(delta) < 1) return "flat";
  return delta > 0 ? "up" : "down";
}

export function buildCreditScoreSummary(
  snapshots: readonly CreditScoreSnapshotInput[]
): CreditScoreSummary {
  const sorted = sortSnapshots(snapshots);
  const current = sorted[0] ?? null;
  const previous = sorted.find((snapshot) => snapshot.asOfDate < (current?.asOfDate ?? "")) ?? null;
  const delta = current && previous ? current.score - previous.score : null;

  return {
    current,
    delta,
    liveProvider: "none",
    sourceCopy: current
      ? "Credit score is user-entered or demo-only; Tally is not connected to a live credit bureau score provider."
      : "No live credit score provider is configured. Tally can show utilization guidance from connected accounts, but not a current bureau score.",
    trend: trendForDelta(delta)
  };
}

function utilizationGuidance(summary: LiabilitiesDueSummary): CreditHealthGuidance {
  const highest = summary.highestIndividualUtilizationPercent;
  const aggregate = summary.aggregateUtilizationPercent;

  if (highest === null || aggregate === null) {
    return {
      confidence: "none",
      reason: "One or more connected cards are missing reported credit limits.",
      title: "Connect or enter credit limits before ranking utilization."
    };
  }

  if (highest >= HIGH_UTILIZATION_PERCENT) {
    return {
      confidence: "high",
      reason: `Highest card utilization is ${highest.toFixed(1)}% and aggregate utilization is ${aggregate.toFixed(1)}%.`,
      title: "Prioritize the highest-utilization card before it may report."
    };
  }

  if (highest >= WATCH_UTILIZATION_PERCENT || aggregate >= WATCH_UTILIZATION_PERCENT) {
    return {
      confidence: "high",
      reason: `Aggregate utilization is ${aggregate.toFixed(1)}% and highest card utilization is ${highest.toFixed(1)}%.`,
      title: "A payment under the 30% line may help reported utilization."
    };
  }

  if (highest >= IDEAL_UTILIZATION_PERCENT || aggregate >= IDEAL_UTILIZATION_PERCENT) {
    return {
      confidence: "medium",
      reason: `Aggregate utilization is ${aggregate.toFixed(1)}% and highest card utilization is ${highest.toFixed(1)}%.`,
      title: "Utilization is below 30%; single digits are the optional polish target."
    };
  }

  return {
    confidence: "high",
    reason: `Aggregate utilization is ${aggregate.toFixed(1)}% and highest card utilization is ${highest.toFixed(1)}%.`,
    title: "Utilization is already in the low range."
  };
}

function paymentHistoryGuidance(summary: LiabilitiesDueSummary): CreditHealthGuidance {
  if (summary.hasOverdue) {
    return {
      confidence: "high",
      reason: "At least one connected card has an actual due date that is past due.",
      title: "Payment-history safety comes before score optimization."
    };
  }

  if (summary.hasDueSoon) {
    return {
      confidence: "high",
      reason: "At least one connected card has an actual due date within the next week.",
      title: "Handle due-soon minimums before reported-balance targets."
    };
  }

  return {
    confidence: "medium",
    reason: "No overdue or due-soon connected card is visible in the liability summary.",
    title: "No immediate payment-history risk is visible."
  };
}

function sourceCoverageGuidance(summary: LiabilitiesDueSummary): CreditHealthGuidance {
  const actualReportingDates = summary.rows.filter((row) => row.reportingDateSource === "actual_plaid_liability").length;
  const estimatedReportingDates = summary.rows.filter((row) =>
    row.reportingDateSource === "estimated_from_due_date" ||
    row.reportingDateSource === "inferred_from_statement_cycle"
  ).length;
  const unknownReportingDates = summary.rows.filter((row) => row.reportingDateSource === "unknown").length;

  if (unknownReportingDates > 0) {
    return {
      confidence: "low",
      reason: `${unknownReportingDates} card${unknownReportingDates === 1 ? " is" : "s are"} missing reporting timing.`,
      title: "Some statement-close guidance is unavailable."
    };
  }

  if (actualReportingDates > 0 && estimatedReportingDates === 0) {
    return {
      confidence: "high",
      reason: "Connected liability data includes statement dates for every visible card with timing guidance.",
      title: "Statement timing is grounded in Plaid liability fields."
    };
  }

  return {
    confidence: "medium",
    reason: `${estimatedReportingDates} card${estimatedReportingDates === 1 ? " uses" : "s use"} inferred or due-date-based timing.`,
    title: "Some statement timing is estimated."
  };
}

export function buildCreditHealthSummary({
  liabilities,
  scoreSnapshots
}: {
  liabilities: LiabilitiesDueSummary;
  scoreSnapshots?: readonly CreditScoreSnapshotInput[];
}): CreditHealthSummary {
  return {
    guidance: [
      paymentHistoryGuidance(liabilities),
      utilizationGuidance(liabilities),
      sourceCoverageGuidance(liabilities)
    ],
    score: buildCreditScoreSummary(scoreSnapshots ?? [])
  };
}

export function assessRewardsBenefitsCapability(
  accounts: readonly AccountRecord[]
): RewardsBenefitsCapability {
  const activeCreditCards = accounts.filter((account) => account.isActive && account.type === "credit");
  const hasCreditTransactionsSurface = activeCreditCards.length > 0;

  return {
    confidence: "high",
    liveDataStatus: "not_supported_by_current_plaid_integration",
    nextSteps: [
      "Keep issuer rewards balances, card benefit inventories, credits, and points as manual or partner-sourced data until a vetted provider exists.",
      "Use connected transactions only for opt-in spend-category analysis; do not infer exact reward earnings from Plaid categories alone.",
      "If Cardlytics or another rewards partner is evaluated later, isolate processor-token creation server-side and document its separate consent and commercial requirements."
    ],
    supportedNow: hasCreditTransactionsSurface
      ? [
          "Connected credit-card account names and balances.",
          "Transaction merchant/category history for rough spend-category analysis.",
          "Plaid liabilities fields already stored by Tally when supported by the institution."
        ]
      : [
          "No connected active credit cards are available for rewards analysis."
        ],
    unsupportedNow: [
      "Issuer benefit enrollment or unused statement credits.",
      "Cashback balance, points balance, miles balance, or redemption value.",
      "Card-specific reward multipliers and real-time earned rewards.",
      "A production Plaid endpoint in this app that returns rewards or benefits directly."
    ]
  };
}
