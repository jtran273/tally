import { assertAgentProposalPayloadSafe, isAgentProposalExpired } from "@/lib/agents";
import type { AgentProposalRecord, Json, ReimbursementRecord, TransactionRecord } from "@/lib/db";
import {
  createAgentProposal,
  type AgentProposalMutationInput,
  type FinanceSupabaseClient,
  listAgentProposals,
  upsertAgentProposalBySourceContext
} from "@/lib/db/queries";
import {
  suggestReimbursementMatches,
  type ReimbursementMatchExpense,
  type ReimbursementMatchInflow,
  type ReimbursementMatchSuggestion
} from "@/lib/finance/reimbursement-matching";

export interface PersistReimbursementMatchProposalInput {
  existingProposals?: readonly AgentProposalRecord[];
  expiresAt?: string | null;
  inflows: readonly TransactionRecord[];
  maxProposals?: number;
  minScore?: number;
  now?: Date;
  transactions: readonly TransactionRecord[];
}

export interface ReimbursementMatchProposalDetection {
  evidence: Json;
  expense: ReimbursementMatchExpense;
  inflow: ReimbursementMatchInflow;
  proposal: AgentProposalMutationInput;
  proposedPatch: Json;
  reimbursement: ReimbursementRecord;
  suggestion: ReimbursementMatchSuggestion;
}

const SOURCE_AGENT = "ledger-reimbursement-match-suggester";
const DEFAULT_MIN_SCORE = 50;
const DEFAULT_MAX_PROPOSALS = 20;
const ACTIVE_PROPOSAL_STATUSES = new Set(["pending", "answered", "accepted", "dismissed"]);

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundConfidence(value: number) {
  return Math.round(value * 100) / 100;
}

function safeJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function outstandingAmount(record: ReimbursementRecord) {
  return roundMoney(Math.max(0, record.expectedAmount - record.receivedAmount));
}

function openReimbursementRecords(transaction: TransactionRecord) {
  return transaction.reimbursements.filter((record) =>
    (record.status === "expected" || record.status === "requested") &&
    !record.receivedTransactionId &&
    outstandingAmount(record) > 0
  );
}

function toMatchExpense(transaction: TransactionRecord): ReimbursementMatchExpense | null {
  const openRecords = openReimbursementRecords(transaction);
  if (openRecords.length === 0) return null;

  return {
    amount: transaction.amount,
    category: transaction.category,
    date: transaction.date,
    id: transaction.id,
    intent: transaction.intent,
    merchant: transaction.merchant,
    reimbursements: openRecords,
    splits: transaction.splits
  };
}

function toMatchInflow(
  transaction: TransactionRecord,
  linkedReceivedTransactionIds: ReadonlySet<string>
): ReimbursementMatchInflow {
  return {
    alreadyLinked: linkedReceivedTransactionIds.has(transaction.id),
    amount: roundMoney(transaction.amount),
    category: transaction.category,
    date: transaction.date,
    id: transaction.id,
    intent: transaction.intent,
    merchant: transaction.merchant,
    note: transaction.note,
    status: transaction.status
  };
}

function reimbursementForSuggestion(
  expense: ReimbursementMatchExpense,
  suggestion: ReimbursementMatchSuggestion
) {
  return [...expense.reimbursements]
    .filter((record) => !record.receivedTransactionId && outstandingAmount(record) > 0)
    .sort((left, right) =>
      Math.abs(outstandingAmount(left) - suggestion.matchedAmount) -
        Math.abs(outstandingAmount(right) - suggestion.matchedAmount) ||
      left.id.localeCompare(right.id)
    )[0] ?? null;
}

function stableSourceContextId(reimbursementId: string, inflowId: string) {
  return `reimbursement-match:${reimbursementId}:${inflowId}`;
}

function hasExistingActiveProposal(
  reimbursementId: string,
  inflowId: string,
  existingProposals: readonly AgentProposalRecord[],
  now: Date
) {
  const sourceContextId = stableSourceContextId(reimbursementId, inflowId);
  return existingProposals.some((proposal) =>
    proposal.sourceAgent === SOURCE_AGENT &&
    proposal.sourceContextId === sourceContextId &&
    proposal.proposalType === "reimbursement_match" &&
    ACTIVE_PROPOSAL_STATUSES.has(proposal.status) &&
    !isAgentProposalExpired(proposal, now)
  );
}

