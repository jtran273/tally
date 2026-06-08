import assert from "node:assert/strict";
import test from "node:test";
import {
  findRefundReversalMatch,
  getMatchedRefundReversalTransactionIds
} from "./refund-reversals";

function transaction(id: string, amount: number, merchant: string, date = "2026-06-04") {
  return {
    accountId: "account-card",
    amount,
    date,
    id,
    intent: "personal",
    merchant
  };
}

test("findRefundReversalMatch pairs exact merchant credits with matching charges", () => {
  const charge = transaction("target-charge", -430.99, "Target", "2026-06-03");
  const credit = transaction("target-credit", 430.99, "Target", "2026-06-04");
  const unrelated = transaction("payroll", 430.99, "PAYROLL DEPOSIT", "2026-06-04");

  assert.deepEqual(getMatchedRefundReversalTransactionIds([charge, credit, unrelated]), new Set([
    "target-charge",
    "target-credit"
  ]));

  const creditMatch = findRefundReversalMatch([charge, credit, unrelated], credit);
  assert.equal(creditMatch?.credit.id, "target-credit");
  assert.equal(creditMatch?.debit.id, "target-charge");

  const chargeMatch = findRefundReversalMatch([charge, credit, unrelated], charge);
  assert.equal(chargeMatch?.credit.id, "target-credit");
  assert.equal(chargeMatch?.debit.id, "target-charge");
});

test("findRefundReversalMatch does not treat peer payments as refunds without reversal evidence", () => {
  const peerOut = transaction("venmo-out", -60, "Venmo - Chris", "2026-06-03");
  const peerIn = transaction("venmo-in", 60, "Venmo - Chris", "2026-06-04");

  assert.equal(findRefundReversalMatch([peerOut, peerIn], peerIn), null);
});
