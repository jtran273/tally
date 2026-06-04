import assert from "node:assert/strict";
import test from "node:test";
import type { LiabilityAccountSummary } from "./liabilities";
import { buildPayoffPlan, tierForUtilization, tierLabel } from "./payoff-plan";

function row(input: Partial<LiabilityAccountSummary> & {
  accountId: string;
  amountOwed: number;
  creditLimit: number | null;
}): LiabilityAccountSummary {
  const util =
    input.creditLimit && input.creditLimit > 0
      ? Math.round((input.amountOwed / input.creditLimit) * 1000) / 10
      : null;
  return {
    accountId: input.accountId,
    name: input.name ?? `Card ${input.accountId}`,
    mask: input.mask ?? "0000",
    institutionName: input.institutionName ?? "Bank",
    amountOwed: input.amountOwed,
    creditLimit: input.creditLimit,
    utilizationPercent: input.utilizationPercent ?? util,
    lastPaymentDate: input.lastPaymentDate ?? null,
    lastPaymentAmount: input.lastPaymentAmount ?? null,
    estimatedDueDate: input.estimatedDueDate ?? null,
    daysUntilDue: input.daysUntilDue ?? null,
    status: input.status ?? "current",
    lastStatementIssueDate: input.lastStatementIssueDate ?? null,
    lastStatementBalance: input.lastStatementBalance ?? null,
    minimumPaymentAmount: input.minimumPaymentAmount ?? null,
    dueDateIsActual: input.dueDateIsActual ?? false,
    reportingDate: input.reportingDate ?? null,
    reportingDateAnchorDate: input.reportingDateAnchorDate ?? null,
    reportingDateConfidence: input.reportingDateConfidence ?? "unknown",
    reportingDateSource: input.reportingDateSource ?? "unknown"
  };
}

test("tierForUtilization classifies thresholds", () => {
  assert.equal(tierForUtilization(null), "unknown");
  assert.equal(tierForUtilization(0), "optimal");
  assert.equal(tierForUtilization(9.9), "optimal");
  assert.equal(tierForUtilization(10), "ok");
  assert.equal(tierForUtilization(29.9), "ok");
  assert.equal(tierForUtilization(30), "high");
  assert.equal(tierForUtilization(49.9), "high");
  assert.equal(tierForUtilization(50), "critical");
  assert.equal(tierLabel("critical"), "Pay this down now");
});

test("excludes zero-balance and limitless cards from active rows", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 1000,
    rows: [
      row({ accountId: "a", amountOwed: 0, creditLimit: 5000 }),
      row({ accountId: "b", amountOwed: 100, creditLimit: 1000 })
    ]
  });
  assert.equal(plan.cards.length, 1);
  assert.equal(plan.cards[0]?.accountId, "b");
});

test("greedy allocator: drops above-30% cards first, then below 10%, then biggest balance", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 5000,
    rows: [
      // 40% util → step 1 wants $1000 to hit 30%, then step 2 wants $2000 more to hit 10%
      row({ accountId: "high", amountOwed: 4000, creditLimit: 10000, estimatedDueDate: "2026-06-15" }),
      // 5% util → already optimal, no step 1/2 work
      row({ accountId: "low", amountOwed: 50, creditLimit: 1000, estimatedDueDate: "2026-06-20" })
    ]
  });
  const high = plan.cards.find((c) => c.accountId === "high");
  const low = plan.cards.find((c) => c.accountId === "low");
  // High card should receive $3000 ($1000 to 30% + $2000 to 10%), then leftover $1950 by balance, then low gets $50.
  assert.equal(high?.suggestedPayment, 4000);
  assert.equal(low?.suggestedPayment, 50);
  assert.equal(plan.cashApplied, 4050);
  assert.equal(plan.projectedUtilization, 0);
});

test("partial cash applies to highest-utilization first", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 500,
    rows: [
      row({ accountId: "high", amountOwed: 4000, creditLimit: 10000, estimatedDueDate: "2026-06-15" }),
      row({ accountId: "mid", amountOwed: 2500, creditLimit: 10000, estimatedDueDate: "2026-06-20" })
    ]
  });
  const high = plan.cards.find((c) => c.accountId === "high");
  const mid = plan.cards.find((c) => c.accountId === "mid");
  // High at 40% > mid at 25%, so high gets the $500 (toward dropping to 30% — needs $1000 total)
  assert.equal(high?.suggestedPayment, 500);
  assert.equal(mid?.suggestedPayment, 0);
});

