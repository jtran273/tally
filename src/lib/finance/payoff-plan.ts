import type {
  LiabilityAccountSummary,
  LiabilityStatus,
  ReportingDateConfidence,
  ReportingDateSource
} from "./liabilities";

export type UtilizationTier = "optimal" | "ok" | "high" | "critical" | "unknown";
export type ReportingOptimizationTarget = "under_30" | "under_10";

export interface DueDateSafetyPlan {
  dueDate: string | null;
  daysUntilDue: number | null;
  dueDateIsActual: boolean;
  minimumPaymentAmount: number | null;
  status: LiabilityStatus;
  actionText: string | null;
}

export interface ReportingPaymentAction {
  target: ReportingOptimizationTarget;
  targetThresholdPercent: 30 | 10;
  targetUtilizationPercent: number;
  paymentNeeded: number;
  affordablePayment: number;
  isFullyFunded: boolean;
  projectedUtilizationPercent: number | null;
  payByDate: string | null;
  reason: string;
}

export interface ReportedBalanceOptimizationPlan {
  reportingDate: string | null;
  daysUntilReporting: number | null;
  payByDate: string | null;
  processingBufferDays: number;
  source: ReportingDateSource;
  confidence: ReportingDateConfidence;
  sourceLabel: string;
  confidenceLabel: string;
  anchorDate: string | null;
  actions: ReportingPaymentAction[];
  recommendedAction: ReportingPaymentAction | null;
  actionText: string | null;
}

export interface PayoffCardPlan {
  accountId: string;
  name: string;
  mask: string | null;
  balance: number;
  creditLimit: number | null;
  utilizationPercent: number | null;
  tier: UtilizationTier;
  payToReachThirty: number;
  payToReachTen: number;
  payToZero: number;
  suggestedPayment: number;
  // Reported utilization after the suggested payment lands.
  projectedUtilizationPercent: number | null;
  projectedTier: UtilizationTier;
  // Statement-close date: when present, derived from the actual last
  // statement-issue date returned by Plaid; otherwise estimated as
  // (next due date − 21 days). This is the deadline that matters for the
  // next bureau report.
  statementCloseDate: string | null;
  daysUntilStatementClose: number | null;
  statementCloseIsActual: boolean;
  dueDate: string | null;
  // The date the next statement closes — what credit bureaus actually
  // snapshot. ≈ due date + 9 days for a 30-day cycle.
  nextReportingDate: string | null;
  daysUntilNextReporting: number | null;
  minimumPaymentAmount: number | null;
  // Plain-English action line, e.g. "Pay $187 by Jun 18 to drop from 42% to 28%".
  actionText: string | null;
  dueDateSafety: DueDateSafetyPlan;
  reportedBalanceOptimization: ReportedBalanceOptimizationPlan;
}

export interface PayoffPlan {
  cards: PayoffCardPlan[];
  totalBalance: number;
  totalLimit: number;
  aggregateUtilization: number | null;
  aggregateTier: UtilizationTier;
  cashAvailable: number;
  cashBuffer: number;
  cashDeployable: number;
  cashApplied: number;
  projectedUtilization: number | null;
  projectedTier: UtilizationTier;
  highestIndividualUtilization: number | null;
  highestIndividualCard: PayoffCardPlan | null;
  topPick: PayoffCardPlan | null;
}

const OPTIMAL_MAX = 10;
const OK_MAX = 30;
const HIGH_MAX = 50;
const BELOW_OK_TARGET = 29.9;
const BELOW_OPTIMAL_TARGET = 9.9;
const DEFAULT_PROCESSING_BUFFER_DAYS = 3;
const DEFAULT_BILLING_CYCLE_DAYS = 30;
const REPORTING_FROM_DUE_DATE_OFFSET_DAYS = 9;

export function tierForUtilization(util: number | null): UtilizationTier {
  if (util === null) return "unknown";
  if (util < OPTIMAL_MAX) return "optimal";
  if (util < OK_MAX) return "ok";
  if (util < HIGH_MAX) return "high";
  return "critical";
}

