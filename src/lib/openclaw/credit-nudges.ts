import type {
  LiabilitiesDueSummary,
  LiabilityAccountSummary,
  LiabilityTargetPaymentAction,
  LiabilityTargetPaymentPlan
} from "@/lib/finance/liabilities";

export type CreditOptimizationTrigger =
  | "due_date_risk"
  | "payment_reminder"
  | "cycle_close_high_utilization"
  | "cash_safe_under_target";

export type CreditOptimizationPriority = "normal" | "high";

export interface CreditOptimizationPacket {
  id: string;
  accountDisplayName: string;
  amount: number;
  payByDate: string;
  priority: CreditOptimizationPriority;
  rationale: string;
  targetUtilizationPercent: number | null;
  trigger: CreditOptimizationTrigger;
}

const NEAR_CYCLE_CLOSE_DAYS = 14;
// How far ahead of a real due date we surface an advisory minimum-payment
// reminder. Kept wider than the due-soon window so the reminder lights up as
// soon as connected liability data (due date + minimum payment) is available.
const PAYMENT_REMINDER_HORIZON_DAYS = 21;
const RECENT_PAYMENT_LOOKBACK_DAYS = 14;
const NON_CRITICAL_LIMIT = 1;
const MAX_DISPLAY_NAME = 60;

