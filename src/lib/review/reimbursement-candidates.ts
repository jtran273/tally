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

// --- Match-quality tuning constants -----------------------------------------
// Reimbursements normally arrive AFTER the expense within a short window. A
// small negative tolerance covers a friend pre-paying a day or two before the
// charge actually posts. Anything past ~2 weeks is almost never a genuine peer
// reimbursement (the old +45-day window let a 32-day-stale merchant refund
// slip through).
const MIN_DAYS_BEFORE_EXPENSE = -3;
const MAX_DAYS_AFTER_EXPENSE = 14;
const STRONG_TIMING_DAYS = 7;

// Amount fit: you can't be repaid more than you paid (plus a little tip
// tolerance), and a sliver of the bill (a $32 inflow against a $1,600 stay) is
// not a reimbursement. Clean even splits (½, ⅓, ¼) are the common shared-bill
// shapes and are scored as strongly as a full repayment.
const MAX_AMOUNT_RATIO = 1.05;
const MIN_AMOUNT_RATIO = 0.18;
const AMOUNT_TOLERANCE = 0.08; // ±8% around the full amount or a clean split.
const CLEAN_SPLIT_DIVISORS = [1, 2, 3, 4] as const;

// Score weights. Confidence is derived from the same three signals so ranking
// reflects real match quality instead of a flat value.
const WEIGHT_AMOUNT = 0.5;
const WEIGHT_TIMING = 0.3;
const WEIGHT_PEER = 0.2;

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

  // Reimbursements are peer payments. Only Venmo / Zelle / Cash App / PayPal /
  // Apple Cash deposits count — this is the clearest reimbursement tell, and we
  // keep it even when the bank auto-tagged the deposit as a transfer or the
  // description looks like ordinary income (the most common reason a true match
  // is missed). We DROPPED the old branch that accepted arbitrary non-peer
  // positive inflows: that is what let merchant refunds like a stale
  // "Ticketmaster +$187" masquerade as a roommate paying you back.
  if (!isPeerPaymentInflow(transaction)) return false;

  // Even a peer-payment description shouldn't override an explicit true-income
  // signal (e.g. a deposit miscategorised as Income/payroll).
  if (/\bincome\b/i.test(transaction.category)) return false;
  if (TRUE_INCOME_PATTERN.test(`${transaction.merchant} ${transaction.category}`)) return false;
  return true;
}

interface AmountFit {
  /** 0..1, how well the bundle total fits the expense (full repay or clean split). */
  score: number;
  /** Which clean-split divisor (1 = full, 2 = half, …) the total best fits, if any. */
  divisor: number | null;
  /** True when the total lands on a clean full-repay or even split. */
  clean: boolean;
}

const NO_FIT: AmountFit = { score: 0, divisor: null, clean: false };

// Score how well an inflow (or summed bundle) total fits an expense. The total
// must be plausible: at least a meaningful fraction of the bill (so a $32 inflow
// vs a $1,600 stay scores 0) and no more than the bill plus a small tip.
//
//  - A clean full repay OR a clean even split (½, ⅓, ¼) within tolerance scores
//    near the top (these are the canonical shared-bill shapes).
//  - Any other plausible partial — a friend covering an uneven share, e.g.
//    $44 of a $67 dinner — still matches, but at a lower score so clean fits and
//    full repays win when both are available.
function amountFit(expenseAmount: number, total: number): AmountFit {
  const ratio = total / expenseAmount;
  if (ratio > MAX_AMOUNT_RATIO || ratio < MIN_AMOUNT_RATIO) return NO_FIT;

  for (const divisor of CLEAN_SPLIT_DIVISORS) {
    const target = expenseAmount / divisor;
    const relativeError = Math.abs(total - target) / target;
    if (relativeError > AMOUNT_TOLERANCE) continue;
    // Closer to the clean target => higher; a tight full-repay (÷1) and a tight
    // even split both top out near 1, but a full repay edges out a split.
    const fit = (1 - relativeError / AMOUNT_TOLERANCE) * (divisor === 1 ? 1 : 0.92);
    return { score: Math.max(fit, 0.8), divisor, clean: true };
  }

  // Plausible-but-uneven partial. Score by how much of the bill it covers,
  // capped below the clean-fit floor so clean matches always rank higher.
  const coverage = Math.min(ratio, 1);
  return { score: 0.3 + 0.45 * coverage, divisor: null, clean: false };
}

