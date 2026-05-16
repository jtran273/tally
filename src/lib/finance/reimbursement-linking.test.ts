import assert from "node:assert/strict";
import test from "node:test";
import { buildReimbursementLinkDecision, isReportableIncomeIntent } from "./reimbursement-linking";

test("buildReimbursementLinkDecision records partial reimbursement without clearing outstanding balance", () => {
  const decision = buildReimbursementLinkDecision(
    { expectedAmount: 75, receivedAmount: 0 },
    { amount: 25, date: "2026-05-12" }
  );

  assert.deepEqual(decision, {
    appliedAmount: 25,
    outstandingAmount: 50,
    receivedAmount: 25,
    receivedAt: "2026-05-12",
    status: "requested"
  });
});

test("buildReimbursementLinkDecision applies against the remaining outstanding amount", () => {
  const decision = buildReimbursementLinkDecision(
    { expectedAmount: 75, receivedAmount: 25 },
    { amount: 100, date: "2026-05-13" }
  );

  assert.equal(decision.appliedAmount, 50);
  assert.equal(decision.receivedAmount, 75);
  assert.equal(decision.outstandingAmount, 0);
  assert.equal(decision.status, "received");
});

test("buildReimbursementLinkDecision caps default applied amount at expected reimbursement", () => {
  const decision = buildReimbursementLinkDecision(
    { expectedAmount: 75, receivedAmount: 0 },
    { amount: 100, date: "2026-05-13" }
  );

  assert.equal(decision.appliedAmount, 75);
  assert.equal(decision.receivedAmount, 75);
  assert.equal(decision.outstandingAmount, 0);
  assert.equal(decision.status, "received");
});

test("buildReimbursementLinkDecision validates positive inflows and applied amount", () => {
  assert.throws(
    () => buildReimbursementLinkDecision({ expectedAmount: 75, receivedAmount: 0 }, { amount: -25, date: "2026-05-12" }),
    /positive inflow/
  );
  assert.throws(
    () => buildReimbursementLinkDecision(
      { expectedAmount: 75, receivedAmount: 0 },
      { amount: 25, date: "2026-05-12" },
      { appliedAmount: 30 }
    ),
    /received inflow/
  );
  assert.throws(
    () => buildReimbursementLinkDecision(
      { expectedAmount: 75, receivedAmount: 0 },
      { amount: 100, date: "2026-05-12" },
      { appliedAmount: 80 }
    ),
    /outstanding reimbursement amount/
  );
  assert.throws(
    () => buildReimbursementLinkDecision(
      { expectedAmount: 75, receivedAmount: 25 },
      { amount: 75, date: "2026-05-12" },
      { appliedAmount: 75 }
    ),
    /outstanding/
  );
  assert.throws(
    () => buildReimbursementLinkDecision({ expectedAmount: 75, receivedAmount: 75 }, { amount: 25, date: "2026-05-12" }),
    /fully received/
  );
});

test("isReportableIncomeIntent excludes transfers and linked reimbursements from income", () => {
  assert.equal(isReportableIncomeIntent("personal"), true);
  assert.equal(isReportableIncomeIntent("business"), true);
  assert.equal(isReportableIncomeIntent("shared"), true);
  assert.equal(isReportableIncomeIntent("transfer"), false);
  assert.equal(isReportableIncomeIntent("reimbursable"), false);
});
