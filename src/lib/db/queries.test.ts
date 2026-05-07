import assert from "node:assert/strict";
import test from "node:test";
import { filterTransactionRecordsForList, transactionMatchesSearch } from "./queries";
import type { ReviewItemRecord, ReviewStatus, TransactionIntent, TransactionRecord } from "./types";

const userId = "11111111-1111-1111-1111-111111111111";

function review(id: string, transactionId: string, status: ReviewStatus): ReviewItemRecord {
  return {
    aiSuggestion: {},
    confidence: 0.71,
    createdAt: "2026-05-06T12:00:00.000Z",
    explanation: "Fixture review item",
    id,
    reason: "low-confidence",
    resolutionNote: null,
    resolvedAt: null,
    status,
    transactionId
  };
}

function transaction(
  input: Pick<TransactionRecord, "id" | "merchant"> & Partial<TransactionRecord>
): TransactionRecord {
  const { id, merchant, ...overrides } = input;
  const reviewItems = input.reviewItems ?? [];

  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Everyday Checking",
    amount: -25,
    category: "Food / Restaurants",
    categoryId: "category-food",
    confidence: 0.91,
    date: "2026-05-06",
    institutionName: "Seed Bank",
    intent: "personal" as TransactionIntent,
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidTransactionId: `plaid-${input.id}`,
    rawTransactionId: `raw-${input.id}`,
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems,
    reviewReason: reviewItems.find((item) => item.status === "open")?.reason ?? null,
    reviewStatus: reviewItems.find((item) => item.status === "open")?.status ?? null,
    splits: [],
    status: "posted",
    userId,
    ...overrides,
    id,
    merchant,
    plaidName: overrides.plaidName ?? null
  };
}

export const transactionFilterFixture = [
  transaction({ id: "tx-coffee", merchant: "Blue Bottle" }),
  transaction({
    category: "Transfer",
    categoryId: "category-transfer",
    id: "tx-transfer",
    intent: "transfer",
    merchant: "Online Transfer"
  }),
  transaction({
    id: "tx-rideshare",
    merchant: "Lyft",
    note: "Airport ride",
    plaidCategory: "TRANSPORTATION / TAXIS_AND_RIDE_SHARES",
    plaidMerchant: "LYFT TRIP",
    reviewItems: [review("review-rideshare", "tx-rideshare", "open")]
  }),
  transaction({
    id: "tx-grocery",
    merchant: "Grocery Mart",
    reviewItems: [review("review-grocery", "tx-grocery", "resolved")]
  })
] satisfies readonly TransactionRecord[];

export const transactionSearchFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  search: "ride shares"
});

export const transactionExcludeTransferFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  excludeTransfers: true
});

export const transactionOpenReviewFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  reviewStatus: "open"
});

export const transactionPagedFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  excludeTransfers: true,
  limit: 1,
  offset: 1
});

export const transactionFilterStaticAssertions = assertTransactionFilterFixtures();

test("transaction search matches normalized Plaid category text", () => {
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { search: "ride shares" }).map((item) => item.id),
    ["tx-rideshare"]
  );
});

test("transaction search covers merchant, raw Plaid merchant/name, category, account, mask, institution, and note", () => {
  const transactionUnderTest = transaction({
    accountMask: "9876",
    accountName: "Schools First Checking",
    category: "Food / Restaurants",
    id: "tx-search-surface",
    institutionName: "Schools First FCU",
    merchant: "Lyft",
    note: "Airport ride",
    plaidCategory: "TRANSPORTATION / TAXIS_AND_RIDE_SHARES",
    plaidMerchant: "LYFT TRIP",
    plaidName: "SQ *LYFT ORIGINAL DESCRIPTION"
  });

  [
    "Lyft",
    "LYFT TRIP",
    "original description",
    "restaurants",
    "schools first checking",
    "9876",
    "Schools First FCU",
    "airport ride",
    "taxis and ride shares"
  ].forEach((query) => {
    assert.equal(transactionMatchesSearch(transactionUnderTest, query), true, `Expected search to match ${query}`);
  });
});

test("transaction list filters compose review, transfer exclusion, limit, and offset after search", () => {
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { excludeTransfers: true }).map((item) => item.id),
    ["tx-coffee", "tx-rideshare", "tx-grocery"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { reviewStatus: "open" }).map((item) => item.id),
    ["tx-rideshare"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, {
      excludeTransfers: true,
      limit: 1,
      offset: 1
    }).map((item) => item.id),
    ["tx-rideshare"]
  );
});

function assertTransactionFilterFixtures(): true {
  if (transactionSearchFixture.length !== 1 || transactionSearchFixture[0]?.id !== "tx-rideshare") {
    throw new Error("Expected transaction search to include raw Plaid category and merchant text.");
  }

  if (transactionExcludeTransferFixture.some((item) => item.intent === "transfer")) {
    throw new Error("Expected excludeTransfers to remove transfer-intent transactions.");
  }

  if (transactionOpenReviewFixture.length !== 1 || transactionOpenReviewFixture[0]?.id !== "tx-rideshare") {
    throw new Error("Expected reviewStatus=open to include only transactions with open review items.");
  }

  if (transactionPagedFixture.length !== 1 || transactionPagedFixture[0]?.id !== "tx-rideshare") {
    throw new Error("Expected limit and offset to apply after search/review/transfer filters.");
  }

  return true;
}
