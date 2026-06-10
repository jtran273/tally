import assert from "node:assert/strict";
import test from "node:test";
import type { TransactionRecord } from "@/lib/db";
import { prefilterReimbursementCandidates } from "./reimbursement-candidates";

// Regression guard for reimbursement-candidate match QUALITY. Each fixture
// encodes a real-world case (or a near-clone of one from the user's inbox) and
// the suite asserts precision: the good matches are made 1:1, the bad ones are
// rejected, and crucially no inflow is ever reused across candidates.

const userId = "11111111-1111-1111-1111-111111111111";

function transaction(
  input: Partial<TransactionRecord> & Pick<TransactionRecord, "amount" | "date" | "id" | "merchant">
): TransactionRecord {
  const { date, id, merchant, ...rest } = input;
  return {
    accountId: "account-1",
    accountMask: "1111",
    accountName: "Checking",
    category: "Food / Restaurants",
    categoryId: "cat-food",
    confidence: 0.82,
    date,
    id,
    institutionName: "Demo Bank",
    intent: "personal",
    merchant,
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidName: null,
    plaidTransactionId: null,
    rawTransactionId: `raw-${id}`,
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId,
    ...rest
  };
}

function expense(input: { amount: number; category?: string; date: string; id: string; merchant: string }) {
  return transaction({ ...input, amount: -Math.abs(input.amount) });
}

function inflow(input: { amount: number; category?: string; date: string; id: string; intent?: TransactionRecord["intent"]; merchant: string }) {
  return transaction({ category: "Uncategorized", ...input, amount: Math.abs(input.amount) });
}

function candidateFor(transactions: readonly TransactionRecord[], inflows: readonly TransactionRecord[], expenseId: string) {
  return prefilterReimbursementCandidates(transactions, inflows).find(
    (candidate) => candidate.transaction.id === expenseId
  );
}

function inflowIdsFor(transactions: readonly TransactionRecord[], inflows: readonly TransactionRecord[], expenseId: string) {
  return candidateFor(transactions, inflows, expenseId)?.candidateInflows.map((c) => c.id) ?? [];
}

// --- POSITIVES --------------------------------------------------------------

test("eval/positive: Milestone Tavern -67.21 matches Venmo +44.00 the next day (the one good real match)", () => {
  const tavern = expense({ amount: 67.21, date: "2026-06-01", id: "tx-tavern", merchant: "Milestone Tavern" });
  const venmo = inflow({ amount: 44.0, date: "2026-06-02", id: "in-venmo-44", merchant: "Venmo payment from Sam" });

  const candidate = candidateFor([tavern], [venmo], "tx-tavern");
  assert.deepEqual(candidate?.candidateInflows.map((c) => c.id), ["in-venmo-44"]);
  assert.ok((candidate?.confidence ?? 0) >= 0.7, "a close peer split should be high confidence");
});

test("eval/positive: clean full-repay (Zelle exactly matches the bill)", () => {
  const dinner = expense({ amount: 128.4, date: "2026-05-10", id: "tx-dinner", merchant: "Sun Nong Dan" });
  const zelle = inflow({ amount: 128.4, date: "2026-05-12", id: "in-zelle-full", merchant: "Zelle from Partners Group" });

  assert.deepEqual(inflowIdsFor([dinner], [zelle], "tx-dinner"), ["in-zelle-full"]);
});

test("eval/positive: multi-transfer (two Venmos from the same person sum to the bill)", () => {
  const trip = expense({ amount: 200, category: "Travel / Hotel", date: "2026-05-03", id: "tx-trip", merchant: "Hotel Slo" });
  const venmoA = inflow({ amount: 100, date: "2026-05-04", id: "in-venmo-a", merchant: "Venmo payment from Jordan Lee" });
  const venmoB = inflow({ amount: 100, date: "2026-05-05", id: "in-venmo-b", merchant: "Venmo payment from Jordan Lee" });

  const ids = inflowIdsFor([trip], [venmoA, venmoB], "tx-trip");
  assert.deepEqual([...ids].sort(), ["in-venmo-a", "in-venmo-b"]);
});

// --- NEGATIVES --------------------------------------------------------------

