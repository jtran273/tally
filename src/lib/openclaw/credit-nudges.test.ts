import assert from "node:assert/strict";
import test from "node:test";
import type {
  LiabilitiesDueSummary,
  LiabilityAccountSummary,
  LiabilityTargetPaymentAction,
  LiabilityTargetPaymentPlan
} from "@/lib/finance/liabilities";
import { buildCreditOptimizationPackets } from "./credit-nudges";

const BASE_DATE = "2026-06-04";

function makeRow(overrides: Partial<LiabilityAccountSummary>): LiabilityAccountSummary {
  return {
    accountId: "acct-1",
    name: "Chase Sapphire",
    mask: "1234",
    institutionName: "Chase",
    amountOwed: 1500,
    creditLimit: 5000,
    utilizationPercent: 30,
    lastPaymentDate: null,
    lastPaymentAmount: null,
    estimatedDueDate: null,
    daysUntilDue: null,
    status: "current",
    lastStatementIssueDate: null,
    lastStatementBalance: null,
    minimumPaymentAmount: null,
    dueDateIsActual: false,
    reportingDate: "2026-06-18",
    reportingDateSource: "actual_plaid_liability",
    reportingDateConfidence: "high",
    actionRank: 0,
    ...overrides
  };
}

function makeAction(overrides: Partial<LiabilityTargetPaymentAction>): LiabilityTargetPaymentAction {
  return {
    accountId: "acct-1",
    amountOwed: 1500,
    amountToTarget: 0,
    cashShortfall: 0,
    creditLimit: 5000,
    currentUtilizationPercent: 30,
    dateConfidence: "high",
    dateSource: "actual_plaid_liability",
    payByDate: "2026-06-15",
    projectedUtilizationPercent: 0,
    reason: "reported_balance_optimization",
    recommendedPayment: 0,
    reportingDate: "2026-06-18",
    targetUtilizationPercent: 30,
    ...overrides
  };
}

function makeSummary(rows: LiabilityAccountSummary[], target30Actions: LiabilityTargetPaymentAction[]): LiabilitiesDueSummary {
  const plan30: LiabilityTargetPaymentPlan = {
    actions: target30Actions,
    aggregateUtilizationPercent: 30,
    allocatableCash: 5000,
    cashAvailable: 5000,
    cashBuffer: 0,
    highestIndividualUtilizationPercent: 30,
    remainingAllocatableCash: 0,
    targetUtilizationPercent: 30
  };
  const plan10: LiabilityTargetPaymentPlan = { ...plan30, actions: [], targetUtilizationPercent: 10 };
  return {
    asOfDate: BASE_DATE,
    rows,
    totalOwed: rows.reduce((sum, row) => sum + row.amountOwed, 0),
    cashAvailable: 5000,
    aggregateUtilizationPercent: 30,
    coverageDelta: 0,
    hasOverdue: rows.some((row) => row.status === "overdue"),
    hasDueSoon: rows.some((row) => row.status === "due-soon"),
    highestIndividualUtilizationPercent: 30,
    targetPaymentPlans: [plan30, plan10]
  };
}

test("emits due-date risk packet when status is overdue and no recent payment", () => {
  const row = makeRow({
    accountId: "acct-1",
    amountOwed: 600,
    status: "overdue",
    estimatedDueDate: "2026-05-30",
    daysUntilDue: -5,
    dueDateIsActual: true,
    minimumPaymentAmount: 35,
    lastPaymentDate: null
  });
  const packets = buildCreditOptimizationPackets(makeSummary([row], []));
  assert.equal(packets.length, 1);
  assert.equal(packets[0]?.trigger, "due_date_risk");
  assert.equal(packets[0]?.priority, "high");
  assert.equal(packets[0]?.amount, 35);
  assert.match(packets[0]?.rationale ?? "", /past due/);
  assert.match(packets[0]?.id ?? "", /^openclaw-outbox:credit:due-risk:/);
});

test("skips due-date risk when a likely payment landed recently", () => {
  const row = makeRow({
    amountOwed: 600,
    status: "due-soon",
    estimatedDueDate: "2026-06-08",
    daysUntilDue: 4,
    dueDateIsActual: true,
    lastPaymentDate: "2026-05-30"
  });
  const packets = buildCreditOptimizationPackets(makeSummary([row], []));
  assert.equal(packets.length, 0);
});

test("emits cycle-close high-utilization packet when reporting is within 14 days and cash-safe payment exists", () => {
  const row = makeRow({
    amountOwed: 3000,
    utilizationPercent: 60,
    reportingDate: "2026-06-12",
    reportingDateSource: "actual_plaid_liability",
    reportingDateConfidence: "high"
  });
  const action = makeAction({
    amountToTarget: 1501,
    cashShortfall: 0,
    recommendedPayment: 1501,
    currentUtilizationPercent: 60,
    payByDate: "2026-06-09"
  });
  const packets = buildCreditOptimizationPackets(makeSummary([row], [action]));
  assert.equal(packets.length, 1);
  assert.equal(packets[0]?.trigger, "cycle_close_high_utilization");
  assert.equal(packets[0]?.priority, "high");
  assert.equal(packets[0]?.targetUtilizationPercent, 30);
});

test("skips cycle-close packet when reporting date is too far out (high-util still drops to cash-safe normal)", () => {
  const row = makeRow({
    amountOwed: 3000,
    utilizationPercent: 60,
    reportingDate: "2026-08-01"
  });
  const action = makeAction({
    amountToTarget: 1501,
    cashShortfall: 0,
    recommendedPayment: 1501,
    currentUtilizationPercent: 60,
    reportingDate: "2026-08-01",
    payByDate: "2026-07-29"
  });
  const packets = buildCreditOptimizationPackets(makeSummary([row], [action]));
  assert.equal(packets.length, 1);
  assert.equal(packets[0]?.trigger, "cash_safe_under_target");
  assert.equal(packets[0]?.priority, "normal");
});

