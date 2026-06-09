import type { TransactionSuggestionService } from "@/lib/ai/suggestion-service";
import type {
  ReimbursementCandidateAiRequest,
  ReimbursementCandidateAiSuggestion,
  ReimbursementCandidateHistoricalPattern,
  ReimbursementCandidateSafeInflow,
  ReimbursementCandidateSafeTransaction
} from "@/lib/ai/types";
import { assertAgentProposalPayloadSafe, isAgentProposalExpired } from "@/lib/agents";
import type { AgentProposalRecord, Json, TransactionRecord } from "@/lib/db";
import {
  createAgentProposal,
  type AgentProposalMutationInput,
  type FinanceSupabaseClient,
  listAgentProposals,
  upsertAgentProposalBySourceContext
} from "@/lib/db/queries";
import { clamp } from "@/lib/util/clamp";

export interface ReimbursementCandidateDetectorOptions {
  cacheKey?: string;
  existingProposals?: readonly AgentProposalRecord[];
  expiresAt?: string | null;
  historicalPatterns?: readonly ReimbursementCandidateHistoricalPattern[];
  maxAiConcurrency?: number;
  maxCandidates?: number;
  minAiConfidence?: number;
  now?: Date;
  suggestionService: Pick<TransactionSuggestionService, "suggestReimbursementCandidate">;
}

export interface ReimbursementCandidateDetectionInput extends ReimbursementCandidateDetectorOptions {
  inflows: readonly TransactionRecord[];
  transactions: readonly TransactionRecord[];
}

export interface ReimbursementCandidateDetection {
  aiSuggestion: ReimbursementCandidateAiSuggestion;
  candidateInflows: ReimbursementCandidateSafeInflow[];
  evidence: Json;
  proposal: AgentProposalMutationInput;
  proposedPatch: Json;
  transaction: ReimbursementCandidateSafeTransaction;
}

export interface PersistReimbursementCandidateInput extends ReimbursementCandidateDetectorOptions {
  inflows: readonly TransactionRecord[];
  transactions: readonly TransactionRecord[];
}

export interface ReimbursementCandidateHeuristic {
  candidateInflows: ReimbursementCandidateSafeInflow[];
  confidence: number;
  reasons: string[];
  score: number;
  transaction: ReimbursementCandidateSafeTransaction;
}

const SOURCE_AGENT = "ledger-reimbursement-candidate-detector";
const DEFAULT_MAX_CANDIDATES = 12;
const DEFAULT_MAX_AI_CONCURRENCY = 4;
const DEFAULT_MIN_AI_CONFIDENCE = 0.55;
const ACTIVE_PROPOSAL_STATUSES = new Set(["pending", "answered", "accepted", "dismissed"]);
const PEER_PAYMENT_PATTERN = /\b(venmo|zelle|cash app|cashapp|paypal|apple cash)\b/i;
const TRUE_INCOME_PATTERN = /\b(payroll|salary|direct deposit|paycheck|interest|dividend|bonus|refund|cashback)\b/i;
const SHARED_CATEGORY_PATTERN = /\b(food|restaurant|dining|event|entertainment|travel|hotel|flight|airfare|rent|housing|utilities)\b/i;
const MONEY_EPSILON = 0.01;

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundConfidence(value: number) {
  return Math.round(value * 100) / 100;
}

function daysBetween(left: string, right: string) {
  const leftDate = Date.parse(`${left}T12:00:00.000Z`);
  const rightDate = Date.parse(`${right}T12:00:00.000Z`);
  if (!Number.isFinite(leftDate) || !Number.isFinite(rightDate)) return Number.POSITIVE_INFINITY;
  return Math.round((rightDate - leftDate) / 86_400_000);
}

function amountThreshold(category: string) {
  if (/\b(rent|housing|utilities)\b/i.test(category)) return 200;
  if (/\b(travel|hotel|flight|airfare)\b/i.test(category)) return 100;
  if (/\b(food|restaurant|dining|event|entertainment)\b/i.test(category)) return 40;
  return 75;
}

function safeTransaction(transaction: TransactionRecord): ReimbursementCandidateSafeTransaction {
  return {
    id: transaction.id,
    date: transaction.date,
    merchant: transaction.merchant,
    amount: roundMoney(transaction.amount),
    category: transaction.category,
    intent: transaction.intent
  };
}

