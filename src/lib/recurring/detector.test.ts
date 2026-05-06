import {
  buildConfirmRecurringPayload,
  buildDismissRecurringPayload,
  detectRecurringCandidates
} from ".";
import type {
  KnownRecurringExpense,
  RecurringCandidate,
  RecurringDetectionTransaction
} from ".";

const userId = "11111111-1111-1111-1111-111111111111";

function tx(
  id: string,
  merchant: string,
  date: string,
  amount: number,
  recurring = false
): RecurringDetectionTransaction {
  return {
    id,
    userId,
    accountId: "account-1",
    categoryId: "category-software",
    category: "Software / SaaS",
    date,
    merchant,
    amount,
    status: "posted",
    intent: "personal",
    recurring
  };
}

export const recurringDetectionFixture = [
  tx("weekly-1", "Coffee Club", "2026-04-01", -9.99),
  tx("weekly-2", "Coffee Club", "2026-04-08", -9.99),
  tx("weekly-3", "Coffee Club", "2026-04-15", -9.99),
  tx("monthly-1", "Substack", "2026-03-06", -8),
  {
    ...tx("monthly-2", "Substack", "2026-04-06", -8),
    reviewItems: [
      {
        id: "review-substack",
        reason: "new-recurring",
        status: "open"
      }
    ]
  },
  tx("monthly-3", "Substack", "2026-05-06", -8),
  tx("annual-1", "Domain Renewal", "2025-05-01", -120),
  tx("annual-2", "Domain Renewal", "2026-05-01", -120),
  tx("streaming-1", "Streaming Co", "2026-03-15", -10, true),
  tx("streaming-2", "Streaming Co", "2026-04-15", -10, true),
  tx("streaming-3", "Streaming Co", "2026-05-15", -13.99, true),
  tx("noise-1", "Grocery Mart", "2026-04-02", -82.14),
  tx("noise-2", "Grocery Mart", "2026-04-18", -43.22),
  tx("noise-3", "Grocery Mart", "2026-05-03", -96.71)
] satisfies readonly RecurringDetectionTransaction[];

export const existingRecurringFixture = [
  {
    id: "rec-streaming",
    merchant: "Streaming Co",
    amount: 10,
    cadence: "monthly",
    accountId: "account-1",
    categoryId: "category-software",
    lastChargeDate: "2026-04-15",
    lastAmount: 10,
    status: "active",
    isNew: false,
    confidence: 0.96
  }
] satisfies readonly KnownRecurringExpense[];

export const recurringDetectionStaticResult = detectRecurringCandidates(recurringDetectionFixture, {
  existingRecurring: existingRecurringFixture,
  asOfDate: "2026-05-16"
});

export const recurringDetectionStaticAssertions = assertRecurringDetectionFixture(recurringDetectionStaticResult);

export const recurringDetectionConfirmPayload = buildConfirmRecurringPayload(
  requireCandidate(recurringDetectionStaticResult, "Substack"),
  { reviewedAt: "2026-05-16T12:00:00.000Z" }
);

export const recurringDetectionDismissPayload = buildDismissRecurringPayload(
  requireCandidate(recurringDetectionStaticResult, "Substack"),
  { reviewedAt: "2026-05-16T12:00:00.000Z" }
);

function assertRecurringDetectionFixture(candidates: readonly RecurringCandidate[]): true {
  expectCandidate(candidates, "Coffee Club", "weekly", "new-recurring");
  expectCandidate(candidates, "Substack", "monthly", "new-recurring");
  expectCandidate(candidates, "Domain Renewal", "annual", "new-recurring");

  const streaming = requireCandidate(candidates, "Streaming Co");
  if (streaming.priceChange?.source !== "known-recurring") {
    throw new Error("Expected Streaming Co to flag a known-recurring price change.");
  }

  if (candidates.some((candidate) => candidate.merchant === "Grocery Mart")) {
    throw new Error("Expected grocery noise to be excluded from recurring candidates.");
  }

  return true;
}

function expectCandidate(
  candidates: readonly RecurringCandidate[],
  merchant: string,
  cadence: RecurringCandidate["cadence"],
  flagKind: RecurringCandidate["flags"][number]["kind"]
): void {
  const candidate = requireCandidate(candidates, merchant);
  if (candidate.cadence !== cadence || !candidate.flags.some((flag) => flag.kind === flagKind)) {
    throw new Error(`Expected ${merchant} to be a ${cadence} candidate with ${flagKind} flag.`);
  }
}

function requireCandidate(candidates: readonly RecurringCandidate[], merchant: string): RecurringCandidate {
  const candidate = candidates.find((item) => item.merchant === merchant);
  if (!candidate) throw new Error(`Expected recurring detection fixture to produce ${merchant}.`);
  return candidate;
}
