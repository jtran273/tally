import type { LiabilityAccountSummary } from "./liabilities";

export type UtilizationTier = "optimal" | "ok" | "high" | "critical" | "unknown";

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
  minimumPaymentAmount: number | null;
  // Plain-English action line, e.g. "Pay $187 by Jun 18 to drop from 42% to 28%".
  actionText: string | null;
}

export interface PayoffPlan {
  cards: PayoffCardPlan[];
  totalBalance: number;
  totalLimit: number;
  aggregateUtilization: number | null;
  aggregateTier: UtilizationTier;
  cashAvailable: number;
  cashApplied: number;
  projectedUtilization: number | null;
  projectedTier: UtilizationTier;
  topPick: PayoffCardPlan | null;
}

const OPTIMAL_MAX = 10;
const OK_MAX = 30;
const HIGH_MAX = 50;

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

function buildActionText(
  card: PayoffCardPlan,
  fallbackDeadlineIso: string | null
): string | null {
  if (card.suggestedPayment <= 0) {
    if (card.tier === "optimal") return "No action needed.";
    return null;
  }
  const deadlineIso = card.statementCloseDate ?? fallbackDeadlineIso;
  const deadlineLabel = deadlineIso ? formatShortDate(deadlineIso) : null;
  const from = card.utilizationPercent;
  const to = card.projectedUtilizationPercent;
  const dropClause =
    from !== null && to !== null
      ? ` Drops usage from ${from.toFixed(0)}% to ${to.toFixed(0)}%.`
      : "";

  if (deadlineLabel) {
    return `Pay ${formatMoney(card.suggestedPayment)} by ${deadlineLabel}.${dropClause}`;
  }
  return `Pay ${formatMoney(card.suggestedPayment)}.${dropClause}`;
}

export function buildPayoffPlan({
  rows,
  cashAvailable,
  asOfDate
}: {
  rows: readonly LiabilityAccountSummary[];
  cashAvailable: number;
  asOfDate?: string;
}): PayoffPlan {
  const today = asOfDate ?? isoDate(new Date());
  const activeRows = rows.filter((row) => row.amountOwed > 0);

  const totalBalance = Math.round(activeRows.reduce((sum, r) => sum + r.amountOwed, 0) * 100) / 100;
  const totalLimit = activeRows.reduce((sum, r) => sum + (r.creditLimit ?? 0), 0);
  const aggregateUtilization =
    totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 1000) / 10 : null;

  const cards: PayoffCardPlan[] = activeRows.map((row) => {
    const tier = tierForUtilization(row.utilizationPercent);

    // The deadline we surface to the user is the next payment due date.
    // Paying by then both avoids interest AND lands before the next
    // statement close (statement → due is ~21 days; close → close is ~30
    // days), so the lower balance is what gets reported next cycle.
    // Roll forward by 30-day cycles if the estimated date has already passed.
    let dueDate = row.estimatedDueDate;
    while (dueDate && dayDifference(today, dueDate) < 0) {
      dueDate = addDays(dueDate, 30);
    }
    const dueDateIsActual = Boolean(row.dueDateIsActual);

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
      statementCloseDate: dueDate,
      daysUntilStatementClose: dueDate ? dayDifference(today, dueDate) : null,
      statementCloseIsActual: dueDateIsActual,
      dueDate,
      minimumPaymentAmount: row.minimumPaymentAmount ?? null,
      actionText: null
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

  let remaining = Math.max(0, cashAvailable);

  for (const card of byUtil) {
    if (card.payToReachThirty <= 0) continue;
    const apply = Math.min(remaining, card.payToReachThirty);
    card.suggestedPayment += apply;
    remaining -= apply;
    if (remaining <= 0) break;
  }
  for (const card of byUtil) {
    if (remaining <= 0) break;
    const stillOwedAfter = card.balance - card.suggestedPayment;
    const target = card.creditLimit ? (OPTIMAL_MAX / 100) * card.creditLimit : 0;
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

  const cashApplied = Math.round((Math.max(0, cashAvailable) - remaining) * 100) / 100;

  // Compute projected per-card utilization and the action text now that
  // suggestedPayment is settled.
  const fallbackDeadlineIso = cards
    .map((c) => c.statementCloseDate)
    .filter((d): d is string => Boolean(d))
    .sort()[0] ?? null;

  for (const card of cards) {
    card.suggestedPayment = Math.round(card.suggestedPayment * 100) / 100;
    if (card.creditLimit && card.creditLimit > 0) {
      const projectedBalance = Math.max(0, card.balance - card.suggestedPayment);
      const projected = Math.round((projectedBalance / card.creditLimit) * 1000) / 10;
      card.projectedUtilizationPercent = projected;
      card.projectedTier = tierForUtilization(projected);
    }
    card.actionText = buildActionText(card, fallbackDeadlineIso);
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

  return {
    cards,
    totalBalance,
    totalLimit,
    aggregateUtilization,
    aggregateTier: tierForUtilization(aggregateUtilization),
    cashAvailable: Math.max(0, cashAvailable),
    cashApplied,
    projectedUtilization,
    projectedTier: tierForUtilization(projectedUtilization),
    topPick
  };
}
