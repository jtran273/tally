import assert from "node:assert/strict";
import test from "node:test";
import type { CategoryRecord, MerchantRuleRow } from "@/lib/db";
import { suggestTransactionWithMockProvider } from "./mock-provider";
import type { RawTransactionSuggestionFields } from "./types";

const userId = "11111111-1111-1111-1111-111111111111";

const categories: CategoryRecord[] = [
  cat("cat-ai-tools", "Software / AI Tools"),
  cat("cat-saas", "Software / SaaS"),
  cat("cat-hosting", "Software / Hosting"),
  cat("cat-food", "Food / Restaurants"),
  cat("cat-groceries", "Groceries"),
  cat("cat-rideshare", "Transport / Rideshare"),
  cat("cat-transfer", "Transfer"),
  cat("cat-income", "Income"),
  cat("cat-shopping", "Shopping"),
  cat("cat-uncategorized", "Uncategorized")
];

function cat(id: string, name: string): CategoryRecord {
  return { color: null, icon: null, id, isSystem: true, name, parentId: null, userId };
}

function raw(
  fields: Pick<RawTransactionSuggestionFields, "id" | "name" | "amount"> &
    Partial<Omit<RawTransactionSuggestionFields, "id" | "name" | "amount">>
): RawTransactionSuggestionFields {
  return {
    iso_currency_code: "USD",
    merchant_name: null,
    payment_channel: null,
    plaid_category: null,
    transaction_type: null,
    ...fields
  };
}

function merchantRule(override: Partial<MerchantRuleRow> & Pick<MerchantRuleRow, "merchant_pattern">): MerchantRuleRow {
  return {
    category_id: null,
    created_at: "2026-05-06T00:00:00.000Z",
    enabled: true,
    id: "rule-1",
    intent: null,
    is_recurring: null,
    max_amount: null,
    min_amount: null,
    normalized_merchant_name: null,
    notes: null,
    priority: 10,
    updated_at: "2026-05-06T00:00:00.000Z",
    user_id: userId,
    ...override
  };
}

test("mock provider: known AI merchant gets Software/AI Tools and business intent", () => {
  const result = suggestTransactionWithMockProvider({
    categories,
    rawTransaction: raw({ id: "raw-1", name: "OPENAI *CHATGPT", merchant_name: "OpenAI", amount: -20 })
  });

  assert.equal(result.category.value.name, "Software / AI Tools");
  assert.equal(result.category.value.id, "cat-ai-tools");
  assert.equal(result.intent.value, "business");
  assert.equal(result.recurring?.value, true);
  assert(result.confidence >= 0.9, `Expected confidence >= 0.9, got ${result.confidence}`);
  assert.equal(result.merchantCleanup.value.normalized, "OpenAI");
});

test("mock provider: Vercel gets Software/Hosting and business intent", () => {
  const result = suggestTransactionWithMockProvider({
    categories,
    rawTransaction: raw({ id: "raw-2", name: "VERCEL INC", merchant_name: "Vercel", amount: -20 })
  });

  assert.equal(result.category.value.name, "Software / Hosting");
  assert.equal(result.category.value.id, "cat-hosting");
  assert.equal(result.intent.value, "business");
  assert.equal(result.recurring?.value, true);
});

test("mock provider: grocery merchant gets Groceries category", () => {
  const result = suggestTransactionWithMockProvider({
    categories,
    rawTransaction: raw({ id: "raw-3", name: "WHOLE FOODS MKT", merchant_name: "Whole Foods", amount: -62 })
  });

  assert.equal(result.category.value.name, "Groceries");
  assert.equal(result.category.value.id, "cat-groceries");
  assert.equal(result.intent.value, "personal");
  assert.equal(result.merchantCleanup.value.normalized, "Whole Foods");
});

test("mock provider: Venmo P2P merchant normalizes counterparty and stays low-confidence", () => {
  const result = suggestTransactionWithMockProvider({
    categories,
    rawTransaction: raw({ id: "raw-4", name: "VENMO PAYMENT MAYA R", merchant_name: "VENMO PAYMENT MAYA R", amount: -45 })
  });

  assert(result.merchantCleanup.value.normalized.startsWith("Venmo"), `Expected Venmo prefix, got: ${result.merchantCleanup.value.normalized}`);
  assert(result.confidence <= 0.65, `Expected confidence <= 0.65 for P2P, got ${result.confidence}`);
  assert(result.signals.some((s) => s.includes("merchant cue")), "Expected merchant cue signal");
});

test("mock provider: rideshare merchant maps to Transport/Rideshare", () => {
  const result = suggestTransactionWithMockProvider({
    categories,
    rawTransaction: raw({ id: "raw-5", name: "UBER *TRIP", merchant_name: "Uber", amount: -18 })
  });

  assert.equal(result.category.value.name, "Transport / Rideshare");
  assert.equal(result.intent.value, "personal");
  assert.equal(result.merchantCleanup.value.normalized, "Uber");
});