function safeInflow(transaction: TransactionRecord): ReimbursementCandidateSafeInflow {
  return {
    id: transaction.id,
    date: transaction.date,
    merchant: transaction.merchant,
    amount: roundMoney(transaction.amount),
    category: transaction.category
  };
}

function hasOpenOrReceivedReimbursement(transaction: TransactionRecord) {
  return transaction.reimbursements.some((reimbursement) =>
    reimbursement.status === "expected" ||
    reimbursement.status === "requested" ||
    reimbursement.status === "received"
  );
}

function isEligibleExpense(transaction: TransactionRecord) {
  if (transaction.amount >= -MONEY_EPSILON) return false;
  if (transaction.intent !== "personal") return false;
  if (transaction.status === "pending") return false;
  if (transaction.recurring) return false;
  if (transaction.splits.length > 0 || hasOpenOrReceivedReimbursement(transaction)) return false;
  return Math.abs(transaction.amount) >= amountThreshold(transaction.category);
}

function isPeerPaymentInflow(transaction: Pick<TransactionRecord, "merchant" | "note">) {
  return PEER_PAYMENT_PATTERN.test(`${transaction.merchant} ${transaction.note ?? ""}`);
}

function isCandidateInflow(transaction: TransactionRecord) {
  if (transaction.amount <= MONEY_EPSILON) return false;
  if (transaction.status === "pending") return false;
  if (transaction.intent === "reimbursable") return false;

  // A Venmo/Zelle/Cash App/PayPal deposit into checking is the clearest
  // reimbursement tell, so keep it even when the bank auto-tagged it as a
  // transfer or the deposit description looks like ordinary income. Without
  // this, real peer reimbursements get filtered out before scoring (the
  // "no strong peer-payment inflow" case on mismatched proposals).
  if (isPeerPaymentInflow(transaction)) return true;

  if (transaction.intent === "transfer") return false;
  if (/\bincome\b/i.test(transaction.category)) return false;
  if (TRUE_INCOME_PATTERN.test(`${transaction.merchant} ${transaction.category}`)) return false;
  return true;
}

function inflowScore(expense: TransactionRecord, inflow: TransactionRecord) {
  const days = daysBetween(expense.date, inflow.date);
  if (days < -2 || days > 45) return 0;

  const amount = Math.abs(expense.amount);
  const ratio = inflow.amount / amount;
  const isPeerPayment = isPeerPaymentInflow(inflow);
  const amountScore = ratio >= 0.2 && ratio <= 1.1 ? 20 : ratio > 1.1 && ratio <= 1.35 ? 8 : 0;

  // Amount plausibility gate. A peer payment is itself strong evidence, so
  // accept a partial split (a friend covering their share, down to ~5% of the
  // bill) while still rejecting peer deposits that dwarf the expense. A
  // non-peer inflow must plausibly cover the charge: a $32 refund against a
  // $1,600 stay is not a reimbursement, no matter how close in time it lands.
  if (isPeerPayment) {
    if (ratio < 0.05 || ratio > 1.5) return 0;
  } else if (amountScore === 0) {
    return 0;
  }

  const timingScore = days >= 0 && days <= 14 ? 22 : days >= 15 && days <= 45 ? 12 : 5;
  const peerScore = isPeerPayment ? 24 : 0;
  return amountScore + timingScore + peerScore;
}

