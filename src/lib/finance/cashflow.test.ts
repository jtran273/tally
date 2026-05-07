import type { AccountRecord, RecurringExpenseRecord, TransactionRecord } from "@/lib/db";
import type { RecurringCandidate } from "@/lib/recurring";
import {
  buildMonthlyCashflowRunwaySummary,
  monthlyRecurringEquivalent
} from "./cashflow";

const userId = "11111111-1111-1111-1111-111111111111";

function account(input: Partial<AccountRecord> = {}): AccountRecord {
  return {
    availableBalance: null,
    balance: 1200,
    color: null,
    creditLimit: null,
    currency: "USD",
    id: "account-checking",
    institutionId: "institution-1",
    institutionName: "Seed Bank",
    isActive: true,
    lastSyncedAt: "2026-05-07T12:00:00.000Z",
    mask: "1111",
    name: "Checking",
    officialName: null,
    plaidAccountId: "plaid-account-checking",
    subtype: "checking",
    type: "depository",
    userId,
    ...input
  };
}

function transaction(
  input: Pick<TransactionRecord, "amount" | "date" | "id" | "merchant"> & Partial<TransactionRecord>
): TransactionRecord {
  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Checking",
    category: "Food",
    categoryId: "category-food",
    confidence: 0.94,
    institutionName: "Seed Bank",
    intent: "personal",
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidName: null,
    plaidTransactionId: null,
    rawTransactionId: `raw-${input.id}`,
    recurring: false,
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId,
    ...input
  };
}

function recurring(input: Partial<RecurringExpenseRecord> = {}): RecurringExpenseRecord {
  return {
    accountId: "account-checking",
    accountName: "Checking",
    amount: 100,
    cadence: "monthly",
    category: "Software",
    categoryId: "category-software",
    confidence: 0.95,
    id: "recurring-1",
    isNew: false,
    lastAmount: 100,
    lastChargeDate: "2026-05-01",
    merchant: "Cloud App",
    nextDueDate: "2026-06-01",
    status: "active",
    ...input
  };
}

function candidate(input: Partial<RecurringCandidate> = {}): RecurringCandidate {
  return {
    accountId: "account-checking",
    amount: 8,
    amountEvidence: {
      averageAmount: 8,
      baselineAmount: 8,
      maxAmount: 8,
      minAmount: 8,
      score: 0.96,
      toleranceAmount: 2
    },
    cadence: "monthly",
    cadenceEvidence: {
      averageIntervalDays: 30,
      intervalDays: [30, 31],
      matchingIntervals: 2,
      score: 0.95,
      totalIntervals: 2
    },
    category: "Media",
    categoryId: "category-media",
    confidence: 0.92,
    existingRecurringId: null,
    firstChargeDate: "2026-03-06",
    flags: [],
    id: "candidate-substack",
    isNew: true,
    lastAmount: 8,
    lastChargeDate: "2026-05-06",
    lastTransactionId: "tx-substack-3",
    merchant: "Substack",
    nextDueDate: "2026-06-06",
    normalizedMerchant: "substack",
    occurrenceCount: 3,
    priceChange: null,
    transactions: [],
    userId,
    ...input
  };
}

export const monthlyCashflowRunwayAssertions = assertMonthlyCashflowRunway();

function assertMonthlyCashflowRunway(): true {
  if (monthlyRecurringEquivalent(12, "weekly") !== 52) {
    throw new Error("Expected weekly recurring charges to be normalized into monthly load.");
  }

  const summary = buildMonthlyCashflowRunwaySummary({
    accounts: [
      account({ id: "fresh", lastSyncedAt: "2026-05-07T12:00:00.000Z" }),
      account({ id: "stale", lastSyncedAt: "2026-05-05T12:00:00.000Z" })
    ],
    asOfDate: "2026-05-07",
    now: new Date("2026-05-07T20:00:00.000Z"),
    recurringCandidates: [
      candidate(),
      candidate({
        amount: 13.99,
        existingRecurringId: "rec-streaming",
        id: "candidate-streaming",
        isNew: false,
        merchant: "Streaming Co",
        priceChange: {
          changedAt: "2026-05-05",
          currentAmount: 13.99,
          deltaAmount: 3.99,
          deltaRatio: 0.4,
          previousAmount: 10,
          source: "known-recurring",
          transactionId: "tx-streaming-3"
        }
      })
    ],
    recurringExpenses: [
      recurring({ amount: 2400, cadence: "monthly", id: "rec-rent", merchant: "Rent" }),
      recurring({ amount: 120, cadence: "annual", id: "rec-domain", merchant: "Domain Renewal" }),
      recurring({ amount: 15, id: "rec-pending", merchant: "Figma", status: "pending" })
    ],
    transactions: [
      transaction({ amount: 5000, category: "Income", date: "2026-05-01", id: "tx-income", merchant: "Payroll" }),
      transaction({ amount: -120, date: "2026-05-03", id: "tx-groceries", merchant: "Market" }),
      transaction({ amount: -999, date: "2026-05-04", id: "tx-transfer", intent: "transfer", merchant: "Card Payment" }),
      transaction({ amount: -75, date: "2026-04-30", id: "tx-last-month", merchant: "Cafe" })
    ]
  });

  if (
    summary.currentMonth.income !== 5000 ||
    summary.currentMonth.spending !== 120 ||
    summary.currentMonth.netCashflow !== 4880
  ) {
    throw new Error("Expected monthly income, spending, and net cashflow to exclude transfers.");
  }

  if (summary.confirmedRecurringMonthlyLoad !== 2410 || summary.confirmedRecurringCount !== 2) {
    throw new Error("Expected only active recurring expenses to count as confirmed recurring monthly load.");
  }

  if (
    summary.pendingRecurringMonthlyLoad !== 23 ||
    summary.pendingRecurringCount !== 2 ||
    summary.pendingRecurringExpenseCount !== 1 ||
    summary.pendingRecurringCandidateCount !== 1
  ) {
    throw new Error("Expected pending recurring rows and detected candidates to stay separate from confirmed load.");
  }

  if (!summary.isPartialMonth || summary.monthElapsedDays !== 7 || summary.monthTotalDays !== 31) {
    throw new Error("Expected partial month metadata to describe the month-to-date window.");
  }

  if (summary.syncSummary.status !== "stale" || summary.syncSummary.staleCount !== 1) {
    throw new Error("Expected stale sync state to be carried with the cashflow summary.");
  }

  if (summary.priceChanges[0]?.merchant !== "Streaming Co" || summary.priceChanges[0]?.previousAmount !== 10) {
    throw new Error("Expected known recurring price changes to become actionable cashflow signals.");
  }

  return true;
}
