import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord } from "@/lib/db";
import type { LiabilitiesDueSummary, LiabilityAccountSummary } from "./liabilities";
import {
  assessRewardsBenefitsCapability,
  buildCreditHealthSummary,
  buildCreditScoreSummary,
  normalizeCreditScoreSnapshot
} from "./credit-health";

const BASE_DATE = "2026-06-05";

function row(overrides: Partial<LiabilityAccountSummary>): LiabilityAccountSummary {
  return {
    accountId: "card-1",
    actionRank: 0,
    amountOwed: 900,
    creditLimit: 1000,
    daysUntilDue: 15,
    dueDateIsActual: true,
    estimatedDueDate: "2026-06-20",
    institutionName: "Issuer",
    lastPaymentAmount: null,
    lastPaymentDate: null,
    lastStatementBalance: 800,
    lastStatementIssueDate: "2026-05-20",
    mask: "1234",
    minimumPaymentAmount: 35,
    name: "Everyday Card",
    needsReconnectForDueDates: false,
    reportingDate: "2026-06-19",
    reportingDateConfidence: "medium",
    reportingDateSource: "inferred_from_statement_cycle",
    status: "current",
    utilizationPercent: 90,
    ...overrides
  };
}

function summary(overrides: Partial<LiabilitiesDueSummary> = {}): LiabilitiesDueSummary {
  const rows = overrides.rows ?? [row({})];
  return {
    aggregateUtilizationPercent: 90,
    asOfDate: BASE_DATE,
    cashAvailable: 1000,
    coverageDelta: 100,
    hasDueSoon: false,
    hasOverdue: false,
    highestIndividualUtilizationPercent: 90,
    rows,
    targetPaymentPlans: [],
    totalOwed: 900,
    ...overrides
  };
}

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    availableBalance: null,
    balance: -250,
    color: null,
    creditLimit: 5000,
    currency: "USD",
    id: "account-1",
    institutionId: "institution-1",
    institutionName: "Issuer",
    isActive: true,
    lastSyncedAt: BASE_DATE,
    lastStatementBalance: 200,
    lastStatementIssueDate: "2026-05-20",
    mask: "1234",
    minimumPaymentAmount: 25,
    name: "Rewards Card",
    nextPaymentDueDate: "2026-06-20",
    officialName: null,
    plaidAccountId: "plaid-account-1",
    subtype: "credit card",
    type: "credit",
    userId: "user-1",
    ...overrides
  };
}

test("normalizes manual score snapshots and rejects out-of-range values", () => {
  const snapshot = normalizeCreditScoreSnapshot({
    asOfDate: "2026-06-01",
    createdAt: "2026-06-01T18:00:00.000Z",
    model: "fico",
    score: 721.4,
    source: "manual_issuer"
  });

  assert.equal(snapshot.score, 721);
  assert.equal(snapshot.confidence, "medium");
  assert.equal(snapshot.createdAt, "2026-06-01T18:00:00.000Z");
  assert.throws(
    () => normalizeCreditScoreSnapshot({
      asOfDate: "2026-06-01",
      model: "fico",
      score: 900,
      source: "manual_bureau"
    }),
    /between 300 and 850/
  );
  assert.throws(
    () => normalizeCreditScoreSnapshot({
      asOfDate: "2026-02-30",
      model: "fico",
      score: 720,
      source: "manual_bureau"
    }),
    /ISO date/
  );
  assert.throws(
    () => normalizeCreditScoreSnapshot({
      asOfDate: "06/01/2026",
      model: "fico",
      score: 720,
      source: "manual_bureau"
    }),
    /ISO date/
  );
});

test("buildCreditScoreSummary exposes manual trend and no live provider", () => {
  const score = buildCreditScoreSummary([
    { asOfDate: "2026-05-01", model: "fico", score: 700, source: "manual_bureau" },
    { asOfDate: "2026-06-01", model: "fico", score: 715, source: "manual_bureau" }
  ]);

  assert.equal(score.current?.score, 715);
  assert.equal(score.delta, 15);
  assert.equal(score.trend, "up");
  assert.equal(score.liveProvider, "none");
  assert.match(score.sourceCopy, /not connected to a live credit bureau score provider/i);
});

test("buildCreditScoreSummary treats latest same-day entry as current without same-day delta", () => {
  const score = buildCreditScoreSummary([
    {
      asOfDate: "2026-06-01",
      createdAt: "2026-06-01T16:00:00.000Z",
      model: "fico",
      score: 719,
      source: "manual_bureau"
    },
    {
      asOfDate: "2026-06-01",
      createdAt: "2026-06-01T18:00:00.000Z",
      model: "fico",
      score: 714,
      source: "manual_bureau"
    },
    {
      asOfDate: "2026-05-01",
      createdAt: "2026-05-01T18:00:00.000Z",
      model: "fico",
      score: 700,
      source: "manual_bureau"
    }
  ]);

  assert.equal(score.current?.score, 714);
  assert.equal(score.delta, 14);
  assert.equal(score.trend, "up");
});

test("buildCreditHealthSummary prioritizes payment safety and utilization guidance", () => {
  const health = buildCreditHealthSummary({
    liabilities: summary({
      hasDueSoon: true,
      rows: [row({ status: "due-soon", utilizationPercent: 55 })]
    })
  });

  assert.equal(health.score.current, null);
  assert.equal(health.score.liveProvider, "none");
  assert.match(health.guidance[0]?.title ?? "", /due-soon minimum/i);
  assert.match(health.guidance[1]?.title ?? "", /highest-utilization card/i);
  assert.equal(health.guidance[1]?.confidence, "high");
});

test("buildCreditHealthSummary labels missing utilization and reporting sources", () => {
  const health = buildCreditHealthSummary({
    liabilities: summary({
      aggregateUtilizationPercent: null,
      highestIndividualUtilizationPercent: null,
      rows: [
        row({
          creditLimit: null,
          reportingDate: null,
          reportingDateConfidence: "unknown",
          reportingDateSource: "unknown",
          utilizationPercent: null
        })
      ]
    })
  });

  assert.match(health.guidance[1]?.title ?? "", /credit limits/i);
  assert.equal(health.guidance[1]?.confidence, "none");
  assert.match(health.guidance[2]?.title ?? "", /unavailable/i);
  assert.equal(health.guidance[2]?.confidence, "low");
});

test("assessRewardsBenefitsCapability does not imply Plaid rewards or benefits are live", () => {
  const capability = assessRewardsBenefitsCapability([account()]);

  assert.equal(capability.liveDataStatus, "not_supported_by_current_plaid_integration");
  assert.equal(capability.confidence, "high");
  assert.ok(capability.supportedNow.some((line) => /transaction merchant\/category/i.test(line)));
  assert.ok(capability.unsupportedNow.some((line) => /points balance/i.test(line)));
  assert.ok(capability.unsupportedNow.some((line) => /production Plaid endpoint/i.test(line)));
});