function nearbyInflows(expense: TransactionRecord, inflows: readonly TransactionRecord[]) {
  return inflows
    .filter(isCandidateInflow)
    .map((inflow) => ({ inflow, score: inflowScore(expense, inflow) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      Math.abs(daysBetween(expense.date, left.inflow.date)) - Math.abs(daysBetween(expense.date, right.inflow.date)) ||
      left.inflow.id.localeCompare(right.inflow.id)
    )
    .slice(0, 5)
    .map(({ inflow }) => safeInflow(inflow));
}

function categoryScore(category: string) {
  if (/\b(travel|hotel|flight|airfare|rent|housing|utilities)\b/i.test(category)) return 24;
  if (/\b(food|restaurant|dining|event|entertainment)\b/i.test(category)) return 18;
  return 6;
}

function buildHeuristicCandidate(
  transaction: TransactionRecord,
  inflows: readonly TransactionRecord[],
  historicalPatterns: readonly ReimbursementCandidateHistoricalPattern[]
): ReimbursementCandidateHeuristic | null {
  if (!isEligibleExpense(transaction)) return null;

  const candidateInflows = nearbyInflows(transaction, inflows);
  const amount = Math.abs(transaction.amount);
  const reasons: string[] = [];
  let score = categoryScore(transaction.category);

  if (SHARED_CATEGORY_PATTERN.test(transaction.category)) {
    reasons.push("Expense category commonly appears in shared reimbursement workflows.");
  }
  if (amount >= amountThreshold(transaction.category) * 2) {
    score += 12;
    reasons.push("Expense amount is high enough to merit reimbursement review.");
  }
  if (candidateInflows.length > 0) {
    score += candidateInflows.some((inflow) => PEER_PAYMENT_PATTERN.test(inflow.merchant)) ? 36 : 18;
    reasons.push("Nearby positive inflow could be a reimbursement.");
  }

  const historicalMatch = historicalPatterns.find((pattern) =>
    (pattern.merchant && transaction.merchant.toLowerCase().includes(pattern.merchant.toLowerCase())) ||
    (pattern.category && transaction.category.toLowerCase() === pattern.category.toLowerCase())
  );
  if (historicalMatch) {
    score += 8;
    reasons.push("User history has a similar reimbursement pattern.");
  }

  if (score < 36) return null;

  return {
    candidateInflows,
    confidence: roundConfidence(clamp(score / 100, 0.35, 0.86)),
    reasons,
    score,
    transaction: safeTransaction(transaction)
  };
}

function hasExistingActiveProposal(transactionId: string, existingProposals: readonly AgentProposalRecord[], now: Date) {
  return existingProposals.some((proposal) =>
    proposal.targetKind === "enriched_transaction" &&
    proposal.targetId === transactionId &&
    (proposal.proposalType === "reimbursement_candidate" || proposal.proposalType === "clarification_request") &&
    ACTIVE_PROPOSAL_STATUSES.has(proposal.status) &&
    !isAgentProposalExpired(proposal, now)
  );
}

function stableFingerprint(candidate: Pick<ReimbursementCandidateHeuristic, "candidateInflows" | "transaction">) {
  const inflowIds = candidate.candidateInflows.map((inflow) => inflow.id).sort().join(",");
  return `reimbursement-candidate:${candidate.transaction.id}:${inflowIds || "no-inflow"}`;
}

function stableSourceContextId(candidate: Pick<ReimbursementCandidateHeuristic, "transaction">) {
  return `reimbursement-candidate:${candidate.transaction.id}`;
}

function safeJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function buildAiRequest(
  candidate: ReimbursementCandidateHeuristic,
  options: Pick<ReimbursementCandidateDetectorOptions, "cacheKey" | "historicalPatterns">
): ReimbursementCandidateAiRequest {
  return {
    cacheKey: options.cacheKey,
    candidateInflows: candidate.candidateInflows,
    heuristicConfidence: candidate.confidence,
    heuristicReasons: candidate.reasons,
    historicalPatterns: options.historicalPatterns,
    transaction: candidate.transaction
  };
}

function normalizeAiSuggestionForCandidate(
  candidate: ReimbursementCandidateHeuristic,
  aiSuggestion: ReimbursementCandidateAiSuggestion
): ReimbursementCandidateAiSuggestion {
  if (aiSuggestion.targetTransactionId !== candidate.transaction.id) {
    throw new Error("Reimbursement candidate suggestion target does not match the candidate transaction.");
  }

  const allowedInflowIds = new Set(candidate.candidateInflows.map((inflow) => inflow.id));
  const seen = new Set<string>();
  const suggestedInflowIds = aiSuggestion.suggestedInflowIds.filter((id) => {
    if (!allowedInflowIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return {
    ...aiSuggestion,
    suggestedInflowIds
  };
}

function buildDetection(
  candidate: ReimbursementCandidateHeuristic,
  aiSuggestion: ReimbursementCandidateAiSuggestion,
  expiresAt: string | null | undefined
): ReimbursementCandidateDetection {
  const normalizedSuggestion = normalizeAiSuggestionForCandidate(candidate, aiSuggestion);
  const evidence = safeJson({
    aiProvider: normalizedSuggestion.provider,
    candidateInflows: candidate.candidateInflows,
    heuristicConfidence: candidate.confidence,
    heuristicReasons: candidate.reasons,
    question: normalizedSuggestion.question,
    signals: normalizedSuggestion.signals,
    transaction: candidate.transaction
  });
  const proposedPatch = safeJson({
    question: normalizedSuggestion.question,
    reason: normalizedSuggestion.reason,
    suggestedInflowIds: normalizedSuggestion.suggestedInflowIds,
    suggestedIntent: normalizedSuggestion.suggestedIntent
  });

  assertAgentProposalPayloadSafe(evidence, proposedPatch);

  return {
    aiSuggestion: normalizedSuggestion,
    candidateInflows: candidate.candidateInflows,
    evidence,
    proposal: {
      clarificationQuestion: normalizedSuggestion.question,
      confidence: normalizedSuggestion.confidence,
      evidence,
      expiresAt: expiresAt ?? null,
      proposedPatch,
      proposalType: "reimbursement_candidate",
      questionFingerprint: stableFingerprint(candidate),
      sourceAgent: SOURCE_AGENT,
      sourceCandidateId: normalizedSuggestion.suggestionId,
      sourceContextId: stableSourceContextId(candidate),
      targetId: candidate.transaction.id,
      targetKind: "enriched_transaction"
    },
    proposedPatch,
    transaction: candidate.transaction
  };
}

function normalizeConcurrency(value: number | undefined) {
  if (value === undefined) return DEFAULT_MAX_AI_CONCURRENCY;
  if (!Number.isFinite(value)) return DEFAULT_MAX_AI_CONCURRENCY;
  return Math.max(1, Math.floor(value));
}

async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  worker: (item: TItem) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) return [];

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }));

  return results;
}