test("skips when reporting confidence is unknown", () => {
  const row = makeRow({
    amountOwed: 3000,
    utilizationPercent: 60,
    reportingDate: null,
    reportingDateConfidence: "unknown",
    reportingDateSource: "unknown"
  });
  const packets = buildCreditOptimizationPackets(makeSummary([row], []));
  assert.equal(packets.length, 0);
});

test("skips when cash-safe payment is not possible", () => {
  const row = makeRow({
    amountOwed: 3000,
    utilizationPercent: 60,
    reportingDate: "2026-06-10"
  });
  const action = makeAction({
    amountToTarget: 1501,
    cashShortfall: 1501,
    recommendedPayment: 0,
    currentUtilizationPercent: 60
  });
  const packets = buildCreditOptimizationPackets(makeSummary([row], [action]));
  assert.equal(packets.length, 0);
});

test("emits at most one non-critical credit nudge per poll", () => {
  const rowA = makeRow({
    accountId: "acct-A",
    name: "Card A",
    mask: "1111",
    amountOwed: 3000,
    utilizationPercent: 60,
    reportingDate: "2026-06-12"
  });
  const rowB = makeRow({
    accountId: "acct-B",
    name: "Card B",
    mask: "2222",
    amountOwed: 2000,
    utilizationPercent: 55,
    reportingDate: "2026-06-15"
  });
  const actionA = makeAction({
    accountId: "acct-A",
    amountToTarget: 1500,
    cashShortfall: 0,
    recommendedPayment: 1500,
    currentUtilizationPercent: 60,
    payByDate: "2026-06-09"
  });
  const actionB = makeAction({
    accountId: "acct-B",
    amountToTarget: 1400,
    cashShortfall: 0,
    recommendedPayment: 1400,
    currentUtilizationPercent: 55,
    payByDate: "2026-06-12"
  });
  const packets = buildCreditOptimizationPackets(makeSummary([rowA, rowB], [actionA, actionB]));
  const nonCritical = packets.filter((p) => p.trigger !== "due_date_risk");
  assert.equal(nonCritical.length, 1);
  assert.equal(nonCritical[0]?.accountDisplayName.startsWith("Card A"), true);
});

test("critical due-date packets emit alongside the throttled non-critical nudge", () => {
  const overdueRow = makeRow({
    accountId: "acct-critical",
    name: "Card C",
    mask: "3333",
    amountOwed: 800,
    status: "overdue",
    estimatedDueDate: "2026-05-30",
    daysUntilDue: -5,
    dueDateIsActual: true,
    minimumPaymentAmount: 40
  });
  const cycleRow = makeRow({
    accountId: "acct-cycle",
    name: "Card D",
    mask: "4444",
    amountOwed: 3000,
    utilizationPercent: 60,
    reportingDate: "2026-06-10"
  });
  const cycleAction = makeAction({
    accountId: "acct-cycle",
    amountToTarget: 1500,
    cashShortfall: 0,
    recommendedPayment: 1500,
    currentUtilizationPercent: 60,
    payByDate: "2026-06-07"
  });
  const packets = buildCreditOptimizationPackets(makeSummary([overdueRow, cycleRow], [cycleAction]));
  assert.equal(packets.length, 2);
  assert.equal(packets[0]?.trigger, "due_date_risk");
  assert.equal(packets[1]?.trigger, "cycle_close_high_utilization");
});

test("dedupe id is stable for the same trigger inputs", () => {
  const row = makeRow({
    accountId: "acct-1",
    amountOwed: 3000,
    utilizationPercent: 60,
    reportingDate: "2026-06-10"
  });
  const action = makeAction({
    amountToTarget: 1500,
    cashShortfall: 0,
    recommendedPayment: 1500,
    currentUtilizationPercent: 60,
    payByDate: "2026-06-07"
  });
  const first = buildCreditOptimizationPackets(makeSummary([row], [action]));
  const second = buildCreditOptimizationPackets(makeSummary([row], [action]));
  assert.equal(first[0]?.id, second[0]?.id);
});

test("packet does not include raw plaid ids, masks-as-keys, or account number fields", () => {
  const row = makeRow({
    accountId: "acct-1",
    amountOwed: 3000,
    utilizationPercent: 60,
    reportingDate: "2026-06-10"
  });
  const action = makeAction({
    amountToTarget: 1500,
    cashShortfall: 0,
    recommendedPayment: 1500,
    currentUtilizationPercent: 60
  });
  const packets = buildCreditOptimizationPackets(makeSummary([row], [action]));
  const serialized = JSON.stringify(packets);
  assert.doesNotMatch(serialized, /access_token|plaid_account_id|account_number|routing_number/i);
});

test("emits cash-safe sub-target packet for moderately high utilization", () => {
  const row = makeRow({
    amountOwed: 1800,
    utilizationPercent: 36,
    reportingDate: "2026-07-15"
  });
  const action = makeAction({
    amountToTarget: 301,
    cashShortfall: 0,
    recommendedPayment: 301,
    currentUtilizationPercent: 36,
    reportingDate: "2026-07-15",
    payByDate: "2026-07-12"
  });
  const packets = buildCreditOptimizationPackets(makeSummary([row], [action]));
  assert.equal(packets.length, 1);
  assert.equal(packets[0]?.trigger, "cash_safe_under_target");
  assert.equal(packets[0]?.priority, "normal");
});