function dayDifference(fromIso: string, toIso: string) {
  const from = Date.parse(`${fromIso}T12:00:00.000Z`);
  const to = Date.parse(`${toIso}T12:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function money(value: number) {
  return `$${Math.round(Math.max(0, value)).toLocaleString("en-US")}`;
}

function shortDate(iso: string) {
  return iso;
}

function accountDisplayName(row: LiabilityAccountSummary) {
  const trimmed = row.name.trim();
  const withMask = row.mask ? `${trimmed} (…${row.mask})` : trimmed;
  if (withMask.length <= MAX_DISPLAY_NAME) return withMask;
  return `${withMask.slice(0, MAX_DISPLAY_NAME - 1).trimEnd()}…`;
}

function pickActionForAccount(
  plan: LiabilityTargetPaymentPlan | undefined,
  accountId: string
): LiabilityTargetPaymentAction | null {
  if (!plan) return null;
  return plan.actions.find((action) => action.accountId === accountId) ?? null;
}

function hasRecentLikelyPayment(row: LiabilityAccountSummary, asOfDate: string) {
  if (!row.lastPaymentDate) return false;
  const days = dayDifference(row.lastPaymentDate, asOfDate);
  if (days === null) return false;
  return days >= 0 && days <= RECENT_PAYMENT_LOOKBACK_DAYS;
}

function dueDateRiskPacket(
  row: LiabilityAccountSummary,
  asOfDate: string
): CreditOptimizationPacket | null {
  if (row.amountOwed <= 0) return null;
  if (!row.dueDateIsActual || !row.estimatedDueDate) return null;
  if (row.status !== "overdue" && row.status !== "due-soon") return null;
  if (hasRecentLikelyPayment(row, asOfDate)) return null;

  const display = accountDisplayName(row);
  const amount = row.minimumPaymentAmount && row.minimumPaymentAmount > 0
    ? Math.min(row.amountOwed, row.minimumPaymentAmount)
    : row.amountOwed;
  const urgency = row.status === "overdue"
    ? "is past due"
    : `is due ${shortDate(row.estimatedDueDate)}`;

  return {
    id: `openclaw-outbox:credit:due-risk:${row.accountId}:${row.estimatedDueDate}`,
    accountDisplayName: display,
    amount,
    payByDate: row.estimatedDueDate,
    priority: "high",
    rationale: `${display} ${urgency} and no recent payment was detected. Pay at least ${money(amount)} to avoid a late fee.`,
    targetUtilizationPercent: null,
    trigger: "due_date_risk"
  };
}

function paymentReminderPacket(
  row: LiabilityAccountSummary,
  asOfDate: string
): CreditOptimizationPacket | null {
  if (row.amountOwed <= 0) return null;
  // Only fire when real connected liability data is present: an actual Plaid
  // due date plus a reported minimum payment. Estimated due dates never qualify.
  if (!row.dueDateIsActual || !row.estimatedDueDate) return null;
  if (!row.minimumPaymentAmount || row.minimumPaymentAmount <= 0) return null;
  if (hasRecentLikelyPayment(row, asOfDate)) return null;

  const days = dayDifference(asOfDate, row.estimatedDueDate);
  if (days === null || days < 0 || days > PAYMENT_REMINDER_HORIZON_DAYS) return null;

  const display = accountDisplayName(row);
  const amount = Math.min(row.amountOwed, row.minimumPaymentAmount);
  const timing = days === 0 ? "today" : days === 1 ? "in 1 day" : `in ${days} days`;

  return {
    id: `openclaw-outbox:credit:payment-reminder:${row.accountId}:${row.estimatedDueDate}`,
    accountDisplayName: display,
    amount,
    payByDate: row.estimatedDueDate,
    priority: "normal",
    rationale: `${display} has a minimum payment of ${money(amount)} due ${timing} (${shortDate(row.estimatedDueDate)}). Schedule at least the minimum to stay current; this is advisory, not a credit-score prediction.`,
    targetUtilizationPercent: null,
    trigger: "payment_reminder"
  };
}

function cycleCloseHighUtilizationPacket(
  row: LiabilityAccountSummary,
  asOfDate: string,
  target30Action: LiabilityTargetPaymentAction | null
): CreditOptimizationPacket | null {
  if (row.amountOwed <= 0) return null;
  if (row.utilizationPercent === null || row.utilizationPercent < 50) return null;
  if (!row.reportingDate || row.reportingDateConfidence === "unknown") return null;
  if (!target30Action || target30Action.recommendedPayment <= 0) return null;

  const days = dayDifference(asOfDate, row.reportingDate);
  if (days === null || days > NEAR_CYCLE_CLOSE_DAYS || days < 0) return null;

  const display = accountDisplayName(row);
  const payment = target30Action.recommendedPayment;
  const rationale = target30Action.cashShortfall <= 0
    ? `${display} is at ${row.utilizationPercent.toFixed(0)}% utilization and reports on ${shortDate(row.reportingDate)}. A cash-safe ${money(payment)} payment by ${shortDate(target30Action.payByDate)} would bring it under ${target30Action.targetUtilizationPercent}%.`
    : `${display} is at ${row.utilizationPercent.toFixed(0)}% utilization and reports on ${shortDate(row.reportingDate)}. ${money(payment)} fits above your cash buffer and reduces the likely reported balance.`;

  return {
    id: `openclaw-outbox:credit:cycle:${row.accountId}:${row.reportingDate}:${target30Action.targetUtilizationPercent}`,
    accountDisplayName: display,
    amount: payment,
    payByDate: target30Action.payByDate,
    priority: "high",
    rationale,
    targetUtilizationPercent: target30Action.targetUtilizationPercent,
    trigger: "cycle_close_high_utilization"
  };
}

function cashSafeUnderTargetPacket(
  row: LiabilityAccountSummary,
  target30Action: LiabilityTargetPaymentAction | null
): CreditOptimizationPacket | null {
  if (row.amountOwed <= 0) return null;
  if (!target30Action) return null;
  if (target30Action.cashShortfall > 0) return null;
  if (target30Action.recommendedPayment <= 0) return null;
  if (row.utilizationPercent === null || row.utilizationPercent < 30) return null;

  const display = accountDisplayName(row);
  return {
    id: `openclaw-outbox:credit:cash-safe:${row.accountId}:${target30Action.reportingDate}:${target30Action.targetUtilizationPercent}`,
    accountDisplayName: display,
    amount: target30Action.recommendedPayment,
    payByDate: target30Action.payByDate,
    priority: "normal",
    rationale: `${display} can be brought under ${target30Action.targetUtilizationPercent}% with a cash-safe ${money(target30Action.recommendedPayment)} payment by ${shortDate(target30Action.payByDate)}.`,
    targetUtilizationPercent: target30Action.targetUtilizationPercent,
    trigger: "cash_safe_under_target"
  };
}

export function buildCreditOptimizationPackets(
  summary: LiabilitiesDueSummary
): CreditOptimizationPacket[] {
  const asOfDate = summary.asOfDate;
  const target30Plan = summary.targetPaymentPlans.find((plan) => plan.targetUtilizationPercent === 30);

  const critical: CreditOptimizationPacket[] = [];
  const nonCritical: CreditOptimizationPacket[] = [];

  for (const row of summary.rows) {
    const due = dueDateRiskPacket(row, asOfDate);
    if (due) {
      critical.push(due);
      continue;
    }

    const reminder = paymentReminderPacket(row, asOfDate);
    if (reminder) {
      critical.push(reminder);
      continue;
    }

    const target30Action = pickActionForAccount(target30Plan, row.accountId);
    const cycle = cycleCloseHighUtilizationPacket(row, asOfDate, target30Action);
    if (cycle) {
      nonCritical.push(cycle);
      continue;
    }

    const cashSafe = cashSafeUnderTargetPacket(row, target30Action);
    if (cashSafe) nonCritical.push(cashSafe);
  }

  nonCritical.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
    const dateDiff = a.payByDate.localeCompare(b.payByDate);
    if (dateDiff !== 0) return dateDiff;
    return b.amount - a.amount;
  });

  return [...critical, ...nonCritical.slice(0, NON_CRITICAL_LIMIT)];
}
