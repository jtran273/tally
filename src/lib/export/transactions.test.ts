import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewItemRecord, TransactionRecord } from "../db";
import {
  buildTransactionsCsv,
  type TransactionReimbursementSummary
} from "./transactions";

const userId = "11111111-1111-1111-1111-111111111111";

function review(transactionId: string): ReviewItemRecord {
  return {
    aiSuggestion: {},
    confidence: 0.52,
    createdAt: "2026-05-06T12:00:00.000Z",
    explanation: "Low-confidence Plaid category.",
    id: "review-export",
    reason: "low-confidence",
    resolutionNote: null,
    resolvedAt: null,
    status: "open",
    transactionId
  };
}

function transaction(input: Pick<TransactionRecord, "id" | "merchant"> & Partial<TransactionRecord>): TransactionRecord {
  const { id, merchant, ...overrides } = input;
  const reviewItems = input.reviewItems ?? [];

  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Everyday Checking",
    amount: -64.5,
    category: "Food / Restaurants",
    categoryId: "category-food",
    confidence: 0.52,
    date: "2026-05-06",
    institutionName: "Seed Bank",
    intent: "shared",
    note: "Dinner split",
    plaidCategory: "FOOD_AND_DRINK / FOOD_AND_DRINK_RESTAURANT",
    plaidMerchant: "RAW MERCHANT",
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

const exportTransaction = transaction({
  id: "tx-export",
  merchant: "=SUM(A1:A2)",
  plaidName: "SQ *RAW PLAID NAME",
  reviewItems: [review("tx-export")]
});

const reimbursementSummary: TransactionReimbursementSummary = {
  count: 1,
  counterparties: "Ada",
  dueDates: "2026-05-20",
  expectedAmount: 64.5,
  notes: "Requested after dinner",
  receivedAmount: 0,
  receivedDates: "",
  statuses: "requested"
};

export const transactionCsvFixture = buildTransactionsCsv(
  [exportTransaction],
  new Map([["tx-export", reimbursementSummary]])
);

export const transactionCsvStaticAssertions = assertTransactionCsvFixture(transactionCsvFixture);

test("buildTransactionsCsv exports review, reimbursement, raw Plaid, and safe merchant fields", () => {
  assert.equal(transactionCsvFixture.endsWith("\r\n"), true);
  assert.match(transactionCsvFixture, /'=SUM\(A1:A2\)/);
  assert.match(transactionCsvFixture, /Food \/ Restaurants,Restaurants/);
  assert.match(transactionCsvFixture, /open,low-confidence/);
  assert.match(transactionCsvFixture, /requested,Ada,64\.50,0/);
  assert.match(transactionCsvFixture, /RAW MERCHANT,SQ \*RAW PLAID NAME/);
});

test("buildTransactionsCsv neutralizes formula-like values hidden behind whitespace", () => {
  const csv = buildTransactionsCsv([
    transaction({
      id: "tx-hidden-formula",
      merchant: " =IMPORTXML(\"https://example.test\", \"//title\")",
      note: "\n=HYPERLINK(\"https://example.test\")",
      plaidMerchant: "\t@external-reference"
    })
  ]);

  assert.match(csv, /"' =IMPORTXML\(""https:\/\/example\.test"", ""\/\/title""\)"/);
  assert.match(csv, /"'\n=HYPERLINK\(""https:\/\/example\.test""\)"/);
  assert.match(csv, /"'\t@external-reference"/);
});

function assertTransactionCsvFixture(csv: string): true {
  if (!csv.endsWith("\r\n")) {
    throw new Error("Expected transaction CSV export to end with a CRLF row terminator.");
  }

  if (!csv.includes("'=SUM(A1:A2)")) {
    throw new Error("Expected transaction CSV export to neutralize formula-like merchant values.");
  }

  if (!csv.includes("Food / Restaurants,Restaurants")) {
    throw new Error("Expected transaction CSV export to include full and leaf category names.");
  }

  if (!csv.includes("open,low-confidence")) {
    throw new Error("Expected transaction CSV export to include review status and reason columns.");
  }

  if (!csv.includes("requested,Ada,64.50,0")) {
    throw new Error("Expected transaction CSV export to include reimbursement summary columns.");
  }

  if (!csv.includes("RAW MERCHANT,SQ *RAW PLAID NAME")) {
    throw new Error("Expected transaction CSV export to include raw Plaid merchant and raw Plaid name columns.");
  }

  return true;
}
