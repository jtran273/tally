import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentProposalRecord, ReimbursementRecord, TransactionRecord } from "@/lib/db";
import { detectReimbursementMatchProposals } from "./reimbursement-match-proposals";

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
    splitId: null,
    status: "expected",
    transactionId: "expense-1",
    ...input
  };
}

function transaction(input: Pick<TransactionRecord, "amount" | "date" | "id" | "merchant"> & Partial<TransactionRecord>): TransactionRecord {
  return {
    accountId: "account-checking",
    accountMask: null,
    accountName: "Checking",
    category: "Food / Restaurants",
    categoryId: "category-food",
    confidence: 0.93,
    institutionName: "Seed Bank",
    intent: input.amount < 0 ? "shared" : "personal",
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

function existingProposal(input: Partial<AgentProposalRecord> = {}): AgentProposalRecord {
  return {
    acceptedAt: null,
    answeredAt: null,
    clarificationAnswer: null,
    clarificationAnswerKind: null,
    clarificationQuestion: null,
    confidence: 0.88,
    createdAt: "2026-05-14T12:00:00.000Z",
    dismissedAt: null,
    evidence: {},
    expiresAt: null,
    id: "proposal-1",
    proposalType: "reimbursement_match",
    proposedPatch: {},
    questionFingerprint: "reimbursement-match:reimbursement-1:inflow-1",
    sourceAgent: "ledger-reimbursement-match-suggester",
    sourceCandidateId: null,
    sourceContextId: "reimbursement-match:reimbursement-1:inflow-1",
    status: "pending",
    targetId: "reimbursement-1",
    targetKind: "reimbursement_record",
    updatedAt: "2026-05-14T12:00:00.000Z",
    userId: "user-1",
    ...input
  };
}

test("detectReimbursementMatchProposals creates a pending exact match proposal", () => {
  const detections = detectReimbursementMatchProposals({
    inflows: [transaction({ amount: 75, date: "2026-05-15", id: "inflow-1", merchant: "Venmo - Chris" })],
    transactions: [transaction({
      amount: -121.35,
      date: "2026-05-14",
      id: "expense-1",
      merchant: "Dinner Spot",
      reimbursements: [reimbursement()]
    })]
  });

  assert.equal(detections.length, 1);
  assert.equal(detections[0].proposal.proposalType, "reimbursement_match");
  assert.equal(detections[0].proposal.targetKind, "reimbursement_record");
  assert.equal(detections[0].proposal.targetId, "reimbursement-1");
  assert.deepEqual(detections[0].proposal.proposedPatch, {
    actionOptions: ["link", "mark_unmatched", "dismiss"],
    matchAmount: 75,
    receivedTransactionId: "inflow-1",
    reimbursementRecordId: "reimbursement-1"
  });
  assert.ok((detections[0].proposal.confidence ?? 0) >= 0.9);
});

test("detectReimbursementMatchProposals keeps partial matches as confirmation-required proposals", () => {
  const [detection] = detectReimbursementMatchProposals({
    inflows: [transaction({ amount: 40, date: "2026-05-15", id: "inflow-1", merchant: "Zelle payment from Chris" })],
    transactions: [transaction({
      amount: -121.35,
      date: "2026-05-14",
      id: "expense-1",
      merchant: "Dinner Spot",
      reimbursements: [reimbursement()]
    })]
  });

  assert.equal(detection.proposedPatch, detection.proposal.proposedPatch);
  assert.equal(detection.suggestion.confidence, "medium");
  assert.equal(detection.proposal.proposedPatch && typeof detection.proposal.proposedPatch === "object" && !Array.isArray(detection.proposal.proposedPatch)
    ? detection.proposal.proposedPatch.matchAmount
    : null, 40);
  assert.match(detection.suggestion.reasons.join(" "), /partial reimbursement/);
});

test("detectReimbursementMatchProposals surfaces ambiguous matches without auto-selecting one write", () => {
  const detections = detectReimbursementMatchProposals({
    inflows: [
      transaction({ amount: 75, date: "2026-05-15", id: "inflow-1", merchant: "Venmo - Chris" }),
      transaction({ amount: 75, date: "2026-05-16", id: "inflow-2", merchant: "PayPal Transfer" })
    ],
    transactions: [transaction({
      amount: -121.35,
      date: "2026-05-14",
      id: "expense-1",
      merchant: "Dinner Spot",
      reimbursements: [reimbursement()]
    })]
  });

  assert.equal(detections.length, 2);
  assert.deepEqual(detections.map((detection) => detection.inflow.id), ["inflow-1", "inflow-2"]);
  assert.ok(detections.every((detection) =>
    detection.proposal.proposedPatch &&
    typeof detection.proposal.proposedPatch === "object" &&
    !Array.isArray(detection.proposal.proposedPatch) &&
    detection.proposal.proposedPatch.actionOptions instanceof Array
  ));
});

test("detectReimbursementMatchProposals skips duplicate active match proposals", () => {
  const detections = detectReimbursementMatchProposals({
    existingProposals: [existingProposal()],
    inflows: [transaction({ amount: 75, date: "2026-05-15", id: "inflow-1", merchant: "Venmo - Chris" })],
    transactions: [transaction({
      amount: -121.35,
      date: "2026-05-14",
      id: "expense-1",
      merchant: "Dinner Spot",
      reimbursements: [reimbursement()]
    })]
  });

  assert.deepEqual(detections, []);
});