test("mock provider: ACH transfer gets Transfer category and transfer intent", () => {
  const result = suggestTransactionWithMockProvider({
    categories,
    rawTransaction: raw({ id: "raw-6", name: "ACH TRANSFER OUT", merchant_name: null, amount: -500 })
  });

  assert.equal(result.category.value.name, "Transfer");
  assert.equal(result.intent.value, "transfer");
  assert(result.confidence >= 0.85, `Expected high confidence for transfer, got ${result.confidence}`);
});

test("mock provider: Plaid category cue drives category when merchant has no cue", () => {
  const result = suggestTransactionWithMockProvider({
    categories,
    rawTransaction: raw({
      id: "raw-7",
      name: "RANDOM FOOD PLACE",
      merchant_name: null,
      amount: -28,
      plaid_category: "FOOD_AND_DRINK_RESTAURANTS"
    })
  });

  assert.equal(result.category.value.name, "Food / Restaurants");
  assert.equal(result.intent.value, "personal");
  assert(result.signals.some((s) => s.includes("plaid category")), "Expected plaid category signal");
});

test("mock provider: merchant rule overrides category and intent", () => {
  const rule = merchantRule({
    category_id: "cat-saas",
    enabled: true,
    intent: "business",
    merchant_pattern: "NETFLIX%",
    normalized_merchant_name: "Netflix",
    notes: "Work Netflix subscription.",
    priority: 1
  });

  const result = suggestTransactionWithMockProvider({
    categories,
    merchantRules: [rule],
    rawTransaction: raw({ id: "raw-8", name: "NETFLIX.COM", merchant_name: "NETFLIX.COM", amount: -18 })
  });

  assert.equal(result.category.value.name, "Software / SaaS");
  assert.equal(result.category.value.id, "cat-saas");
  assert.equal(result.intent.value, "business");
  assert.equal(result.merchantCleanup.value.normalized, "Netflix");
  assert.equal(result.reason, "Work Netflix subscription.");
  assert(result.confidence >= 0.9, `Expected high confidence from rule, got ${result.confidence}`);
  assert.equal(result.category.source, "merchant-rule");
});

test("mock provider: merchant rule with amount range filters correctly", () => {
  const rule = merchantRule({
    category_id: "cat-saas",
    merchant_pattern: "STRIPE%",
    min_amount: 100,
    notes: "Large Stripe charge."
  });

  const belowThreshold = suggestTransactionWithMockProvider({
    categories,
    merchantRules: [rule],
    rawTransaction: raw({ id: "raw-9a", name: "STRIPE INC", merchant_name: "STRIPE INC", amount: -50 })
  });
  assert.notEqual(belowThreshold.reason, "Large Stripe charge.", "Rule should not apply when amount is below min");

  const aboveThreshold = suggestTransactionWithMockProvider({
    categories,
    merchantRules: [rule],
    rawTransaction: raw({ id: "raw-9b", name: "STRIPE INC", merchant_name: "STRIPE INC", amount: -150 })
  });
  assert.equal(aboveThreshold.reason, "Large Stripe charge.", "Rule should apply when amount is above min");
});

test("mock provider: unknown merchant falls back with low confidence", () => {
  const result = suggestTransactionWithMockProvider({
    categories,
    rawTransaction: raw({ id: "raw-10", name: "POS PURCHASE 7734", merchant_name: null, amount: -37, plaid_category: null })
  });

  assert(result.confidence <= 0.65, `Expected fallback confidence <= 0.65, got ${result.confidence}`);
  assert(result.signals.includes("fallback cue"), "Expected fallback cue signal");
});

test("mock provider: large non-transfer spend lowers confidence", () => {
  const highAmount = suggestTransactionWithMockProvider({
    categories,
    rawTransaction: raw({ id: "raw-11", name: "AMAZON.COM", merchant_name: "Amazon", amount: -800 })
  });
  const normalAmount = suggestTransactionWithMockProvider({
    categories,
    rawTransaction: raw({ id: "raw-12", name: "AMAZON.COM", merchant_name: "Amazon", amount: -30 })
  });

  assert(highAmount.confidence < normalAmount.confidence, "Large amount should reduce confidence");
  assert(highAmount.reason.includes("Large amount"), "Reason should mention large amount");
});

test("mock provider: suggestionId is stable for identical inputs", () => {
  const input = {
    categories,
    rawTransaction: raw({ id: "raw-stable", name: "GITHUB.COM", merchant_name: "GitHub", amount: -7 })
  };

  const first = suggestTransactionWithMockProvider(input);
  const second = suggestTransactionWithMockProvider(input);
  assert.equal(first.suggestionId, second.suggestionId, "suggestionId should be deterministic");
});

test("mock provider: disabled merchant rule is not applied", () => {
  const rule = merchantRule({
    category_id: "cat-saas",
    enabled: false,
    merchant_pattern: "JIRA%",
    notes: "Disabled rule."
  });

  const result = suggestTransactionWithMockProvider({
    categories,
    merchantRules: [rule],
    rawTransaction: raw({ id: "raw-13", name: "JIRA BY ATLASSIAN", merchant_name: "JIRA BY ATLASSIAN", amount: -10 })
  });

  assert.notEqual(result.reason, "Disabled rule.", "Disabled rule should not be applied");
});
