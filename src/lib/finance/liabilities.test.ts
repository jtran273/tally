import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord, TransactionRecord } from "@/lib/db";
import { buildLiabilitiesDueSummary, cardNeedsReconnectForDueDates, computeTargetPayments, reportedBalanceActionReason } from "./liabilities";

const userId = "user-1";

function account(input: {
  id: string;
  type: AccountRecord["type"];
  balance: number;
  creditLimit?: number | null;
  lastStatementIssueDate?: string | null;
  lastStatementBalance?: number | null;
  liabilityAprs?: AccountRecord["liabilityAprs"];
  liabilityIsOverdue?: boolean | null;
  liabilityLastPaymentAmount?: number | null;
  liabilityLastPaymentDate?: string | null;
  minimumPaymentAmount?: number | null;
  nextPaymentDueDate?: string | null;
}): AccountRecord {
  return {
    availableBalance: null,
    balance: input.balance,
    color: null,
    creditLimit: input.creditLimit ?? null,
    currency: "USD",
    id: input.id,
    institutionId: "institution-bank",
    institutionName: "Seed Bank",
    isActive: true,
    lastSyncedAt: null,
    lastStatementBalance: input.lastStatementBalance ?? null,
    lastStatementIssueDate: input.lastStatementIssueDate ?? null,
    liabilityAprs: input.liabilityAprs ?? [],
    liabilityIsOverdue: input.liabilityIsOverdue ?? null,
    liabilityLastPaymentAmount: input.liabilityLastPaymentAmount ?? null,
    liabilityLastPaymentDate: input.liabilityLastPaymentDate ?? null,
    minimumPaymentAmount: input.minimumPaymentAmount ?? null,
    mask: "1234",
    name: `${input.type === "credit" ? "Card" : "Checking"} ${input.id}`,
    nextPaymentDueDate: input.nextPaymentDueDate ?? null,
    officialName: null,
    plaidAccountId: `plaid-${input.id}`,
    subtype: input.type === "credit" ? "credit card" : "checking",
    type: input.type,
    userId
  };
}

function transaction(input: { id: string; accountId: string; amount: number; date: string }): TransactionRecord {
  return {
    accountId: input.accountId,
    accountMask: "1234",
    accountName: "Card",
    amount: input.amount,
    category: "Transfer",
    categoryId: null,
    confidence: 1,
    date: input.date,
    id: input.id,
    institutionName: "Seed Bank",
    intent: "transfer",
    merchant: "AUTOPAY PAYMENT",
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidName: null,
    plaidTransactionId: null,
    rawTransactionId: `raw-${input.id}`,
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId
  };
}

test("buildLiabilitiesDueSummary flags overdue cards and computes coverage", () => {
  const accounts: AccountRecord[] = [
    account({ id: "checking", type: "depository", balance: 1500 }),
    account({
      id: "card-a",
      type: "credit",
      balance: 600,
      creditLimit: 5000,
      nextPaymentDueDate: "2026-04-01"
    }),
    account({
      id: "card-b",
      type: "credit",
      balance: 1200,
      creditLimit: 3000,
      nextPaymentDueDate: "2026-05-15"
    })
  ];

  const transactions: TransactionRecord[] = [
    transaction({ id: "t1", accountId: "card-a", amount: 50, date: "2026-03-01" }),
    transaction({ id: "t2", accountId: "card-b", amount: 100, date: "2026-04-15" })
  ];

  const summary = buildLiabilitiesDueSummary({
    accounts,
    asOfDate: "2026-05-11",
    cashAvailable: 1500,
    transactions
  });

  assert.equal(summary.rows.length, 2);
  assert.equal(summary.totalOwed, 1800);
  assert.equal(summary.cashAvailable, 1500);
  assert.equal(summary.coverageDelta, -300);

  const cardA = summary.rows.find((row) => row.accountId === "card-a");
  assert.ok(cardA);
  assert.equal(cardA?.status, "overdue", "actual issuer due date should be overdue by May 11");
  assert.equal(cardA?.lastPaymentDate, "2026-03-01");
  assert.equal(cardA?.utilizationPercent, 12);
});

test("buildLiabilitiesDueSummary prefers Plaid card liability payment and APR data", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-a",
        type: "credit",
        balance: 800,
        creditLimit: 4000,
        liabilityAprs: [{
          aprPercentage: 24.99,
          aprType: "purchase_apr",
          balanceSubjectToApr: 800,
          interestChargeAmount: 12.5
        }],
        liabilityIsOverdue: true,
        liabilityLastPaymentAmount: 75,
        liabilityLastPaymentDate: "2026-05-20",
        nextPaymentDueDate: "2026-06-05"
      })
    ],
    asOfDate: "2026-06-08",
    cashAvailable: 1000,
    transactions: [transaction({ id: "old-payment", accountId: "card-a", amount: 50, date: "2026-05-01" })]
  });

  const row = summary.rows[0];
  assert.equal(row?.status, "overdue");
  assert.equal(row?.lastPaymentSource, "plaid_liability");
  assert.equal(row?.lastPaymentDate, "2026-05-20");
  assert.equal(row?.lastPaymentAmount, 75);
  assert.equal(row?.purchaseAprPercentage, 24.99);
  assert.equal(row?.highestAprPercentage, 24.99);
});