test("eval/negative: one +126.09 Venmo cannot back five different expenses (no inflow reuse)", () => {
  // Straight from the inbox: a single Venmo was offered for $900+ of expenses.
  const venmo = inflow({ amount: 126.09, date: "2026-04-13", id: "in-venmo-126", merchant: "Venmo payment from Casey" });
  const expenses = [
    expense({ amount: 334, category: "Shopping", date: "2026-04-12", id: "tx-amazon", merchant: "Amazon" }),
    expense({ amount: 194, category: "Travel / Hotel", date: "2026-04-11", id: "tx-hotel", merchant: "Hotel Slo" }),
    expense({ amount: 132, date: "2026-04-13", id: "tx-sun", merchant: "Sun Nong Dan" }),
    expense({ amount: 128, date: "2026-04-10", id: "tx-partners", merchant: "Partners" }),
    expense({ amount: 252.18, date: "2026-04-12", id: "tx-clean-split", merchant: "Group Dinner" }) // 126.09 == half of 252.18
  ];

  const candidates = prefilterReimbursementCandidates(expenses, [venmo]);
  const assignedCount = candidates.filter((c) => c.candidateInflows.some((i) => i.id === "in-venmo-126")).length;
  assert.equal(assignedCount, 1, "the single Venmo must back at most one expense");
  // It should land on the clean half-split, not any of the loose fractions.
  const owner = candidates.find((c) => c.candidateInflows.some((i) => i.id === "in-venmo-126"));
  assert.equal(owner?.transaction.id, "tx-clean-split");
});

test("eval/negative: 32-day-stale Ticketmaster merchant refund is rejected", () => {
  const hotel = expense({ amount: 187, category: "Travel / Hotel", date: "2026-05-01", id: "tx-hotel", merchant: "La Quinta" });
  // Same amount, but a merchant refund (not a peer payment) 32 days later.
  const refund = inflow({ amount: 187, category: "Entertainment", date: "2026-06-02", id: "in-ticketmaster", merchant: "Ticketmaster" });

  assert.deepEqual(inflowIdsFor([hotel], [refund], "tx-hotel"), []);
});

test("eval/negative: a tiny inflow against a large stay is rejected", () => {
  const airbnb = expense({ amount: 1628.56, category: "Travel / Lodging", date: "2026-02-22", id: "tx-airbnb", merchant: "Airbnb" });
  // Even as a peer payment, $32 against a $1,600 stay is far too small a fraction.
  const tiny = inflow({ amount: 32.31, date: "2026-02-24", id: "in-tiny", merchant: "Venmo payment from Robin" });

  assert.deepEqual(inflowIdsFor([airbnb], [tiny], "tx-airbnb"), []);
});

test("eval/negative: a payroll / Income deposit is rejected", () => {
  const hotel = expense({ amount: 900, category: "Travel / Hotel", date: "2026-05-04", id: "tx-hotel", merchant: "Ace Hotel" });
  const payroll = inflow({ amount: 900, category: "Income", date: "2026-05-06", id: "in-payroll", merchant: "ACME INC Payroll" });

  assert.deepEqual(inflowIdsFor([hotel], [payroll], "tx-hotel"), []);
});

// --- GLOBAL INVARIANT -------------------------------------------------------

test("eval/invariant: no inflow id appears in more than one candidate across a mixed scan", () => {
  const expenses = [
    expense({ amount: 67.21, date: "2026-06-01", id: "tx-tavern", merchant: "Milestone Tavern" }),
    expense({ amount: 128.4, date: "2026-05-10", id: "tx-dinner", merchant: "Sun Nong Dan" }),
    expense({ amount: 88.0, date: "2026-05-10", id: "tx-meal", merchant: "Local Bistro" }),
    expense({ amount: 1628.56, category: "Travel / Lodging", date: "2026-02-22", id: "tx-airbnb", merchant: "Airbnb" })
  ];
  const inflows = [
    inflow({ amount: 44.0, date: "2026-06-02", id: "in-venmo-44", merchant: "Venmo payment from Sam" }),
    inflow({ amount: 128.4, date: "2026-05-12", id: "in-zelle-full", merchant: "Zelle from Partners Group" }),
    // Ambiguous: $44 also halves the $88 meal; greedy must still not reuse it.
    inflow({ amount: 44.0, date: "2026-05-11", id: "in-venmo-44b", merchant: "Venmo payment from Casey" }),
    inflow({ amount: 32.31, date: "2026-02-24", id: "in-tiny", merchant: "Venmo payment from Robin" })
  ];

  const candidates = prefilterReimbursementCandidates(expenses, inflows);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    for (const used of candidate.candidateInflows) {
      assert.ok(!seen.has(used.id), `inflow ${used.id} was assigned to more than one candidate`);
      seen.add(used.id);
    }
  }

  // And the tiny inflow should never be used at all.
  assert.ok(!seen.has("in-tiny"), "the negligible inflow must not be matched");
});