test("rolls past-due-date estimates forward to a future date", () => {
  // Estimated due date is in the past — should roll forward to ~today + cycle remainder
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-15",
    cashAvailable: 100,
    rows: [
      row({
        accountId: "stale",
        amountOwed: 500,
        creditLimit: 5000,
        estimatedDueDate: "2026-05-10" // 36 days ago
      })
    ]
  });
  const card = plan.cards[0];
  assert.ok(card?.dueDate, "due date should be present");
  assert.ok(
    card.dueDate! >= "2026-06-15",
    `due date should roll forward to >= today; got ${card.dueDate}`
  );
  // 2026-05-10 + 30 = 2026-06-09 (still past), +30 = 2026-07-09
  assert.equal(card.dueDate, "2026-07-09");
});

test("derives nextReportingDate from due date by default (+9 days)", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 1000,
    rows: [
      row({
        accountId: "a",
        amountOwed: 2000,
        creditLimit: 10000,
        estimatedDueDate: "2026-06-18"
      })
    ]
  });
  const card = plan.cards[0];
  assert.equal(card?.dueDate, "2026-06-18");
  assert.equal(card?.nextReportingDate, "2026-06-27");
});

test("prefers actual lastStatementIssueDate when present and rolls forward", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-15",
    cashAvailable: 1000,
    rows: [
      row({
        accountId: "a",
        amountOwed: 2000,
        creditLimit: 10000,
        estimatedDueDate: "2026-06-18",
        lastStatementIssueDate: "2026-04-10", // very old; +30 = May 10 still past, +30 again = Jun 9 still past, +30 = Jul 9
        dueDateIsActual: true
      })
    ]
  });
  const card = plan.cards[0];
  assert.equal(card?.statementCloseIsActual, false);
  assert.equal(card?.reportedBalanceOptimization.source, "inferred_from_statement_cycle");
  assert.equal(card?.reportedBalanceOptimization.confidence, "medium");
  // First +30 after 2026-04-10 = 2026-05-10; still past today (2026-06-15) → +30 = 2026-06-09; still past → +30 = 2026-07-09
  assert.equal(card?.nextReportingDate, "2026-07-09");
});

test("action text references the reporting pay-by date and avoids exact score promises", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 1500,
    rows: [
      row({
        accountId: "a",
        amountOwed: 2689.05,
        creditLimit: 19500,
        estimatedDueDate: "2026-06-18"
      })
    ]
  });
  const card = plan.cards[0];
  assert.match(card?.actionText ?? "", /Pay \$1,500\.00 by Jun 24/);
  assert.match(card?.actionText ?? "", /before Jun 27/);
  assert.match(card?.actionText ?? "", /from 14% to 6%/);
  assert.doesNotMatch(card?.actionText ?? "", /raise.*score|score.*points/i);
  assert.equal(card?.reportedBalanceOptimization.payByDate, "2026-06-24");
  assert.equal(card?.reportedBalanceOptimization.processingBufferDays, 3);
});

test("aggregate utilization and projected utilization reflect allocation", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 1800,
    rows: [
      row({ accountId: "a", amountOwed: 2689.05, creditLimit: 19500, estimatedDueDate: "2026-06-18" }),
      row({ accountId: "b", amountOwed: 420.35, creditLimit: 6000, estimatedDueDate: "2026-06-08" })
    ]
  });
  // total: 3109.40 / 25500 = 12.2%
  assert.equal(plan.aggregateUtilization, 12.2);
  // after applying $1800: remaining debt = 1309.40 / 25500 = 5.1%
  assert.equal(plan.projectedUtilization, 5.1);
  assert.equal(plan.cashApplied, 1800);
  assert.equal(plan.topPick?.accountId, "a");
});

test("topPick is null when no cash to apply", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 0,
    rows: [
      row({ accountId: "a", amountOwed: 100, creditLimit: 1000, estimatedDueDate: "2026-06-18" })
    ]
  });
  assert.equal(plan.topPick, null);
  assert.equal(plan.cards[0]?.suggestedPayment, 0);
});

test("missing credit limit does not create utilization target actions", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 500,
    rows: [
      row({
        accountId: "unknown-limit",
        amountOwed: 900,
        creditLimit: null,
        estimatedDueDate: "2026-06-18"
      })
    ]
  });
  const card = plan.cards[0];
  assert.equal(card?.utilizationPercent, null);
  assert.equal(card?.payToReachThirty, 0);
  assert.equal(card?.payToReachTen, 0);
  assert.deepEqual(card?.reportedBalanceOptimization.actions, []);
  assert.equal(card?.actionText, null);
});

