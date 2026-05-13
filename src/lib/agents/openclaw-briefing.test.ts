import assert from "node:assert/strict";
import test from "node:test";
import { buildUpcomingCalendarContext } from "@/lib/calendar";
import type { AgentProposalRecord } from "@/lib/db";
import {
  buildOpenClawBriefingProposal,
  resolveOpenClawBriefingCadence
} from "./openclaw-briefing";
import type { WeeklyPlanningContext } from "./weekly-planning-context";

const generatedAt = "2026-05-13T12:00:00.000Z";

function spendingWindow(input: Record<string, unknown> = {}) {
  return {
    fromDate: "2026-05-07",
    toDate: "2026-05-13",
    spending: 0,
    reimbursable: 0,
    reimbursementOutstanding: 0,
    trustedSpending: 0,
    unresolvedReviewSpending: 0,
    income: 0,
    netCashflow: 0,
    transactionCount: 0,
    openReviewTransactionCount: 0,
    topCategories: [],
    topMerchants: [],
    ...input
  };
}

function weeklyContext(input: {
  currentWeek?: Record<string, unknown>;
  previousWeek?: Record<string, unknown>;
  reviewOpenCount?: number;
} = {}): WeeklyPlanningContext {
  return {
    action: "read.weekly_planning_context",
    asOfDate: "2026-05-13",
    cashflow: {
      upcoming: {
        asOfDate: "2026-05-13",
        billTotal: 0,
        days: 30,
        dueSoonCount: 0,
        endDate: "2026-06-12",
        events: [],
        incomeTotal: 0,
        netTotal: 0,
        projectedCashBalance: null,
        startingCashBalance: null
      }
    },
    generatedAt,
    income: {
      currentWeekIncome: 0,
      previousWeekIncome: 0,
      upcomingProjectedIncome: 0
    },
    reimbursements: {
      expectedAmount: 0,
      outstandingAmount: 0,
      receivedAmount: 0,
      reimbursableAmount: 0,
      reimbursableCount: 0,
      reimbursedCount: 0
    },
    review: {
      action: "read.review_queue_summary",
      examples: [],
      generatedAt,
      openCount: input.reviewOpenCount ?? 0,
      reasonCounts: {},
      totalAbsoluteAmount: 0
    },
    spending: {
      currentWeek: spendingWindow(input.currentWeek),
      grouped: {
        action: "read.spending_summary",
        byCategory: [],
        byIntent: [],
        fromDate: "2026-05-07",
        generatedAt,
        openReviewCount: 0,
        reimbursementOutstanding: 0,
        reimbursableAmount: 0,
        reimbursedAmount: 0,
        toDate: "2026-05-13",
        totalSpending: 0,
        transactionCount: 0
      },
      previousWeek: spendingWindow({
        fromDate: "2026-04-30",
        toDate: "2026-05-06",
        ...input.previousWeek
      })
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
      fromDate: "2026-05-07",
      previousFromDate: "2026-04-30",
      previousToDate: "2026-05-06",
      toDate: "2026-05-13"
    }
  } as WeeklyPlanningContext;
}

function reimbursementProposal(input: Partial<AgentProposalRecord> = {}): AgentProposalRecord {
  return {
    acceptedAt: null,
    answeredAt: null,
    clarificationAnswer: null,
    clarificationAnswerKind: null,
    clarificationQuestion: "Was dinner reimbursable?",
    confidence: 0.82,
    createdAt: "2026-05-13T08:00:00.000Z",
    dismissedAt: null,
    evidence: {
      transaction: {
        amount: -125,
        date: "2026-05-12",
        merchant: "Dinner Guild"
      }
    },
    expiresAt: null,
    id: "proposal-reimbursement",
    proposalType: "reimbursement_candidate",
    proposedPatch: {
      suggestedInflowIds: ["tx-inflow"]
    },
    questionFingerprint: "reimbursement-candidate:tx-dinner:tx-inflow",
    sourceAgent: "ledger-reimbursement-candidate-detector",
    sourceCandidateId: null,
    sourceContextId: null,
    status: "pending",
    targetId: "tx-dinner",
    targetKind: "enriched_transaction",
    updatedAt: "2026-05-13T08:00:00.000Z",
    userId: "user-1",
    ...input
  };
}

