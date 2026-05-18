import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReimbursementRecord, TransactionIntent, TransactionSplitRecord } from "@/lib/db";
import {
  suggestReimbursementMatches,
  type ReimbursementMatchExpense,
  type ReimbursementMatchInflow
} from "./reimbursement-matching";

function split(id: string, amount: number, intent: TransactionIntent = "reimbursable"): TransactionSplitRecord {
  return {
    amount,
    categoryId: "category-food",
    categoryName: "Food / Restaurants",
    id,
    intent,
    label: id,
    notes: null,
    transactionId: "expense-1"
  };
}

function reimbursement(input: Partial<ReimbursementRecord> = {}): ReimbursementRecord {
  return {
    counterparty: "Chris",
    dueDate: null,
    expectedAmount: 75,
    id: "reimbursement-1",
    notes: null,
    receivedAmount: 0,
    receivedAt: null,
    receivedTransactionId: null,
    splitId: "split-friends",
    status: "expected",
    transactionId: "expense-1",
    ...input
  };
}

function expense(input: Partial<ReimbursementMatchExpense> = {}): ReimbursementMatchExpense {
  return {
    amount: -121.35,
    category: "Food / Restaurants",
    date: "2026-04-19",
    id: "expense-1",
    intent: "shared",
    merchant: "Dinner Spot",
    reimbursements: [reimbursement()],
    splits: [split("split-me", 46.35, "personal"), split("split-friends", 75)],
    ...input
  };
}

function inflow(input: Partial<ReimbursementMatchInflow> = {}): ReimbursementMatchInflow {
  return {
    amount: 75,
    category: "Uncategorized",
    date: "2026-04-21",
    id: "inflow-1",
    intent: "personal",
    merchant: "Venmo - Chris L.",
    note: null,
    status: "posted",
    ...input
  };
}

test("suggestReimbursementMatches ranks a Venmo exact amount match as high confidence", () => {
  const suggestions = suggestReimbursementMatches([expense()], [
    inflow({ amount: 15, id: "small" }),
    inflow({ amount: 75, id: "venmo-exact", merchant: "Venmo - Chris L." })
  ]);

  assert.equal(suggestions[0].expenseId, "expense-1");
  assert.deepEqual(suggestions[0].inflowIds, ["venmo-exact"]);
  assert.equal(suggestions[0].confidence, "high");
  assert.equal(suggestions[0].matchedAmount, 75);
  assert.match(suggestions[0].reasons.join(" "), /exactly matches/);
});

test("suggestReimbursementMatches supports Zelle partial reimbursement suggestions", () => {
  const suggestions = suggestReimbursementMatches([expense()], [
    inflow({ amount: 40, id: "zelle-partial", merchant: "Zelle payment from Maya" })
  ]);

  assert.equal(suggestions[0].confidence, "medium");
  assert.equal(suggestions[0].matchedAmount, 40);
  assert.equal(suggestions[0].unmatchedAmount, 35);
  assert.match(suggestions[0].reasons.join(" "), /partial reimbursement/);
});

test("suggestReimbursementMatches can rank multiple inflows that add up to the expected amount", () => {
  const suggestions = suggestReimbursementMatches([expense()], [
    inflow({ amount: 30, id: "venmo-30", merchant: "Venmo - Alex" }),
    inflow({ amount: 45, id: "cashapp-45", merchant: "Cash App - Sam", date: "2026-04-22" }),
    inflow({ amount: 20, id: "paypal-20", merchant: "PayPal Transfer" })
  ]);

  const multi = suggestions.find((suggestion) =>
    suggestion.inflowIds.includes("venmo-30") && suggestion.inflowIds.includes("cashapp-45")
  );

  assert.ok(multi, "Expected a two-inflow exact match suggestion.");
  assert.equal(multi.confidence, "high");
  assert.equal(multi.matchedAmount, 75);
  assert.match(multi.reasons.join(" "), /Multiple inflows add up/);
});

test("suggestReimbursementMatches excludes payroll, transfers, negative, and already linked inflows", () => {
  const suggestions = suggestReimbursementMatches([expense()], [
    inflow({ amount: 75, id: "payroll", merchant: "ACME Payroll Direct Deposit", category: "Payroll" }),
    inflow({ amount: 75, id: "transfer", intent: "transfer", merchant: "Internal Transfer" }),
    inflow({ amount: -75, id: "negative", merchant: "Venmo - Chris L." }),
    inflow({ alreadyLinked: true, amount: 75, id: "linked", merchant: "Venmo - Chris L." })
  ]);

  assert.deepEqual(suggestions, []);
});

test("suggestReimbursementMatches excludes inflows far above the expected reimbursement", () => {
  const suggestions = suggestReimbursementMatches([expense()], [
    inflow({ amount: 1000, id: "large-venmo", merchant: "Venmo - Chris L." })
  ]);

  assert.deepEqual(suggestions, []);
});

test("suggestReimbursementMatches describes small overmatches without negative unmatched copy", () => {
  const suggestions = suggestReimbursementMatches([expense()], [
    inflow({ amount: 79, id: "small-overmatch", merchant: "Venmo - Chris L." })
  ]);
  const reasons = suggestions[0].reasons.join(" ");

  assert.equal(suggestions[0].matchedAmount, 79);
  assert.equal(suggestions[0].unmatchedAmount, 0);
  assert.match(reasons, /exceeds the outstanding reimbursement by 4/);
  assert.doesNotMatch(reasons, /-\d+(?:\.\d+)? remains unmatched/);
});

test("suggestReimbursementMatches lowers confidence when amount, timing, and category are weak", () => {
  const suggestions = suggestReimbursementMatches([
    expense({
      amount: -220,
      category: "Miscellaneous",
      date: "2026-01-01",
      intent: "personal",
      reimbursements: [reimbursement({ expectedAmount: 75, receivedAmount: 0 })],
      splits: []
    })
  ], [
    inflow({
      amount: 25,
      date: "2026-03-15",
      id: "weak",
      merchant: "ATM credit",
      note: null
    })
  ]);

  assert.equal(suggestions[0].confidence, "low");
  assert.equal(suggestions[0].matchedAmount, 25);
  assert.match(suggestions[0].reasons.join(" "), /Timing is weak/);
});