test("unknown reporting date keeps due-date safety but suppresses reporting action text", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 500,
    rows: [
      row({
        accountId: "unknown-date",
        amountOwed: 2000,
        creditLimit: 4000,
        estimatedDueDate: null,
        minimumPaymentAmount: 80,
        status: "due-soon"
      })
    ]
  });
  const card = plan.cards[0];
  assert.equal(card?.reportedBalanceOptimization.source, "unknown");
  assert.equal(card?.reportedBalanceOptimization.confidence, "unknown");
  assert.equal(card?.reportedBalanceOptimization.payByDate, null);
  assert.equal(card?.actionText, null);
  assert.equal(card?.dueDateSafety.minimumPaymentAmount, 80);
  assert.equal(card?.dueDateSafety.status, "due-soon");
});

test("reporting metadata supports actual, inferred, estimated, and unknown sources", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 0,
    rows: [
      row({
        accountId: "actual",
        amountOwed: 100,
        creditLimit: 1000,
        reportingDate: "2026-06-12",
        reportingDateAnchorDate: "2026-06-12",
        reportingDateConfidence: "high",
        reportingDateSource: "actual_plaid_liability"
      }),
      row({
        accountId: "inferred",
        amountOwed: 100,
        creditLimit: 1000,
        lastStatementIssueDate: "2026-05-20"
      }),
      row({
        accountId: "estimated",
        amountOwed: 100,
        creditLimit: 1000,
        estimatedDueDate: "2026-06-18"
      }),
      row({
        accountId: "unknown",
        amountOwed: 100,
        creditLimit: 1000,
        estimatedDueDate: null
      })
    ]
  });

  const byId = new Map(plan.cards.map((card) => [card.accountId, card]));
  assert.equal(byId.get("actual")?.nextReportingDate, "2026-06-12");
  assert.equal(byId.get("actual")?.reportedBalanceOptimization.source, "actual_plaid_liability");
  assert.equal(byId.get("actual")?.reportedBalanceOptimization.confidence, "high");
  assert.equal(byId.get("actual")?.statementCloseIsActual, true);
  assert.equal(byId.get("inferred")?.nextReportingDate, "2026-06-19");
  assert.equal(byId.get("inferred")?.reportedBalanceOptimization.source, "inferred_from_statement_cycle");
  assert.equal(byId.get("inferred")?.reportedBalanceOptimization.confidence, "medium");
  assert.equal(byId.get("estimated")?.nextReportingDate, "2026-06-27");
  assert.equal(byId.get("estimated")?.reportedBalanceOptimization.source, "estimated_from_due_date");
  assert.equal(byId.get("estimated")?.reportedBalanceOptimization.confidence, "low");
  assert.equal(byId.get("unknown")?.nextReportingDate, null);
  assert.equal(byId.get("unknown")?.reportedBalanceOptimization.source, "unknown");
  assert.equal(byId.get("unknown")?.reportedBalanceOptimization.confidence, "unknown");
});

test("surfaces high individual utilization even when aggregate utilization is ok", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 1000,
    rows: [
      row({ accountId: "spike", amountOwed: 800, creditLimit: 1000, estimatedDueDate: "2026-06-15" }),
      row({ accountId: "wide", amountOwed: 1000, creditLimit: 20000, estimatedDueDate: "2026-06-20" })
    ]
  });

  assert.equal(plan.aggregateUtilization, 8.6);
  assert.equal(plan.aggregateTier, "optimal");
  assert.equal(plan.highestIndividualUtilization, 80);
  assert.equal(plan.highestIndividualCard?.accountId, "spike");
  assert.equal(plan.topPick?.accountId, "spike");
  assert.ok((plan.highestIndividualCard?.suggestedPayment ?? 0) > 500);
});

test("cash buffer limits deployable payoff guidance", () => {
  const plan = buildPayoffPlan({
    asOfDate: "2026-06-01",
    cashAvailable: 1000,
    cashBuffer: 750,
    rows: [
      row({ accountId: "a", amountOwed: 900, creditLimit: 1000, estimatedDueDate: "2026-06-15" })
    ]
  });

  const card = plan.cards[0];
  assert.equal(plan.cashAvailable, 1000);
  assert.equal(plan.cashBuffer, 750);
  assert.equal(plan.cashDeployable, 250);
  assert.equal(plan.cashApplied, 250);
  assert.equal(card?.suggestedPayment, 250);
  assert.equal(card?.reportedBalanceOptimization.actions[0]?.isFullyFunded, false);
  assert.equal(card?.reportedBalanceOptimization.actions[0]?.affordablePayment, 250);
});
