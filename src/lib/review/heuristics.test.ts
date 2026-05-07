import type { EnrichedTransactionRow, ReviewReason } from "../db";
import { buildTransactionReviewItems } from "./heuristics";

const userId = "11111111-1111-1111-1111-111111111111";

function transaction(input: Partial<EnrichedTransactionRow> & Pick<EnrichedTransactionRow, "id" | "merchant_name">): EnrichedTransactionRow {
  const { id, merchant_name: merchantName, ...overrides } = input;

  return {
    account_id: "account-checking",
    amount: -42,
    category_id: "category-food",
    category_name: "Food / Restaurants",
    confidence: 0.92,
    created_at: "2026-05-06T12:00:00.000Z",
    date: "2026-05-06",
    intent: "personal",
    is_recurring: false,
    note: "",
    raw_transaction_id: `raw-${input.id}`,
    reviewed_at: null,
    source: "plaid",
    status: "posted",
    updated_at: "2026-05-06T12:00:00.000Z",
    user_id: userId,
    ...overrides,
    id,
    merchant_name: merchantName
  };
}

function reasonsFor(input: EnrichedTransactionRow): ReviewReason[] {
  return buildTransactionReviewItems(input)
    .map((item) => item.reason)
    .filter((reason): reason is ReviewReason => Boolean(reason));
}

export const reviewHeuristicMappedCategoryFixture = reasonsFor(transaction({
  category_id: null,
  category_name: "Shopping",
  id: "tx-shopping",
  merchant_name: "Target"
}));

export const reviewHeuristicUncategorizedFixture = reasonsFor(transaction({
  category_id: null,
  category_name: "Uncategorized",
  id: "tx-uncategorized",
  merchant_name: "Unknown Merchant"
}));

export const reviewHeuristicPeerToPeerFixture = reasonsFor(transaction({
  amount: -64,
  category_id: null,
  category_name: "Uncategorized",
  confidence: 0.4,
  id: "tx-venmo",
  intent: "shared",
  merchant_name: "Venmo Rachel"
}));

export const reviewHeuristicLowConfidenceFixture = reasonsFor(transaction({
  confidence: 0.5,
  id: "tx-low-confidence",
  merchant_name: "Corner Store"
}));

export const reviewHeuristicLargeTransferFixture = reasonsFor(transaction({
  amount: -1500,
  category_id: "category-transfer",
  category_name: "Transfer",
  id: "tx-transfer",
  intent: "transfer",
  merchant_name: "Online Transfer"
}));

export const reviewHeuristicStaticAssertions = assertReviewHeuristicFixtures();

function assertReviewHeuristicFixtures(): true {
  if (reviewHeuristicMappedCategoryFixture.length !== 0) {
    throw new Error("Expected mapped Plaid category names without category ids to avoid review noise.");
  }

  if (!reviewHeuristicUncategorizedFixture.includes("missing-category")) {
    throw new Error("Expected uncategorized real imports to stay actionable in review.");
  }

  if (
    reviewHeuristicPeerToPeerFixture.length !== 1 ||
    reviewHeuristicPeerToPeerFixture[0] !== "venmo"
  ) {
    throw new Error("Expected peer-to-peer imports to produce a single explanation-first review item.");
  }

  if (!reviewHeuristicLowConfidenceFixture.includes("low-confidence")) {
    throw new Error("Expected low-confidence Plaid categories to stay in review.");
  }

  if (reviewHeuristicLargeTransferFixture.includes("large")) {
    throw new Error("Expected large transfer rows not to be reviewed as ordinary spending.");
  }

  return true;
}
