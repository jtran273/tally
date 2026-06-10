import assert from "node:assert/strict";
import test from "node:test";
import { buildUpcomingCalendarContext } from "@/lib/calendar";
import type { Json } from "@/lib/db";
import type { BudgetGuardrailSummary } from "@/lib/finance/budget-guardrails";
import { buildMonthlyBudgetProposal } from "./monthly-budget-proposals";
import type { WeeklyPlanningContext } from "./weekly-planning-context";

const generatedAt = "2026-06-10T12:00:00.000Z";

function jsonObject(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function guardrails(input: Partial<BudgetGuardrailSummary> = {}): BudgetGuardrailSummary {
  return {
    asOfDate: "2026-06-10",
    baselineMonthCount: 3,
    fromDate: "2026-06-01",
    items: [
      {
        budgetAmount: 500,
        currentAmount: 220,
        id: "category-dining",
        label: "Dining",
        openReviewCount: 1,
        percentUsed: 44,
        projectedAmount: 660,
        projectedPercent: 132,
        remainingAmount: 280,
        status: "over",
        transactionCount: 6,
        trustedAmount: 170,
        unresolvedReviewAmount: 50
      },
      {
        budgetAmount: 300,
        currentAmount: 80,
        id: "category-groceries",
        label: "Groceries",
        openReviewCount: 0,
        percentUsed: 26.7,
        projectedAmount: 240,
        projectedPercent: 80,
        remainingAmount: 220,
        status: "on-track",
        transactionCount: 3,
        trustedAmount: 80,
        unresolvedReviewAmount: 0
      }
    ],
    monthElapsedDays: 10,
    monthTotalDays: 30,
    nearCount: 0,
    overCount: 1,
    toDate: "2026-06-10",
    ...input
  };
}

function weeklyContext(input: Partial<WeeklyPlanningContext> = {}): WeeklyPlanningContext {
  return {
    action: "read.weekly_planning_context",
    asOfDate: "2026-06-10",
    cashflow: {
      upcoming: {
        asOfDate: "2026-06-10",
        billTotal: 950,
        days: 30,
        dueSoonCount: 2,
        endDate: "2026-07-10",
        events: [],
        incomeTotal: 700,
        netTotal: -250,
        projectedCashBalance: null,
        startingCashBalance: null
      }
    },
    generatedAt,
    income: {
      currentWeekIncome: 0,
      previousWeekIncome: 0,
      upcomingProjectedIncome: 700
    },
    reimbursements: {
      expectedAmount: 120,
      outstandingAmount: 120,
      receivedAmount: 0,
      reimbursableAmount: 120,
      reimbursableCount: 1,
      reimbursedCount: 0,
      unmatchedIncomeAmount: 0,
      unmatchedIncomeCount: 0
    },
    review: {
      action: "read.review_queue_summary",
      examples: [],
      generatedAt,
      openCount: 2,
      reasonCounts: {},
      totalAbsoluteAmount: 50
    },
    spending: {
      currentWeek: {
        fromDate: "2026-06-04",
        income: 0,
        netCashflow: -220,
        openReviewTransactionCount: 1,
        previousMonth: undefined,
        reimbursementOutstanding: 120,
        reimbursable: 120,
        spending: 220,
        toDate: "2026-06-10",
        topCategories: [],
        topMerchants: [],
        transactionCount: 6,
        trustedSpending: 170,
        unresolvedReviewSpending: 50
      },
      grouped: {
        action: "read.spending_summary",
        byCategory: [],
        byIntent: [],
        fromDate: "2026-06-04",
        generatedAt,
        openReviewCount: 1,
        reimbursementOutstanding: 120,
        reimbursableAmount: 120,
        reimbursedAmount: 0,
        toDate: "2026-06-10",
        totalSpending: 220,
        transactionCount: 6
      },
      previousWeek: {
        fromDate: "2026-05-28",
        income: 0,
        netCashflow: -120,
        openReviewTransactionCount: 0,
        reimbursementOutstanding: 0,
        reimbursable: 0,
        spending: 120,
        toDate: "2026-06-03",
        topCategories: [],
        topMerchants: [],
        transactionCount: 4,
        trustedSpending: 120,
        unresolvedReviewSpending: 0
      }
    },
    sync: {
      action: "read.stale_sync_summary",
      accounts: [],
      generatedAt,
      summary: {
        freshCount: 0,
        latestSyncedAt: null,
        neverSyncedCount: 0,
        oldestSyncedAt: null,
        staleCount: 0,
        status: "fresh",
        totalAccounts: 0
      }
    },
    transfers: {
      count: 0,
      netAmount: 0,
      outflowAmount: 0
    },
    window: {
      fromDate: "2026-06-04",
      previousFromDate: "2026-05-28",
      previousToDate: "2026-06-03",
      toDate: "2026-06-10"
    },
    ...input
  } as WeeklyPlanningContext;
}

test("monthly budget proposal compiles advisory budget with bounded calendar pressure", () => {
  const compiled = buildMonthlyBudgetProposal({
    budgetGuardrails: guardrails(),
    calendarContext: buildUpcomingCalendarContext([
      {
        allDay: false,
        end: "2026-06-13T04:00:00.000Z",
        location: "Seattle, WA",
        start: "2026-06-13T02:00:00.000Z",
        title: "Dinner reservation"
      },
      {
        allDay: true,
        end: "2026-06-18",
        location: "SFO Airport",
        start: "2026-06-17",
        title: "Flight to Seattle"
      },
      {
        allDay: true,
        end: "2026-06-20",
        location: "Seattle, WA",
        start: "2026-06-19",
        title: "Hotel"
      }
    ], { generatedAt, now: new Date(generatedAt) }),
    generatedAt,
    weeklyPlanningContext: weeklyContext()
  });

  assert.ok(compiled);
  assert.equal(compiled.sourceContextId, "monthly-budget-proposal:2026-07");
  assert.equal(compiled.proposal.proposalType, "monthly_budget_proposal");
  assert.equal(compiled.proposal.targetKind, "monthly_budget");
  assert.equal(compiled.plan.month, "2026-07");
  assert.equal(compiled.plan.categories[0]?.label, "Dining");
  assert.equal(compiled.plan.categories[0]?.amount, 575);
  assert.equal(compiled.plan.totalAmount, 875);
  const patch = jsonObject(compiled.proposal.proposedPatch);
  const evidence = jsonObject(compiled.proposal.evidence);
  assert.equal(patch.action, "review_monthly_budget_proposal");
  assert.equal(patch.directFinanceWritesAllowed, false);
  assert.equal(evidence.directFinanceWritesAllowed, false);
  assert.deepEqual(evidence.calendarPressure, {
    categories: ["dining", "lodging", "travel"],
    level: "high"
  });
  assert.deepEqual(evidence.uncertaintyNotes, [
    "2 open reviews could shift category budgets",
    "reviewed totals separate trusted spend from unresolved review impact",
    "$120 outstanding reimbursements not treated as budget relief"
  ]);
  assert.doesNotMatch(JSON.stringify(compiled.proposal), /Seattle|Dinner reservation|Flight|Hotel|SFO|user_id/i);
});

test("monthly budget proposal skips empty guardrails", () => {
  const compiled = buildMonthlyBudgetProposal({
    budgetGuardrails: guardrails({ items: [] }),
    calendarContext: buildUpcomingCalendarContext([], { generatedAt, now: new Date(generatedAt) }),
    generatedAt,
    weeklyPlanningContext: weeklyContext()
  });

  assert.equal(compiled, null);
});