function buildDetection(
  expense: ReimbursementMatchExpense,
  inflow: ReimbursementMatchInflow,
  reimbursement: ReimbursementRecord,
  suggestion: ReimbursementMatchSuggestion,
  expiresAt: string | null | undefined
): ReimbursementMatchProposalDetection {
  const sourceContextId = stableSourceContextId(reimbursement.id, inflow.id);
  const expectedAmount = outstandingAmount(reimbursement);
  const evidence = safeJson({
    actions: ["link", "mark_unmatched", "dismiss"],
    expense: {
      amount: roundMoney(expense.amount),
      category: expense.category,
      date: expense.date,
      id: expense.id,
      merchant: expense.merchant
    },
    inflow: {
      amount: inflow.amount,
      category: inflow.category,
      date: inflow.date,
      id: inflow.id,
      merchant: inflow.merchant
    },
    ranking: {
      confidence: suggestion.confidence,
      reasons: suggestion.reasons,
      score: suggestion.score,
      unmatchedAmount: suggestion.unmatchedAmount
    },
    reimbursement: {
      counterparty: reimbursement.counterparty,
      expectedAmount,
      id: reimbursement.id,
      status: reimbursement.status
    }
  });
  const proposedPatch = safeJson({
    actionOptions: ["link", "mark_unmatched", "dismiss"],
    matchAmount: Math.min(suggestion.matchedAmount, expectedAmount),
    receivedTransactionId: inflow.id,
    reimbursementRecordId: reimbursement.id
  });

  assertAgentProposalPayloadSafe(evidence, proposedPatch);

  return {
    evidence,
    expense,
    inflow,
    proposal: {
      confidence: roundConfidence(suggestion.score / 100),
      evidence,
      expiresAt: expiresAt ?? null,
      proposedPatch,
      proposalType: "reimbursement_match",
      questionFingerprint: sourceContextId,
      sourceAgent: SOURCE_AGENT,
      sourceCandidateId: `${suggestion.expenseId}:${suggestion.inflowIds.join(",")}`,
      sourceContextId,
      targetId: reimbursement.id,
      targetKind: "reimbursement_record"
    },
    proposedPatch,
    reimbursement,
    suggestion
  };
}

export function detectReimbursementMatchProposals({
  existingProposals = [],
  expiresAt,
  inflows,
  maxProposals = DEFAULT_MAX_PROPOSALS,
  minScore = DEFAULT_MIN_SCORE,
  now = new Date(),
  transactions
}: PersistReimbursementMatchProposalInput): ReimbursementMatchProposalDetection[] {
  const expenses = transactions
    .map(toMatchExpense)
    .filter((expense): expense is ReimbursementMatchExpense => expense !== null);
  const linkedReceivedTransactionIds = new Set(
    transactions
      .flatMap((transaction) => transaction.reimbursements)
      .map((record) => record.receivedTransactionId)
      .filter((id): id is string => Boolean(id))
  );
  const candidateInflows = inflows.map((inflow) => toMatchInflow(inflow, linkedReceivedTransactionIds));
  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
  const inflowById = new Map(candidateInflows.map((inflow) => [inflow.id, inflow]));

  return suggestReimbursementMatches(expenses, candidateInflows, {
    maxCombinationSize: 1
  })
    .filter((suggestion) => suggestion.score >= minScore && suggestion.inflowIds.length === 1)
    .map((suggestion) => {
      const expense = expenseById.get(suggestion.expenseId);
      const inflow = inflowById.get(suggestion.inflowIds[0]);
      if (!expense || !inflow) return null;
      const reimbursement = reimbursementForSuggestion(expense, suggestion);
      if (!reimbursement) return null;
      if (hasExistingActiveProposal(reimbursement.id, inflow.id, existingProposals, now)) return null;
      return buildDetection(expense, inflow, reimbursement, suggestion, expiresAt);
    })
    .filter((detection): detection is ReimbursementMatchProposalDetection => detection !== null)
    .sort((left, right) =>
      (right.proposal.confidence ?? 0) - (left.proposal.confidence ?? 0) ||
      left.reimbursement.id.localeCompare(right.reimbursement.id) ||
      left.inflow.id.localeCompare(right.inflow.id)
    )
    .slice(0, maxProposals);
}

export async function createReimbursementMatchProposals(
  client: FinanceSupabaseClient,
  userId: string,
  input: PersistReimbursementMatchProposalInput
): Promise<AgentProposalRecord[]> {
  const existingProposals = input.existingProposals ?? await listAgentProposals(client, userId, {
    includeExpired: true,
    status: "all"
  });
  const detections = detectReimbursementMatchProposals({
    ...input,
    existingProposals
  });

  const created: AgentProposalRecord[] = [];
  for (const detection of detections) {
    created.push(detection.proposal.sourceContextId
      ? await upsertAgentProposalBySourceContext(client, userId, detection.proposal)
      : await createAgentProposal(client, userId, detection.proposal));
  }
  return created;
}