test("buildLiabilitiesDueSummary ranks best card action by due status cash coverage and utilization", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({ id: "checking", type: "depository", balance: 100 }),
      account({
        id: "covered-due",
        type: "credit",
        balance: 3000,
        creditLimit: 10000,
        minimumPaymentAmount: 50,
        nextPaymentDueDate: "2026-05-15"
      }),
      account({
        id: "uncovered-due",
        type: "credit",
        balance: 5000,
        creditLimit: 10000,
        minimumPaymentAmount: 500,
        nextPaymentDueDate: "2026-05-15"
      }),
      account({
        id: "high-util-current",
        type: "credit",
        balance: 900,
        creditLimit: 1000,
        minimumPaymentAmount: 25,
        nextPaymentDueDate: "2026-06-20"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 100,
    transactions: []
  });

  assert.deepEqual(
    summary.rows.map((row) => row.accountId),
    ["covered-due", "uncovered-due", "high-util-current"]
  );
  assert.equal(summary.rows[0]?.status, "due-soon");
  assert.ok((summary.rows[0]?.actionRank ?? 0) > (summary.rows[1]?.actionRank ?? 0));
  assert.ok((summary.rows[1]?.actionRank ?? 0) > (summary.rows[2]?.actionRank ?? 0));
});

test("buildLiabilitiesDueSummary returns empty when no credit accounts", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [account({ id: "checking", type: "depository", balance: 100 })],
    asOfDate: "2026-05-11",
    cashAvailable: 100,
    transactions: []
  });

  assert.equal(summary.rows.length, 0);
  assert.equal(summary.totalOwed, 0);
  assert.equal(summary.coverageDelta, 100);
});

test("buildLiabilitiesDueSummary marks current Plaid statement dates as actual reporting dates", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-actual",
        type: "credit",
        balance: 450,
        creditLimit: 2000,
        lastStatementIssueDate: "2026-05-11",
        lastStatementBalance: 430,
        nextPaymentDueDate: "2026-06-05"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: []
  });

  const row = summary.rows[0];
  assert.equal(row?.reportingDate, "2026-05-11");
  assert.equal(row?.reportingDateSource, "actual_plaid_liability");
  assert.equal(row?.reportingDateConfidence, "high");
  assert.equal(row?.lastStatementBalance, 430);
  assert.equal(row?.dueDateIsActual, true);
});

test("buildLiabilitiesDueSummary infers the next reporting date from a prior statement cycle", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-cycle",
        type: "credit",
        balance: 900,
        creditLimit: 3000,
        lastStatementIssueDate: "2026-04-15",
        nextPaymentDueDate: "2026-05-10"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: []
  });

  const row = summary.rows[0];
  assert.equal(row?.reportingDate, "2026-05-15");
  assert.equal(row?.reportingDateSource, "inferred_from_statement_cycle");
  assert.equal(row?.reportingDateConfidence, "medium");
  assert.equal(row?.status, "overdue", "due-date safety should still use the actual due date");
});

test("buildLiabilitiesDueSummary preserves the statement day-of-month across a 31-day month", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-21st",
        type: "credit",
        balance: 2525,
        creditLimit: 19500,
        lastStatementIssueDate: "2026-05-21",
        nextPaymentDueDate: "2026-06-18"
      })
    ],
    asOfDate: "2026-06-09",
    cashAvailable: 5000,
    transactions: []
  });

  const row = summary.rows[0];
  // Statement closes on the 21st. May has 31 days, so a flat +30-day roll would
  // wrongly land on June 20; the next cycle actually closes June 21.
  assert.equal(row?.reportingDate, "2026-06-21");
  assert.equal(row?.reportingDateSource, "inferred_from_statement_cycle");
  assert.equal(row?.reportingDateConfidence, "medium");
});

test("buildLiabilitiesDueSummary falls back to a weaker reporting estimate from the due date", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-due-date",
        type: "credit",
        balance: 300,
        creditLimit: 1200,
        nextPaymentDueDate: "2026-05-26"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: []
  });

  const row = summary.rows[0];
  assert.equal(row?.estimatedDueDate, "2026-05-26");
  assert.equal(row?.reportingDate, "2026-05-31");
  assert.equal(row?.reportingDateSource, "estimated_from_due_date");
  assert.equal(row?.reportingDateConfidence, "low");
});

