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

export const recurringDetectionPayloadAssertions = assertRecurringPayloadFixtures(
  recurringDetectionConfirmPayload,
  recurringDetectionDismissPayload
);

export const recurringDismissedCandidateFixture = detectRecurringCandidates(recurringDetectionFixture, {
  asOfDate: "2026-05-16",
  existingRecurring: [
    ...existingRecurringFixture,
    {
      id: "rec-dismissed-substack",
      merchant: "Substack",
      amount: 8,
      cadence: "monthly",
      accountId: "account-1",
      categoryId: "category-software",
      lastChargeDate: "2026-05-06",
      lastAmount: 8,
      status: "dismissed",
      isNew: false,
      confidence: 0.91
    }
  ]
});

export const recurringDismissedCandidateAssertions = assertDismissedCandidateFixture(
  recurringDismissedCandidateFixture
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

function assertRecurringPayloadFixtures(
  confirmPayload: typeof recurringDetectionConfirmPayload,
  dismissPayload: typeof recurringDetectionDismissPayload
): true {
  if (
    confirmPayload.action !== "confirm-recurring" ||
    confirmPayload.recurringExpense.values.merchant_name !== "Substack" ||
    confirmPayload.recurringExpense.values.status !== "active" ||
    confirmPayload.recurringExpense.values.is_new !== false
  ) {
    throw new Error("Expected confirm recurring payload to upsert an active, no-longer-new recurring expense.");
  }

  if (confirmPayload.recurringExpense.conflictColumns.join(",") !== "user_id,merchant_name,cadence") {
    throw new Error("Expected confirm recurring payload to use the stable recurring expense conflict key.");
  }

  if (
    confirmPayload.transactionUpdates.length === 0 ||
    confirmPayload.transactionUpdates.some((update) =>
      update.patch.isRecurring !== true ||
      update.patch.reviewedAt !== "2026-05-16T12:00:00.000Z"
    )
  ) {
    throw new Error("Expected confirm recurring payload to mark candidate transactions recurring and reviewed.");
  }

  if (
    confirmPayload.reviewResolutions.length !== 1 ||
    confirmPayload.reviewResolutions[0]?.reviewItemId !== "review-substack" ||
    confirmPayload.reviewResolutions[0]?.status !== "resolved"
  ) {
    throw new Error("Expected confirm recurring payload to resolve only open recurring review items.");
  }

  if (
    dismissPayload.action !== "dismiss-recurring" ||
    dismissPayload.transactionUpdates.length === 0 ||
    dismissPayload.transactionUpdates.some((update) =>
      update.patch.isRecurring !== false ||
      update.patch.reviewedAt !== "2026-05-16T12:00:00.000Z"
    )
  ) {
    throw new Error("Expected dismiss recurring payload to mark new candidate transactions non-recurring.");
  }

  if (
    dismissPayload.reviewResolutions.length !== 1 ||
    dismissPayload.reviewResolutions[0]?.reviewItemId !== "review-substack" ||
    dismissPayload.reviewResolutions[0]?.status !== "dismissed"
  ) {
    throw new Error("Expected dismiss recurring payload to dismiss only open recurring review items.");
  }

  if (dismissPayload.recurringExpenseUpdate) {
    throw new Error("Expected dismiss payload for a new unmatched candidate not to update an existing recurring row.");
  }

  if (dismissPayload.recurringExpense?.values.status !== "dismissed") {
    throw new Error("Expected dismiss payload for a new unmatched candidate to persist a dismissed recurring row.");
  }

  return true;
}

function assertDismissedCandidateFixture(candidates: readonly RecurringCandidate[]): true {
  if (candidates.some((candidate) => candidate.merchant === "Substack")) {
    throw new Error("Expected dismissed recurring rows to suppress matching detected candidates.");
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
