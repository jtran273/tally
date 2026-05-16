import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseTransactionFilters,
  transactionFiltersHref,
  transactionReviewReasonOptions
} from "@/components/finance/transactions/filters";
import type { ReviewItemRecord, ReviewReason, TransactionRecord } from "@/lib/db";
import { listReviewItems, listTransactions } from "@/lib/db";
import { createDemoFinanceClient, DEMO_USER_ID } from "@/lib/demo/finance-client";
import { buildTransactionsCsv } from "@/lib/export/transactions";
import {
  getReviewReasonCopy,
  isManualTransactionEditResolvableReview,
  isPeerToPeerReview,
  REVIEW_REASON_COPY,
  REVIEW_REASON_ORDER
} from "./reasons";

const expectedReviewReasons = [
  "venmo",
  "large",
  "transfer-pair",
  "new-recurring",
  "low-confidence",
  "missing-category",
  "unclear-transfer",
  "recurring-candidate"
] as const;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Condition extends true> = Condition;
type _ReviewReasonCoverage = Expect<Equal<ReviewReason, (typeof expectedReviewReasons)[number]>>;

const sorted = (values: readonly string[]) => [...values].sort();

const userId = "11111111-1111-1111-1111-111111111111";

function review(transactionId: string, reason: ReviewReason): ReviewItemRecord {
  return {
    aiSuggestion: {},
    confidence: 0.7,
    createdAt: "2026-05-06T12:00:00.000Z",
    explanation: `Fixture ${reason} review.`,
    id: `review-${reason}`,
    reason,
    resolutionNote: null,
    resolvedAt: null,
    status: "open",
    transactionId
  };
}

function transaction(reviewItems: ReviewItemRecord[]): TransactionRecord {
  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Everyday Checking",
    amount: -64.5,
    category: "Uncategorized",
    categoryId: null,
    confidence: 0.52,
    date: "2026-05-06",
    institutionName: "Seed Bank",
    intent: "personal",
    note: "",
    plaidCategory: "Service",
    plaidMerchant: "RAW MERCHANT",
    plaidName: "RAW PLAID NAME",
    plaidTransactionId: "plaid-review-reasons",
    rawTransactionId: "raw-review-reasons",
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems,
    reviewReason: reviewItems[0]?.reason ?? null,
    reviewStatus: reviewItems[0]?.status ?? null,
    splits: [],
    status: "posted",
    userId,
    id: "tx-review-reasons",
    merchant: "Review reason fixture"
  };
}

describe("review reason definitions", () => {
  it("keeps reason copy exhaustive and review-priority order explicit", () => {
    assert.deepEqual(REVIEW_REASON_ORDER, [
      "venmo",
      "missing-category",
      "low-confidence",
      "unclear-transfer",
      "transfer-pair",
      "large",
      "recurring-candidate",
      "new-recurring"
    ]);
    assert.deepEqual(sorted(Object.keys(REVIEW_REASON_COPY)), sorted(expectedReviewReasons));

    for (const reason of expectedReviewReasons) {
      const copy = getReviewReasonCopy(reason);

      assert.equal(copy, REVIEW_REASON_COPY[reason]);
      assert.notEqual(copy.label.trim(), "");
      assert.notEqual(copy.shortLabel.trim(), "");
      assert.notEqual(copy.description.trim(), "");
      assert.notEqual(copy.action.trim(), "");
      assert.equal(isPeerToPeerReview(reason), reason === "venmo");
    }
  });

  it("keeps manual transaction edits scoped to review items they can safely finalize", () => {
    assert.deepEqual(
      expectedReviewReasons.filter(isManualTransactionEditResolvableReview),
      ["large", "transfer-pair", "low-confidence", "missing-category", "unclear-transfer"]
    );
    assert.equal(isManualTransactionEditResolvableReview("venmo"), false);
    assert.equal(isManualTransactionEditResolvableReview("new-recurring"), false);
    assert.equal(isManualTransactionEditResolvableReview("recurring-candidate"), false);
  });

  it("keeps transaction filters and CSV export aligned with every review reason", () => {
    const filterReasons = transactionReviewReasonOptions
      .filter((option) => option.value !== "all")
      .map((option) => option.value);

    assert.equal(transactionReviewReasonOptions[0]?.value, "all");
    assert.deepEqual(sorted(filterReasons), sorted(expectedReviewReasons));

    for (const reason of expectedReviewReasons) {
      const filters = parseTransactionFilters({ reason });
      const exportHref = transactionFiltersHref("/api/export/transactions", filters);
      const exportParams = new URL(exportHref, "https://ledger.test").searchParams;

      assert.equal(filters.reviewReason, reason);
      assert.equal(exportParams.get("reason"), reason);
    }

    const reviewItems = expectedReviewReasons.map((reason) => review("tx-review-reasons", reason));
    const csv = buildTransactionsCsv([transaction(reviewItems)]);
    const [headers, values] = csv.trimEnd().split("\r\n").map((row) => row.split(","));

    assert.equal(values?.[headers?.indexOf("review_status") ?? -1], "open");
    assert.equal(values?.[headers?.indexOf("review_reason") ?? -1], expectedReviewReasons.join("; "));
  });
});

describe("demo review seed data", () => {
  it("hydrates the seeded review count and recent review reasons", async () => {
    const client = createDemoFinanceClient();
    const reviewItems = await listReviewItems(client, DEMO_USER_ID, "open");
    const reasonCounts = reviewItems.reduce<Map<ReviewReason, number>>((counts, item) => {
      counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
      return counts;
    }, new Map());

    assert.equal(reviewItems.length, 12);
    assert.equal(reasonCounts.get("missing-category"), 1);
    assert.equal(reasonCounts.get("unclear-transfer"), 1);
    assert.equal(reasonCounts.get("recurring-candidate"), 1);
    assert.equal(reasonCounts.get("venmo"), 4);
    const recurringSignalCount = (reasonCounts.get("new-recurring") ?? 0) +
      (reasonCounts.get("recurring-candidate") ?? 0);

    const missingCategory = await listTransactions(client, DEMO_USER_ID, { reviewReason: "missing-category" });
    const unclearTransfer = await listTransactions(client, DEMO_USER_ID, { reviewReason: "unclear-transfer" });
    const recurringCandidate = await listTransactions(client, DEMO_USER_ID, { reviewReason: "recurring-candidate" });
    const openReviews = await listTransactions(client, DEMO_USER_ID, { reviewStatus: "open" });

    assert.deepEqual(missingCategory.map((item) => item.merchant), ["Retail Wash"]);
    assert.deepEqual(unclearTransfer.map((item) => item.merchant), ["ACH TRANSFER UNKNOWN"]);
    assert.deepEqual(recurringCandidate.map((item) => item.merchant), ["Apple iCloud"]);
    assert.equal(openReviews.length, reviewItems.length - recurringSignalCount);
  });
});