test("buildLiabilitiesDueSummary preserves actual issuer due dates from Plaid liabilities", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "amex-blue-cash",
        type: "credit",
        balance: 440.35,
        creditLimit: 6000,
        minimumPaymentAmount: 40,
        nextPaymentDueDate: "2026-06-20"
      }),
      account({
        id: "chase-sapphire",
        type: "credit",
        balance: 2925.74,
        creditLimit: 15000,
        minimumPaymentAmount: 40,
        nextPaymentDueDate: "2026-06-18"
      })
    ],
    asOfDate: "2026-06-05",
    cashAvailable: 5000,
    transactions: []
  });

  const amex = summary.rows.find((row) => row.accountId === "amex-blue-cash");
  const chase = summary.rows.find((row) => row.accountId === "chase-sapphire");

  assert.equal(amex?.estimatedDueDate, "2026-06-20");
  assert.equal(amex?.dueDateIsActual, true);
  assert.equal(amex?.minimumPaymentAmount, 40);
  assert.equal(chase?.estimatedDueDate, "2026-06-18");
  assert.equal(chase?.dueDateIsActual, true);
  assert.equal(chase?.minimumPaymentAmount, 40);
});

test("buildLiabilitiesDueSummary advances stale due-date reporting estimates", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-stale-due-date",
        type: "credit",
        balance: 300,
        creditLimit: 1200,
        nextPaymentDueDate: "2026-05-01"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: []
  });

  const row = summary.rows[0];
  assert.equal(row?.estimatedDueDate, "2026-05-01");
  assert.equal(row?.reportingDate, "2026-06-06");
  assert.equal(row?.reportingDateSource, "estimated_from_due_date");
  assert.equal(row?.reportingDateConfidence, "low");
  assert.equal(row?.status, "overdue", "due-date safety should still use the stale due date");
});

test("buildLiabilitiesDueSummary leaves due dates unknown when Plaid liabilities are unavailable", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "card-unknown",
        type: "credit",
        balance: 200,
        creditLimit: 1000
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: [transaction({ id: "payment", accountId: "card-unknown", amount: 25, date: "2026-05-01" })]
  });

  const row = summary.rows[0];
  assert.equal(row?.estimatedDueDate, null);
  assert.equal(row?.daysUntilDue, null);
  assert.equal(row?.dueDateIsActual, false);
  assert.equal(row?.reportingDate, null);
  assert.equal(row?.reportingDateSource, "unknown");
  assert.equal(row?.reportingDateConfidence, "unknown");
  assert.equal(row?.status, "current");
});

test("computeTargetPayments flags high card utilization even when aggregate utilization is low", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "high-card",
        type: "credit",
        balance: 900,
        creditLimit: 1000,
        lastStatementIssueDate: "2026-05-05",
        nextPaymentDueDate: "2026-06-01"
      }),
      account({
        id: "low-card",
        type: "credit",
        balance: 100,
        creditLimit: 9000,
        lastStatementIssueDate: "2026-05-05",
        nextPaymentDueDate: "2026-06-01"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: []
  });

  const target30 = summary.targetPaymentPlans.find((plan) => plan.targetUtilizationPercent === 30);
  const target10 = summary.targetPaymentPlans.find((plan) => plan.targetUtilizationPercent === 10);

  assert.equal(summary.aggregateUtilizationPercent, 10);
  assert.equal(summary.highestIndividualUtilizationPercent, 90);
  assert.equal(target30?.actions[0]?.accountId, "high-card");
  assert.equal(target30?.actions[0]?.amountToTarget, 600.01);
  assert.equal(target30?.actions[0]?.projectedUtilizationPercent, 30);
  assert.equal(target10?.actions[0]?.amountToTarget, 800.01);
});

test("computeTargetPayments skips cards without reliable credit limits or reporting dates", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "missing-limit",
        type: "credit",
        balance: 800,
        lastStatementIssueDate: "2026-05-05",
        nextPaymentDueDate: "2026-06-01"
      }),
      account({
        id: "missing-date",
        type: "credit",
        balance: 900,
        creditLimit: 1000
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: []
  });

  const target30 = summary.targetPaymentPlans.find((plan) => plan.targetUtilizationPercent === 30);
  assert.equal(target30?.actions.length, 0);
  assert.equal(summary.aggregateUtilizationPercent, 90);
  assert.equal(summary.highestIndividualUtilizationPercent, 90);
});

