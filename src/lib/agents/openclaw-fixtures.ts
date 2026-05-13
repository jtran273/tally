import type { AgentProposalRecord } from "@/lib/db";
import { buildOpenClawSignalsResponse } from "@/lib/openclaw/signals";
import type { OpenClawReplyResponse } from "@/lib/openclaw/types";
import { buildWeeklyPlanningContext } from "./weekly-planning-context";

const generatedAt = "2026-05-13T12:00:00.000Z";
const proposalId = "33333333-3333-4333-8333-333333333333";

const clarificationProposal: AgentProposalRecord = {
  acceptedAt: null,
  answeredAt: null,
  clarificationAnswer: null,
  clarificationAnswerKind: null,
  clarificationQuestion: "Was $48.00 of Taco Guild on 2026-05-10 Ryan's share to reimburse?",
  confidence: 0.74,
  createdAt: "2026-05-13T11:30:00.000Z",
  dismissedAt: null,
  evidence: {
    candidate: {
      amount: -96,
      date: "2026-05-10",
      merchant: "Taco Guild"
    },
    reason: "Dinner charge followed by same-day peer payment."
  },
  expiresAt: null,
  id: proposalId,
  proposalType: "reimbursement_candidate",
  proposedPatch: {
    suggestedCounterparty: "Ryan",
    suggestedIntent: "reimbursable"
  },
  questionFingerprint: "merchant-date-counterparty-window",
  sourceAgent: "ledger-reimbursement-clarification-flow",
  sourceCandidateId: "candidate-123",
  sourceContextId: null,
  status: "pending",
  targetId: "tx-dinner",
  targetKind: "enriched_transaction",
  updatedAt: "2026-05-13T11:30:00.000Z",
  userId: "fixture-user"
};

export const openClawSignalsFixture = buildOpenClawSignalsResponse({
  generatedAt,
  openClarificationProposals: [clarificationProposal],
  pendingProposals: [clarificationProposal],
  since: "2026-05-12T12:00:00.000Z",
  weeklyPlanningContext: buildWeeklyPlanningContext({
    generatedAt,
    now: new Date(generatedAt),
    transactions: []
  })
});

export const openClawReplyFixture: OpenClawReplyResponse = {
  answer_kind: "counterparty",
  applied_patch: {
    counterparties: ["Ryan"],
    suggestedCounterparty: "Ryan",
    suggestedIntent: "reimbursable"
  },
  proposal_id: proposalId,
  status: "answered"
};