export function tierLabel(tier: UtilizationTier): string {
  switch (tier) {
    case "optimal":
      return "Looks great";
    case "ok":
      return "Looks fine";
    case "high":
      return "Pay this down";
    case "critical":
      return "Pay this down now";
    default:
      return "No limit reported";
  }
}

function payToReach(balance: number, limit: number | null, targetPct: number): number {
  if (!limit || limit <= 0) return 0;
  const target = (targetPct / 100) * limit;
  return Math.max(0, Math.round((balance - target) * 100) / 100);
}

function projectedUtilizationAfterPayment(
  balance: number,
  creditLimit: number | null,
  payment: number
): number | null {
  if (!creditLimit || creditLimit <= 0) return null;
  const projectedBalance = Math.max(0, balance - payment);
  return Math.round((projectedBalance / creditLimit) * 1000) / 10;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function addDays(value: string, days: number): string {
  return isoDate(new Date(parseIsoDate(value).getTime() + days * 86_400_000));
}

function dayDifference(fromIso: string, toIso: string) {
  return Math.round(
    (parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime()) / 86_400_000
  );
}

function formatShortDate(iso: string): string {
  const d = parseIsoDate(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function reportingConfidenceForSource(source: ReportingDateSource): ReportingDateConfidence {
  switch (source) {
    case "actual_plaid_liability":
      return "high";
    case "inferred_from_statement_cycle":
      return "medium";
    case "estimated_from_due_date":
      return "low";
    default:
      return "unknown";
  }
}

function reportingSourceLabel(source: ReportingDateSource): string {
  switch (source) {
    case "actual_plaid_liability":
      return "Plaid liability date";
    case "inferred_from_statement_cycle":
      return "Inferred from statement cycle";
    case "estimated_from_due_date":
      return "Estimated from due date";
    default:
      return "Reporting date unknown";
  }
}

function reportingConfidenceLabel(confidence: ReportingDateConfidence): string {
  switch (confidence) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
    default:
      return "Unknown confidence";
  }
}

function normalizeReportingSource(value: ReportingDateSource | undefined): ReportingDateSource {
  return value ?? "unknown";
}

function resolveReportingMetadata({
  dueDate,
  row,
  today
}: {
  dueDate: string | null;
  row: LiabilityAccountSummary;
  today: string;
}): Pick<
  ReportedBalanceOptimizationPlan,
  "anchorDate" | "confidence" | "daysUntilReporting" | "reportingDate" | "source"
> {
  if (row.reportingDate && row.reportingDateSource && row.reportingDateSource !== "unknown") {
    const source = normalizeReportingSource(row.reportingDateSource);
    return {
      anchorDate: row.reportingDateAnchorDate ?? null,
      confidence: row.reportingDateConfidence ?? reportingConfidenceForSource(source),
      daysUntilReporting: dayDifference(today, row.reportingDate),
      reportingDate: row.reportingDate,
      source
    };
  }

  if (row.lastStatementIssueDate) {
    let reportingDate = addDays(row.lastStatementIssueDate, DEFAULT_BILLING_CYCLE_DAYS);
    while (dayDifference(today, reportingDate) < 0) {
      reportingDate = addDays(reportingDate, DEFAULT_BILLING_CYCLE_DAYS);
    }
    return {
      anchorDate: row.lastStatementIssueDate,
      confidence: "medium",
      daysUntilReporting: dayDifference(today, reportingDate),
      reportingDate,
      source: "inferred_from_statement_cycle"
    };
  }

  if (dueDate) {
    const reportingDate = addDays(dueDate, REPORTING_FROM_DUE_DATE_OFFSET_DAYS);
    return {
      anchorDate: dueDate,
      confidence: "low",
      daysUntilReporting: dayDifference(today, reportingDate),
      reportingDate,
      source: "estimated_from_due_date"
    };
  }

  return {
    anchorDate: null,
    confidence: "unknown",
    daysUntilReporting: null,
    reportingDate: null,
    source: "unknown"
  };
}

function buildDueDateSafetyActionText(card: PayoffCardPlan): string | null {
  if (!card.dueDate) return null;
  if (card.dueDateSafety.status === "overdue") {
    const minimum = card.minimumPaymentAmount && card.minimumPaymentAmount > 0
      ? ` at least ${formatMoney(card.minimumPaymentAmount)}`
      : "";
    return `Make${minimum} the payment now to protect payment history.`;
  }
  if (card.dueDateSafety.status === "due-soon") {
    const minimum = card.minimumPaymentAmount && card.minimumPaymentAmount > 0
      ? ` at least ${formatMoney(card.minimumPaymentAmount)}`
      : "";
    return `Pay${minimum} by ${formatShortDate(card.dueDate)} to protect payment history.`;
  }
  return null;
}

function buildReportedBalanceActionText(card: PayoffCardPlan): string | null {
  if (card.suggestedPayment <= 0) {
    if (card.tier === "optimal") return "No action needed.";
    return null;
  }
  if (!card.reportedBalanceOptimization.reportingDate || !card.reportedBalanceOptimization.payByDate) {
    return null;
  }
  if (card.creditLimit === null || card.utilizationPercent === null || card.projectedUtilizationPercent === null) {
    return null;
  }

  const deadlineIso = card.reportedBalanceOptimization.payByDate;
  const deadlineLabel = deadlineIso ? formatShortDate(deadlineIso) : null;
  const reportLabel = formatShortDate(card.reportedBalanceOptimization.reportingDate);
  const from = card.utilizationPercent;
  const to = card.projectedUtilizationPercent;
  const estimateWord = card.reportedBalanceOptimization.confidence === "high" ? "likely" : "estimated";
  const dropClause =
    ` to reduce ${estimateWord} reported utilization from ${from.toFixed(0)}% to ${to.toFixed(0)}%` +
    ` before ${reportLabel}. This is not a score prediction.`;

  if (deadlineLabel) {
    return `Pay ${formatMoney(card.suggestedPayment)} by ${deadlineLabel}${dropClause}`;
  }
  return `Pay ${formatMoney(card.suggestedPayment)}${dropClause}`;
}

function buildReportingPaymentActions(
  card: Pick<
    PayoffCardPlan,
    | "balance"
    | "creditLimit"
    | "projectedUtilizationPercent"
    | "reportedBalanceOptimization"
    | "suggestedPayment"
    | "utilizationPercent"
  >
): ReportingPaymentAction[] {
  if (!card.creditLimit || card.creditLimit <= 0 || card.utilizationPercent === null) return [];

  const targets: {
    reason: string;
    target: ReportingOptimizationTarget;
    targetThresholdPercent: 30 | 10;
    targetUtilizationPercent: number;
  }[] = [
    {
      reason: "Bring this card under 30% utilization before the balance may report.",
      target: "under_30",
      targetThresholdPercent: 30,
      targetUtilizationPercent: BELOW_OK_TARGET
    },
    {
      reason: "Bring this card under 10% utilization before the balance may report.",
      target: "under_10",
      targetThresholdPercent: 10,
      targetUtilizationPercent: BELOW_OPTIMAL_TARGET
    }
  ];

  return targets
    .map((target) => {
      const paymentNeeded = payToReach(card.balance, card.creditLimit, target.targetUtilizationPercent);
      const affordablePayment = Math.min(card.suggestedPayment, paymentNeeded);
      return {
        ...target,
        affordablePayment: Math.round(affordablePayment * 100) / 100,
        isFullyFunded: paymentNeeded > 0 && affordablePayment >= paymentNeeded,
        paymentNeeded,
        payByDate: card.reportedBalanceOptimization.payByDate,
        projectedUtilizationPercent: projectedUtilizationAfterPayment(
          card.balance,
          card.creditLimit,
          affordablePayment
        )
      };
    })
    .filter((action) => action.paymentNeeded > 0);
}

export function buildPayoffPlan({
  cashBuffer = 0,
  rows,
  cashAvailable,
  asOfDate,
  processingBufferDays = DEFAULT_PROCESSING_BUFFER_DAYS
}: {
  cashBuffer?: number;
  rows: readonly LiabilityAccountSummary[];
  cashAvailable: number;
  asOfDate?: string;
  processingBufferDays?: number;
}): PayoffPlan {
  const today = asOfDate ?? isoDate(new Date());
  const activeRows = rows.filter((row) => row.amountOwed > 0);

  const totalBalance = Math.round(activeRows.reduce((sum, r) => sum + r.amountOwed, 0) * 100) / 100;
  const totalLimit = activeRows.reduce((sum, r) => sum + (r.creditLimit ?? 0), 0);
  const aggregateUtilization =
    totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 1000) / 10 : null;

  const cards: PayoffCardPlan[] = activeRows.map((row) => {
    const tier = tierForUtilization(row.utilizationPercent);

    // Payment-history safety is separate from reported-balance optimization.
    // Roll stale due dates forward by normal billing cycles so old estimates do
    // not create overdue-looking reporting guidance.
    let dueDate = row.estimatedDueDate;
    while (dueDate && dayDifference(today, dueDate) < 0) {
      dueDate = addDays(dueDate, DEFAULT_BILLING_CYCLE_DAYS);
    }
    const dueDateIsActual = Boolean(row.dueDateIsActual);
    const reportingMetadata = resolveReportingMetadata({ dueDate, row, today });
    const bufferDays = Math.max(0, Math.round(processingBufferDays));
    const reportingPayByDate = reportingMetadata.reportingDate
      ? addDays(reportingMetadata.reportingDate, -bufferDays)
      : null;
    const dueDateSafety: DueDateSafetyPlan = {
      actionText: null,
      daysUntilDue: dueDate ? dayDifference(today, dueDate) : null,
      dueDate,
      dueDateIsActual,
      minimumPaymentAmount: row.minimumPaymentAmount ?? null,
      status: row.status
    };
    const reportedBalanceOptimization: ReportedBalanceOptimizationPlan = {
      actions: [],
      actionText: null,
      anchorDate: reportingMetadata.anchorDate,
      confidence: reportingMetadata.confidence,
      confidenceLabel: reportingConfidenceLabel(reportingMetadata.confidence),
      daysUntilReporting: reportingMetadata.daysUntilReporting,
      payByDate: reportingPayByDate,
      processingBufferDays: bufferDays,
      recommendedAction: null,
      reportingDate: reportingMetadata.reportingDate,
      source: reportingMetadata.source,
      sourceLabel: reportingSourceLabel(reportingMetadata.source)
    };

    return {
      accountId: row.accountId,
      name: row.name,
      mask: row.mask,
      balance: row.amountOwed,
      creditLimit: row.creditLimit,
      utilizationPercent: row.utilizationPercent,
      tier,
      payToReachThirty: payToReach(row.amountOwed, row.creditLimit, OK_MAX),
      payToReachTen: payToReach(row.amountOwed, row.creditLimit, OPTIMAL_MAX),
      payToZero: row.amountOwed,
      suggestedPayment: 0,
      projectedUtilizationPercent: row.utilizationPercent,
      projectedTier: tier,
      statementCloseDate: reportingMetadata.reportingDate,
      daysUntilStatementClose: reportingMetadata.daysUntilReporting,
      statementCloseIsActual: reportingMetadata.source === "actual_plaid_liability",
      dueDate,
      nextReportingDate: reportingMetadata.reportingDate,
      daysUntilNextReporting: reportingMetadata.daysUntilReporting,
      minimumPaymentAmount: row.minimumPaymentAmount ?? null,
      actionText: null,
      dueDateSafety,
      reportedBalanceOptimization
    };
  });

  // Greedy allocation:
  // 1. Bring every card above 30% down to 30% (biggest score gain per dollar).
  // 2. Then push every card from 30% down to 10% (optimal tier).
  // 3. Then highest-balance first as an APR-free interest proxy.
  const byUtil = [...cards].sort((a, b) => {
    const aUtil = a.utilizationPercent ?? -1;
    const bUtil = b.utilizationPercent ?? -1;
    if (bUtil !== aUtil) return bUtil - aUtil;
    return b.balance - a.balance;
  });

  const normalizedCashAvailable = Math.max(0, cashAvailable);
  const normalizedCashBuffer = Math.max(0, cashBuffer);
  const cashDeployable = Math.max(0, normalizedCashAvailable - normalizedCashBuffer);
  let remaining = cashDeployable;

  for (const card of byUtil) {
    const need = payToReach(card.balance, card.creditLimit, BELOW_OK_TARGET);
    if (need <= 0) continue;
    const apply = Math.min(remaining, need);
    card.suggestedPayment += apply;
    remaining -= apply;
    if (remaining <= 0) break;
  }
  for (const card of byUtil) {
    if (remaining <= 0) break;
    const stillOwedAfter = card.balance - card.suggestedPayment;
    const target = card.creditLimit ? (BELOW_OPTIMAL_TARGET / 100) * card.creditLimit : 0;
    const need = Math.max(0, stillOwedAfter - target);
    if (need <= 0) continue;
    const apply = Math.min(remaining, need);
    card.suggestedPayment += apply;
    remaining -= apply;
  }
  const byBalance = [...cards].sort((a, b) => b.balance - a.balance);
  for (const card of byBalance) {
    if (remaining <= 0) break;
    const stillOwedAfter = card.balance - card.suggestedPayment;
    if (stillOwedAfter <= 0) continue;
    const apply = Math.min(remaining, stillOwedAfter);
    card.suggestedPayment += apply;
    remaining -= apply;
  }

  const cashApplied = Math.round((cashDeployable - remaining) * 100) / 100;

  // Compute projected per-card utilization and the action text now that
  // suggestedPayment is settled.
  for (const card of cards) {
    card.suggestedPayment = Math.round(card.suggestedPayment * 100) / 100;
    if (card.creditLimit && card.creditLimit > 0) {
      const projected = projectedUtilizationAfterPayment(card.balance, card.creditLimit, card.suggestedPayment);
      card.projectedUtilizationPercent = projected;
      card.projectedTier = tierForUtilization(projected);
    }
    card.dueDateSafety.actionText = buildDueDateSafetyActionText(card);
    card.reportedBalanceOptimization.actions = buildReportingPaymentActions(card);
    card.reportedBalanceOptimization.recommendedAction =
      [...card.reportedBalanceOptimization.actions]
        .filter((action) => action.affordablePayment > 0)
        .sort((a, b) => {
          if (Number(b.isFullyFunded) !== Number(a.isFullyFunded)) {
            return Number(b.isFullyFunded) - Number(a.isFullyFunded);
          }
          return b.targetThresholdPercent - a.targetThresholdPercent;
        })[0] ?? null;
    card.reportedBalanceOptimization.actionText = buildReportedBalanceActionText(card);
    card.actionText = card.reportedBalanceOptimization.actionText;
  }

  const projectedBalance = Math.max(0, totalBalance - cashApplied);
  const projectedUtilization =
    totalLimit > 0 ? Math.round((projectedBalance / totalLimit) * 1000) / 10 : null;

  const topPick =
    [...cards]
      .filter((c) => c.suggestedPayment > 0)
      .sort((a, b) => {
        if (b.suggestedPayment !== a.suggestedPayment) return b.suggestedPayment - a.suggestedPayment;
        return (b.utilizationPercent ?? 0) - (a.utilizationPercent ?? 0);
      })[0] ?? null;
  const highestIndividualCard =
    [...cards]
      .filter((card) => card.utilizationPercent !== null)
      .sort((a, b) => {
        const utilizationDiff = (b.utilizationPercent ?? 0) - (a.utilizationPercent ?? 0);
        if (utilizationDiff !== 0) return utilizationDiff;
        return b.balance - a.balance;
      })[0] ?? null;

  return {
    cards,
    totalBalance,
    totalLimit,
    aggregateUtilization,
    aggregateTier: tierForUtilization(aggregateUtilization),
    cashAvailable: normalizedCashAvailable,
    cashBuffer: normalizedCashBuffer,
    cashDeployable,
    cashApplied,
    projectedUtilization,
    projectedTier: tierForUtilization(projectedUtilization),
    highestIndividualUtilization: highestIndividualCard?.utilizationPercent ?? null,
    highestIndividualCard,
    topPick
  };
}