test("computeTargetPayments respects available cash after a cash buffer", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "first-card",
        type: "credit",
        balance: 900,
        creditLimit: 1000,
        lastStatementIssueDate: "2026-05-05",
        nextPaymentDueDate: "2026-06-01"
      }),
      account({
        id: "second-card",
        type: "credit",
        balance: 700,
        creditLimit: 1000,
        lastStatementIssueDate: "2026-05-07",
        nextPaymentDueDate: "2026-06-03"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 500,
    cashBuffer: 100,
    transactions: []
  });

  const target30 = summary.targetPaymentPlans.find((plan) => plan.targetUtilizationPercent === 30);
  assert.equal(target30?.allocatableCash, 400);
  assert.equal(target30?.actions[0]?.accountId, "first-card");
  assert.equal(target30?.actions[0]?.amountToTarget, 600.01);
  assert.equal(target30?.actions[0]?.recommendedPayment, 400);
  assert.equal(target30?.actions[0]?.cashShortfall, 200.01);
  assert.equal(target30?.actions[1]?.recommendedPayment, 0);
});

test("computeTargetPayments derives conservative pay-by dates from reporting timing", () => {
  const summary = buildLiabilitiesDueSummary({
    accounts: [
      account({
        id: "statement-card",
        type: "credit",
        balance: 900,
        creditLimit: 1000,
        lastStatementIssueDate: "2026-05-05",
        nextPaymentDueDate: "2026-06-01"
      })
    ],
    asOfDate: "2026-05-11",
    cashAvailable: 1000,
    transactions: []
  });
  const row = summary.rows[0];
  assert.ok(row);

  const plan = computeTargetPayments({
    asOfDate: summary.asOfDate,
    cashAvailable: summary.cashAvailable,
    processingBufferDays: 3,
    rows: [row],
    utilizationTarget: 30
  });

  // Statement closed on the 5th, so the next cycle closes June 5 (day-of-month
  // preserved), not June 4 as a flat 30-day roll would estimate.
  assert.equal(row.reportingDate, "2026-06-05");
  assert.equal(plan.actions[0]?.payByDate, "2026-06-02");
  assert.equal(plan.actions[0]?.dateSource, "inferred_from_statement_cycle");
  assert.equal(plan.actions[0]?.dateConfidence, "medium");
});

test("reported balance optimizer copy stays conservative and avoids exact score promises", () => {
  const copy = reportedBalanceActionReason({
    dateConfidence: "medium",
    targetUtilizationPercent: 30
  });

  assert.match(copy, /may help/i);
  assert.match(copy, /likely reported balance/i);
  assert.match(copy, /no score outcome is promised/i);
  assert.doesNotMatch(copy, /guarantee|boost your score|raise your score|improve your score/i);
});

test("cardNeedsReconnectForDueDates flags balance-carrying cards with no liability fields", () => {
  assert.equal(
    cardNeedsReconnectForDueDates({
      amountOwed: 500,
      dueDateIsActual: false,
      lastStatementIssueDate: null,
      minimumPaymentAmount: null
    }),
    true
  );
});

test("cardNeedsReconnectForDueDates does not flag paid-off cards", () => {
  assert.equal(
    cardNeedsReconnectForDueDates({
      amountOwed: 0,
      dueDateIsActual: false,
      lastStatementIssueDate: null,
      minimumPaymentAmount: null
    }),
    false
  );
});

test("cardNeedsReconnectForDueDates does not flag cards that already have liability data", () => {
  assert.equal(
    cardNeedsReconnectForDueDates({
      amountOwed: 500,
      dueDateIsActual: true,
      lastStatementIssueDate: null,
      minimumPaymentAmount: null
    }),
    false
  );
  assert.equal(
    cardNeedsReconnectForDueDates({
      amountOwed: 500,
      dueDateIsActual: false,
      lastStatementIssueDate: "2026-05-20",
      minimumPaymentAmount: null
    }),
    false
  );
  assert.equal(
    cardNeedsReconnectForDueDates({
      amountOwed: 500,
      dueDateIsActual: false,
      lastStatementIssueDate: null,
      minimumPaymentAmount: 35
    }),
    false
  );
});

test("buildLiabilitiesDueSummary sets needsReconnectForDueDates per card", () => {
  const accounts: AccountRecord[] = [
    account({ id: "checking", type: "depository", balance: 1000 }),
    account({ id: "no-liab", type: "credit", balance: 800, creditLimit: 4000 }),
    account({
      id: "has-due",
      type: "credit",
      balance: 800,
      creditLimit: 4000,
      nextPaymentDueDate: "2026-07-01"
    }),
    account({ id: "paid", type: "credit", balance: 0, creditLimit: 4000 })
  ];

  const summary = buildLiabilitiesDueSummary({
    accounts,
    asOfDate: "2026-06-04",
    cashAvailable: 5000,
    transactions: []
  });

  const byId = new Map(summary.rows.map((row) => [row.accountId, row]));
  assert.equal(byId.get("no-liab")?.needsReconnectForDueDates, true);
  assert.equal(byId.get("has-due")?.needsReconnectForDueDates, false);
  assert.equal(byId.get("paid")?.needsReconnectForDueDates, false);
});