test("OpenClaw briefing compiler handles an empty week", () => {
  const compiled = buildOpenClawBriefingProposal({
    calendarContext: buildUpcomingCalendarContext([], { generatedAt, now: new Date(generatedAt) }),
    generatedAt,
    reimbursementCandidates: [],
    weeklyPlanningContext: weeklyContext()
  });

  assert.equal(compiled.proposal.proposalType, "openclaw_briefing");
  assert.equal(compiled.proposal.targetKind, "openclaw_briefing");
  assert.equal(compiled.sourceContextId, "openclaw-briefing:weekly:2026-05-07:2026-05-13");
  assert.equal(compiled.briefing.financeMotion.spending.deltaAmount, 0);
  assert.equal(compiled.briefing.reimbursementCandidates.count, 0);
  assert.equal(compiled.briefing.calendarPressure.level, "none");
  assert.deepEqual(compiled.briefing.topCategories, []);
  assert.equal(compiled.briefing.suggestedQuestions.length, 1);
});

test("OpenClaw briefing compiler calculates week-over-week deltas and category motion", () => {
  const compiled = buildOpenClawBriefingProposal({
    calendarContext: buildUpcomingCalendarContext([
      {
        allDay: false,
        end: "2026-05-15T03:00:00.000Z",
        location: "Oakland, CA",
        start: "2026-05-15T01:00:00.000Z",
        title: "Dinner reservation"
      },
      {
        allDay: true,
        end: "2026-05-17",
        location: "SFO Airport",
        start: "2026-05-16",
        title: "Flight to Phoenix"
      }
    ], { generatedAt, now: new Date(generatedAt) }),
    generatedAt,
    reimbursementCandidates: [reimbursementProposal()],
    weeklyPlanningContext: weeklyContext({
      currentWeek: {
        income: 900,
        netCashflow: 750,
        reimbursable: 125,
        reimbursementOutstanding: 125,
        spending: 150,
        topCategories: [
          {
            amount: 120,
            count: 2,
            deltaAmount: 80,
            deltaPercent: 200,
            id: "category-food",
            label: "Food",
            openReviewCount: 1,
            previousAmount: 40,
            transactionIds: ["tx-dinner"],
            trustedAmount: 80,
            unresolvedReviewAmount: 40
          }
        ]
      },
      previousWeek: {
        income: 500,
        netCashflow: 400,
        reimbursable: 25,
        reimbursementOutstanding: 10,
        spending: 100
      },
      reviewOpenCount: 2
    })
  });

  assert.deepEqual(compiled.briefing.financeMotion.spending, {
    currentAmount: 150,
    deltaAmount: 50,
    deltaPercent: 50,
    previousAmount: 100
  });
  assert.deepEqual(compiled.briefing.financeMotion.reimbursementOutstanding, {
    currentAmount: 125,
    deltaAmount: 115,
    deltaPercent: 1150,
    previousAmount: 10
  });
  assert.equal(compiled.briefing.topCategories[0]?.category, "Food");
  assert.equal(compiled.briefing.topCategories[0]?.motion, "up");
  assert.equal(compiled.briefing.reimbursementCandidates.count, 1);
  assert.equal(compiled.briefing.reimbursementCandidates.top[0]?.suggestedInflowCount, 1);
  assert.equal(compiled.briefing.calendarPressure.level, "moderate");
  assert(compiled.briefing.suggestedQuestions.some((question) => question.includes("Food spending is up")));
});

test("OpenClaw briefing cadence defaults weekly and accepts daily", () => {
  assert.equal(resolveOpenClawBriefingCadence(undefined), "weekly");
  assert.equal(resolveOpenClawBriefingCadence("daily"), "daily");
  assert.throws(
    () => resolveOpenClawBriefingCadence("monthly"),
    /OPENCLAW_BRIEFING_CADENCE/
  );
});