export function prefilterReimbursementCandidates(
  transactions: readonly TransactionRecord[],
  inflows: readonly TransactionRecord[],
  options: Pick<ReimbursementCandidateDetectorOptions, "existingProposals" | "historicalPatterns" | "maxCandidates" | "now"> = {}
): ReimbursementCandidateHeuristic[] {
  const existingProposals = options.existingProposals ?? [];
  const historicalPatterns = options.historicalPatterns ?? [];
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const now = options.now ?? new Date();

  return transactions
    .filter((transaction) => !hasExistingActiveProposal(transaction.id, existingProposals, now))
    .map((transaction) => buildHeuristicCandidate(transaction, inflows, historicalPatterns))
    .filter((candidate): candidate is ReimbursementCandidateHeuristic => candidate !== null)
    .sort((left, right) =>
      right.score - left.score ||
      Math.abs(right.transaction.amount) - Math.abs(left.transaction.amount) ||
      left.transaction.id.localeCompare(right.transaction.id)
    )
    .slice(0, maxCandidates);
}

export async function detectReimbursementCandidateProposals({
  cacheKey,
  existingProposals,
  expiresAt,
  historicalPatterns,
  inflows,
  maxAiConcurrency,
  maxCandidates,
  minAiConfidence = DEFAULT_MIN_AI_CONFIDENCE,
  now,
  suggestionService,
  transactions
}: ReimbursementCandidateDetectionInput): Promise<ReimbursementCandidateDetection[]> {
  const candidates = prefilterReimbursementCandidates(transactions, inflows, {
    existingProposals,
    historicalPatterns,
    maxCandidates,
    now
  });
  const detections = await mapWithConcurrency(candidates, normalizeConcurrency(maxAiConcurrency), async (candidate) => {
    const request = buildAiRequest(candidate, { cacheKey, historicalPatterns });
    assertAgentProposalPayloadSafe(safeJson({ request }), {});

    const suggestion = await suggestionService.suggestReimbursementCandidate(request);
    return suggestion.confidence >= minAiConfidence ? buildDetection(candidate, suggestion, expiresAt) : null;
  });

  return detections
    .filter((detection): detection is ReimbursementCandidateDetection => detection !== null)
    .sort((left, right) =>
      right.aiSuggestion.confidence - left.aiSuggestion.confidence ||
      left.transaction.id.localeCompare(right.transaction.id)
    );
}

export async function createDetectedReimbursementCandidateProposals(
  client: FinanceSupabaseClient,
  userId: string,
  input: PersistReimbursementCandidateInput
): Promise<AgentProposalRecord[]> {
  const existingProposals = input.existingProposals ?? await listAgentProposals(client, userId, {
    includeExpired: true,
    status: "all"
  });
  const detections = await detectReimbursementCandidateProposals({
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
