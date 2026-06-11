import { buildBudgetGuardrailSummary } from "./budget-guardrails";
import type { ReimbursementRecord, TransactionIntent, TransactionRecord, TransactionSplitRecord } from "@/lib/db";

function split(id: string, amount: number, intent: TransactionIntent): TransactionSplitRecord {
  return {
    amount,
    categoryId: "category-food",
    categoryName: "Food",
    id,
    intent,
    label: id,
    notes: null,
    transactionId: "tx-split"
  };
}

function reimbursement(input: Partial<ReimbursementRecord> = {}): ReimbursementRecord {
  return {
    counterparty: "Maya",
    dueDate: "2026-05-20",
    expectedAmount: 40,
    id: "reimbursement-1",
    notes: null,
    receivedAmount: 0,
    receivedAt: null,
    receivedTransactionId: null,
    splitId: "covered",
    status: "expected",
    transactionId: "tx-reimbursable",
    ...input
  };
}

function transaction(
  input: Pick<TransactionRecord, "amount" | "category" | "date" | "id" | "merchant"> & Partial<TransactionRecord>
): TransactionRecord {
  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Checking",
    categoryId: `category-${input.category.toLowerCase().replaceAll(" ", "-")}`,
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
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId: "user-1",
    ...input
  };
}

export const budgetGuardrailFixtureAssertions = assertBudgetGuardrailFixtures();

function assertBudgetGuardrailFixtures(): true {
  const summary = buildBudgetGuardrailSummary([
    transaction({ amount: -100, category: "Food", date: "2026-04-10", id: "food-apr", merchant: "Market" }),
    transaction({ amount: -90, category: "Food", date: "2026-03-10", id: "food-mar", merchant: "Market" }),
    transaction({ amount: -110, category: "Food", date: "2026-02-10", id: "food-feb", merchant: "Market" }),
    transaction({ amount: -120, category: "Travel", date: "2026-04-08", id: "travel-apr", merchant: "Train" }),
    transaction({ amount: -120, category: "Travel", date: "2026-03-08", id: "travel-mar", merchant: "Train" }),
    transaction({ amount: -120, category: "Travel", date: "2026-02-08", id: "travel-feb", merchant: "Train" }),
    transaction({ amount: -95, category: "Food", date: "2026-05-10", id: "food-may-1", merchant: "Market" }),
    transaction({
      amount: -20,
      category: "Food",
      date: "2026-05-12",
      id: "food-review",
      merchant: "Cafe",
      reviewStatus: "open"
    }),
    transaction({ amount: -60, category: "Travel", date: "2026-05-12", id: "travel-may", merchant: "Train" }),
    transaction({ amount: 3000, category: "Income", date: "2026-05-01", id: "income", merchant: "Payroll" }),
    transaction({ amount: -400, category: "Transfer", date: "2026-05-03", id: "transfer", intent: "transfer", merchant: "Card Payment" }),
    transaction({
      amount: -80,
      category: "Food",
      date: "2026-05-04",
      id: "split",
      merchant: "Venmo",
      splits: [
        split("mine", 40, "personal"),
        split("covered", 40, "reimbursable")
      ],
      reimbursements: [reimbursement({ transactionId: "split" })]
    })
  ], { asOfDate: "2026-05-15", baselineMonths: 3 });

  const food = summary.items.find((item) => item.label === "Food");
  const travel = summary.items.find((item) => item.label === "Travel");

  if (!food || food.budgetAmount !== 100 || food.currentAmount !== 155 || food.trustedAmount !== 135) {
    throw new Error("Expected food guardrail to use prior active-month average and current owned spend.");
  }

  if (food.unresolvedReviewAmount !== 20 || food.openReviewCount !== 1 || food.status !== "over") {
    throw new Error("Expected guardrails to preserve unresolved review impact while flagging over-budget categories.");
  }

  if (!travel || travel.budgetAmount !== 120 || travel.currentAmount !== 60 || travel.status !== "near") {
    throw new Error("Expected paced current-month spend to flag near-budget categories.");
  }

  if (summary.overCount !== 1 || summary.nearCount !== 1 || summary.monthElapsedDays !== 15 || summary.monthTotalDays !== 31) {
    throw new Error("Expected summary counts and month pacing metadata.");
  }

  return true;
}

import assert from "node:assert/strict";
import test from "node:test";

test("confirmed monthly budget amounts override historical averages", () => {
  const summary = buildBudgetGuardrailSummary([
    transaction({ amount: -100, category: "Food", date: "2026-04-10", id: "c-food-apr", merchant: "Market" }),
    transaction({ amount: -100, category: "Food", date: "2026-03-10", id: "c-food-mar", merchant: "Market" }),
    transaction({ amount: -95, category: "Food", date: "2026-05-10", id: "c-food-may", merchant: "Market" })
  ], {
    asOfDate: "2026-05-15",
    baselineMonths: 3,
    confirmedBudget: {
      categories: [
        { amount: 300, label: "Food" },
        { amount: 150, label: "Gifts" }
      ],
      month: "2026-05"
    }
  });

  const food = summary.items.find((item) => item.label === "Food");
  assert.ok(food);
  assert.equal(food.budgetAmount, 300);
  assert.equal(food.budgetSource, "confirmed");
  assert.equal(food.status, "on-track");

  const gifts = summary.items.find((item) => item.label === "Gifts");
  assert.ok(gifts, "confirmed categories without spend should still appear");
  assert.equal(gifts.budgetAmount, 150);
  assert.equal(gifts.budgetSource, "confirmed");
  assert.equal(gifts.currentAmount, 0);
  assert.equal(gifts.status, "on-track");

  assert.equal(summary.confirmedBudgetMonth, "2026-05");
});

test("a confirmed budget for a different month is ignored", () => {
  const summary = buildBudgetGuardrailSummary([
    transaction({ amount: -100, category: "Food", date: "2026-04-10", id: "i-food-apr", merchant: "Market" }),
    transaction({ amount: -100, category: "Food", date: "2026-03-10", id: "i-food-mar", merchant: "Market" }),
    transaction({ amount: -95, category: "Food", date: "2026-05-10", id: "i-food-may", merchant: "Market" })
  ], {
    asOfDate: "2026-05-15",
    baselineMonths: 3,
    confirmedBudget: {
      categories: [{ amount: 300, label: "Food" }],
      month: "2026-06"
    }
  });

  const food = summary.items.find((item) => item.label === "Food");
  assert.ok(food);
  assert.equal(food.budgetAmount, 100);
  assert.equal(food.budgetSource, "historical");
  assert.equal(summary.items.length, 1);
  assert.equal(summary.confirmedBudgetMonth, null);
});
