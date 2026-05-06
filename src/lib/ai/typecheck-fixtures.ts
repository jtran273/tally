import type { TransactionEnrichmentPatch } from "../db/queries";
import type { CategoryRecord } from "../db/types";
import {
  buildUserAcceptedEnrichmentPatch,
  suggestTransactionWithMockProvider,
  type RawTransactionSuggestionFields,
  type TransactionAiSuggestion
} from "./index";

const fixtureCategories = [
  category("40000000-0000-0000-0000-000000000001", "Uncategorized"),
  category("40000000-0000-0000-0000-000000000002", "Food / Restaurants"),
  category("40000000-0000-0000-0000-000000000003", "Software / AI Tools"),
  category("40000000-0000-0000-0000-000000000004", "Software / SaaS"),
  category("40000000-0000-0000-0000-000000000010", "Transfer"),
  category("40000000-0000-0000-0000-000000000011", "Income")
] satisfies readonly CategoryRecord[];

const peerToPeerSuggestion = suggestTransactionWithMockProvider({
  rawTransaction: rawTransaction({
    id: "raw-venmo",
    name: "VENMO CASHOUT MAYA R",
    merchant_name: "VENMO CASHOUT MAYA R",
    amount: -92.4,
    plaid_category: "Transfer",
    payment_channel: "online"
  }),
  categories: fixtureCategories
});

const aiToolSuggestion = suggestTransactionWithMockProvider({
  rawTransaction: rawTransaction({
    id: "raw-openai",
    name: "OPENAI *CHATGPT SUBSCRIPTION",
    merchant_name: "OPENAI",
    amount: -20,
    plaid_category: "Service",
    payment_channel: "online"
  }),
  categories: fixtureCategories
});

const acceptedPatch = buildUserAcceptedEnrichmentPatch(aiToolSuggestion, {
  reviewedAt: "2026-05-06T12:00:00.000Z"
});

export const mockSuggestionTypecheckFixtures = {
  suggestions: [peerToPeerSuggestion, aiToolSuggestion],
  acceptedPatch
} satisfies {
  suggestions: readonly TransactionAiSuggestion[];
  acceptedPatch: TransactionEnrichmentPatch;
};

function category(id: string, name: string): CategoryRecord {
  return {
    id,
    userId: "11111111-1111-1111-1111-111111111111",
    parentId: null,
    name,
    color: null,
    icon: null,
    isSystem: true
  };
}

function rawTransaction(
  fields: Pick<RawTransactionSuggestionFields, "id" | "name" | "amount"> &
    Partial<Omit<RawTransactionSuggestionFields, "id" | "name" | "amount">>
): RawTransactionSuggestionFields {
  return {
    id: fields.id,
    name: fields.name,
    merchant_name: fields.merchant_name ?? null,
    amount: fields.amount,
    iso_currency_code: fields.iso_currency_code ?? "USD",
    payment_channel: fields.payment_channel ?? null,
    plaid_category: fields.plaid_category ?? null,
    transaction_type: fields.transaction_type ?? null
  };
}