// Continuous date proximity score in [0, 1]: closer is higher, strongly
// preferring same-week arrivals, 0 outside the window.
function timingFit(daysAfterExpense: number): number {
  if (daysAfterExpense < MIN_DAYS_BEFORE_EXPENSE || daysAfterExpense > MAX_DAYS_AFTER_EXPENSE) return 0;
  const distance = daysAfterExpense < 0 ? Math.abs(daysAfterExpense) : daysAfterExpense;
  if (distance <= STRONG_TIMING_DAYS) {
    // 1.0 same day, easing to ~0.7 at the edge of the strong window.
    return 1 - (distance / STRONG_TIMING_DAYS) * 0.3;
  }
  // Beyond the strong window, decay from ~0.7 down toward 0 at the hard edge.
  const span = MAX_DAYS_AFTER_EXPENSE - STRONG_TIMING_DAYS;
  return 0.7 * (1 - (distance - STRONG_TIMING_DAYS) / span);
}

// Extract a normalized counterparty name from a peer-payment description so two
// Venmos from the same person can be aggregated into one multi-transfer match.
function counterpartyKey(transaction: TransactionRecord): string {
  const text = `${transaction.merchant} ${transaction.note ?? ""}`;
  const cleaned = text
    .replace(PEER_PAYMENT_PATTERN, " ")
    .replace(/\b(payment|transfer|from|to|received|sent|deposit|inst|xfer|p2p|id)\b/gi, " ")
    .replace(/[^a-z\s]/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return cleaned || transaction.merchant.trim().toLowerCase();
}

interface CandidateMatch {
  expense: TransactionRecord;
  inflows: TransactionRecord[];
  inflowIds: string[];
  total: number;
  fit: AmountFit;
  timing: number;
  /** Combined match quality in [0, 1], used for both ranking and confidence. */
  quality: number;
}

// Build every plausible (expense -> inflow-bundle) match. For each expense we
// consider each in-window peer inflow on its own, and the SUM of all in-window
// inflows from a single counterparty (multi-transfer aggregation). Bundles with
// no amount fit or no timing fit are discarded.
function buildCandidateMatches(
  expense: TransactionRecord,
  candidateInflows: readonly TransactionRecord[]
): CandidateMatch[] {
  const expenseAmount = Math.abs(expense.amount);
  const inWindow = candidateInflows.filter((inflow) => {
    const days = daysBetween(expense.date, inflow.date);
    return days >= MIN_DAYS_BEFORE_EXPENSE && days <= MAX_DAYS_AFTER_EXPENSE;
  });

  const bundles: TransactionRecord[][] = [];

  // Single-inflow bundles.
  for (const inflow of inWindow) {
    bundles.push([inflow]);
  }

  // Multi-transfer bundles: same counterparty, 2+ inflows summed.
  const byCounterparty = new Map<string, TransactionRecord[]>();
  for (const inflow of inWindow) {
    const key = counterpartyKey(inflow);
    const list = byCounterparty.get(key) ?? [];
    list.push(inflow);
    byCounterparty.set(key, list);
  }
  for (const list of byCounterparty.values()) {
    if (list.length >= 2) bundles.push([...list]);
  }

  const matches: CandidateMatch[] = [];
  for (const inflows of bundles) {
    const total = roundMoney(inflows.reduce((sum, inflow) => sum + inflow.amount, 0));
    const fit = amountFit(expenseAmount, total);
    if (fit.score <= 0) continue;

    // Earliest inflow drives timing (when the repayment first started arriving).
    const earliestDate = inflows.reduce(
      (earliest, inflow) => (inflow.date < earliest ? inflow.date : earliest),
      inflows[0].date
    );
    const timing = timingFit(daysBetween(expense.date, earliestDate));
    if (timing <= 0) continue;

    // Every candidate inflow here is a peer payment by construction. A full
    // repay (the whole bill came back, possibly via several transfers) is the
    // strongest signal; a clean even split is next; an uneven partial is
    // weakest. This ordering lets a $100+$100 aggregation that fully repays a
    // $200 bill outrank the $100 half-split single it contains.
    const peer = fit.divisor === 1 ? 1 : fit.clean ? 0.85 : 0.7;
    const quality = WEIGHT_AMOUNT * fit.score + WEIGHT_TIMING * timing + WEIGHT_PEER * peer;

    matches.push({
      expense,
      inflows,
      inflowIds: inflows.map((inflow) => inflow.id),
      total,
      fit,
      timing,
      quality
    });
  }

  return matches;
}

function categoryScore(category: string) {
  if (/\b(travel|hotel|flight|airfare|rent|housing|utilities)\b/i.test(category)) return 24;
  if (/\b(food|restaurant|dining|event|entertainment)\b/i.test(category)) return 18;
  return 6;
}

// Greedy, globally-consistent 1:1 assignment. We score every plausible
// (expense -> inflow-bundle) match across ALL eligible expenses, then assign in
// descending quality order, skipping any match whose expense is already taken
// or whose inflows have already been consumed by a better match. This is what
// eliminates the old inflow-reuse bug, where one +$126 Venmo backed five
// different expenses at once.
function assignMatchesGlobally(
  expenses: readonly TransactionRecord[],
  candidateInflows: readonly TransactionRecord[]
): Map<string, CandidateMatch> {
  const allMatches = expenses.flatMap((expense) => buildCandidateMatches(expense, candidateInflows));
  allMatches.sort((left, right) =>
    right.quality - left.quality ||
    // Tie-break: a tighter amount fit, then a tighter timing, then stable ids so
    // the assignment is deterministic.
    right.fit.score - left.fit.score ||
    right.timing - left.timing ||
    left.expense.id.localeCompare(right.expense.id) ||
    left.inflowIds.join(",").localeCompare(right.inflowIds.join(","))
  );

  const assignedByExpense = new Map<string, CandidateMatch>();
  const consumedInflowIds = new Set<string>();

  for (const match of allMatches) {
    if (assignedByExpense.has(match.expense.id)) continue;
    if (match.inflowIds.some((id) => consumedInflowIds.has(id))) continue;
    assignedByExpense.set(match.expense.id, match);
    for (const id of match.inflowIds) consumedInflowIds.add(id);
  }

  return assignedByExpense;
}

function buildHeuristicCandidate(
  transaction: TransactionRecord,
  assignedMatch: CandidateMatch | undefined,
  historicalPatterns: readonly ReimbursementCandidateHistoricalPattern[]
): ReimbursementCandidateHeuristic | null {
  if (!isEligibleExpense(transaction)) return null;

  const candidateInflows = (assignedMatch?.inflows ?? []).map(safeInflow);
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

  // Match-quality drives the heuristic score AND the confidence so candidates
  // are ranked by how good the inflow match actually is, instead of a flat
  // ~0.62. `matchQuality` is in [0, 1]; with no assigned inflow it is 0.
  const matchQuality = assignedMatch?.quality ?? 0;
  if (assignedMatch) {
    score += Math.round(40 * matchQuality);
    if (assignedMatch.inflows.length > 1) {
      reasons.push(`${assignedMatch.inflows.length} peer payments from the same person add up to this expense.`);
    } else if (assignedMatch.fit.divisor && assignedMatch.fit.divisor > 1) {
      reasons.push(`Peer payment matches a clean 1/${assignedMatch.fit.divisor} split of this expense.`);
    } else {
      reasons.push("Peer payment closely matches this expense amount.");
    }
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

  // Confidence is derived from real match quality (date closeness + amount fit
  // + peer signal). A reviewable expense with no inflow still surfaces but at a
  // floor; a tight peer match lands near the ceiling.
  const baseConfidence = assignedMatch ? 0.45 + 0.5 * matchQuality : 0.4;

  return {
    candidateInflows,
    confidence: roundConfidence(clamp(baseConfidence, 0.35, 0.95)),
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

  // Only expenses without an active proposal can receive a fresh assignment, but
  // the global 1:1 assignment must run across all of them at once so a single
  // inflow can never back more than one expense.
  const reviewableExpenses = transactions.filter(
    (transaction) => !hasExistingActiveProposal(transaction.id, existingProposals, now) && isEligibleExpense(transaction)
  );
  const candidateInflows = inflows.filter(isCandidateInflow);
  const assignmentByExpense = assignMatchesGlobally(reviewableExpenses, candidateInflows);

  return reviewableExpenses
    .map((transaction) => buildHeuristicCandidate(transaction, assignmentByExpense.get(transaction.id), historicalPatterns))
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
