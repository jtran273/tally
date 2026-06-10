import type {
  AgentProposalRecord,
  Json,
  ReviewQueueItem,
  ReviewReason,
  TransactionIntent
} from "@/lib/db";
import { isJsonObject } from "@/lib/agents";
import { hasReviewSuggestionValue, normalizeReviewSuggestion } from "@/lib/review/suggestions";
import { isPeerToPeerReview } from "@/lib/review/reasons";
import { assertFinanceManifestSafe } from "./finance-action-manifest";

export type AgentInboxProposalStatus = "accept-ready" | "needs-review";
export type AgentInboxProposalAction =
  | "review-suggestion"
  | "manual-review"
  | "reimbursement-candidate"
  | "reimbursement-match";

interface BaseAgentInboxProposal {
  action: AgentInboxProposalAction;
  amount: number;
  category: string;
  confidence: number | null;
  createdAt: string;
  date: string;
  id: string;
  merchant: string;
  status: AgentInboxProposalStatus;
}

export interface ReviewAgentInboxProposal extends BaseAgentInboxProposal {
  action: "review-suggestion" | "manual-review";
  context: AgentInboxProposalContext;
  intent: TransactionIntent;
  reason: ReviewReason;
  recommendation: AgentInboxRecommendation;
  reviewItemId: string;
  transactionId: string;
}

export interface ReimbursementMatchAgentInboxProposal extends BaseAgentInboxProposal {
  action: "reimbursement-match";
  expense: {
    amount: number;
    category: string;
    date: string;
    id: string;
    merchant: string;
  };
  inflow: {
    amount: number;
    category: string;
    date: string;
    id: string;
    merchant: string;
  };
  matchAmount: number;
  proposalId: string;
  recommendation: {
    rationale: string;
    signals: string[];
  };
  reimbursement: {
    counterparty: string | null;
    expectedAmount: number;
    id: string;
    status: string;
  };
  unmatchedAmount: number;
}

export interface ReimbursementCandidateAgentInboxProposal extends BaseAgentInboxProposal {
  action: "reimbursement-candidate";
  candidateInflows: Array<{
    amount: number;
    category: string;
    date: string;
    id: string;
    merchant: string;
  }>;
  proposalId: string;
  question: string | null;
  recommendation: {
    rationale: string;
    signals: string[];
    suggestedIntent: TransactionIntent | null;
  };
  transactionId: string;
}

export type AgentInboxProposal =
  | ReviewAgentInboxProposal
  | ReimbursementCandidateAgentInboxProposal
  | ReimbursementMatchAgentInboxProposal;

export interface AgentInboxProposalContext {
  accountLabel: string;
  date: string;
  institutionName: string;
  plaidCategory: string | null;
  plaidMerchant: string | null;
  plaidName: string | null;
  reviewExplanation: string;
}

export interface AgentInboxRecommendation {
  categoryName?: string;
  confidence?: number;
  intent?: TransactionIntent;
  merchantName?: string;
  rationale: string;
  recurring?: boolean;
  signals: string[];
}

export interface AgentInboxSummary {
  acceptReadyCount: number;
  hiddenLowerConfidenceCount: number;
  manualReviewCount: number;
  proposedFieldCount: number;
  totalCount: number;
}

export interface AgentInboxDisplayPolicyResult {
  hiddenLowerConfidenceCount: number;
  proposals: AgentInboxProposal[];
}

const MAX_DEFAULT_REIMBURSEMENT_CANDIDATES = 5;
const MIN_DEFAULT_REIMBURSEMENT_CONFIDENCE = 0.58;

function accountLabel(item: ReviewQueueItem) {
  return [
    item.transaction.accountName,
    item.transaction.accountMask ? `ending ${item.transaction.accountMask}` : null
  ].filter(Boolean).join(" ");
}

function proposedFieldCount(proposal: AgentInboxProposal) {
  if (proposal.action === "reimbursement-candidate" || proposal.action === "reimbursement-match") return 1;

  return [
    proposal.recommendation.merchantName,
    proposal.recommendation.categoryName,
    proposal.recommendation.intent,
    proposal.recommendation.recurring,
    proposal.recommendation.confidence
  ].filter((value) => value !== undefined && value !== null && value !== "").length;
}

function dayGap(expenseDate: string, inflowDate: string) {
  const expenseMs = Date.parse(`${expenseDate}T12:00:00.000Z`);
  const inflowMs = Date.parse(`${inflowDate}T12:00:00.000Z`);
  if (!Number.isFinite(expenseMs) || !Number.isFinite(inflowMs)) return Number.POSITIVE_INFINITY;
  return Math.round((inflowMs - expenseMs) / 86_400_000);
}

function amountCloseness(expenseAmount: number, inflowAmount: number) {
  const ratio = inflowAmount / expenseAmount;
  if (ratio <= 0 || ratio > 1.08) return 0;

  const splitTargets = [1, 1 / 2, 1 / 3, 1 / 4];
  const bestTargetError = Math.min(...splitTargets.map((target) => Math.abs(ratio - target)));
  if (bestTargetError <= 0.12) return 1 - bestTargetError / 0.12;
  if (ratio >= 0.25) return Math.min(0.7, ratio);
  return 0;
}

function reimbursementCandidateDisplayScore(proposal: ReimbursementCandidateAgentInboxProposal) {
  if (proposal.candidateInflows.length === 0) return 0;

  const expenseAmount = Math.abs(proposal.amount);
  const inflowTotal = proposal.candidateInflows.reduce((total, inflow) => total + inflow.amount, 0);
  const earliestGap = Math.min(...proposal.candidateInflows.map((inflow) => dayGap(proposal.date, inflow.date)));
  const timingScore = earliestGap < -3 || earliestGap > 14
    ? 0
    : earliestGap <= 7
      ? 1 - Math.max(0, earliestGap) / 14
      : 0.4;
  const confidence = proposal.confidence ?? 0;

  return confidence * 0.45 + amountCloseness(expenseAmount, inflowTotal) * 0.35 + timingScore * 0.2;
}

function buildProposal(item: ReviewQueueItem): ReviewAgentInboxProposal {
  const suggestion = normalizeReviewSuggestion(item.aiSuggestion);
  const acceptReady = !isPeerToPeerReview(item.reason) && hasReviewSuggestionValue(suggestion);
  const proposal: AgentInboxProposal = {
    action: acceptReady ? "review-suggestion" : "manual-review",
    amount: item.transaction.amount,
    category: item.transaction.category,
    confidence: item.confidence,
    context: {
      accountLabel: accountLabel(item),
      date: item.transaction.date,
      institutionName: item.transaction.institutionName,
      plaidCategory: item.transaction.plaidCategory,
      plaidMerchant: item.transaction.plaidMerchant,
      plaidName: item.transaction.plaidName,
      reviewExplanation: item.explanation
    },
    createdAt: item.createdAt,
    date: item.transaction.date,
    id: `proposal-${item.id}`,
    intent: item.transaction.intent,
    merchant: item.transaction.merchant,
    reason: item.reason,
    recommendation: {
      categoryName: suggestion.categoryName,
      confidence: suggestion.confidence,
      intent: suggestion.intent,
      merchantName: suggestion.merchantName,
      rationale: suggestion.reason ?? item.explanation,
      recurring: suggestion.recurring,
      signals: suggestion.signals.slice(0, 6)
    },
    reviewItemId: item.id,
    status: acceptReady ? "accept-ready" : "needs-review",
    transactionId: item.transaction.id
  };

  assertFinanceManifestSafe(proposal);
  return proposal;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function transactionIntentValue(value: unknown): TransactionIntent | null {
  return value === "personal" ||
    value === "business" ||
    value === "shared" ||
    value === "reimbursable" ||
    value === "transfer"
    ? value
    : null;
}

function jsonObjectValue(value: unknown): Record<string, unknown> | null {
  return isJsonObject(value as Json) ? value as Record<string, unknown> : null;
}

function safeSignals(...values: unknown[]) {
  const seen = new Set<string>();
  return values
    .flatMap(stringArrayValue)
    .filter((signal) => {
      if (/openai unavailable|provider diagnostics?/i.test(signal)) return false;
      if (seen.has(signal)) return false;
      seen.add(signal);
      return true;
    })
    .slice(0, 6);
}

function buildReimbursementCandidateProposal(proposal: AgentProposalRecord): ReimbursementCandidateAgentInboxProposal | null {
  if (proposal.proposalType !== "reimbursement_candidate") return null;
  if (!isJsonObject(proposal.evidence) || !isJsonObject(proposal.proposedPatch)) return null;

  const transaction = jsonObjectValue(proposal.evidence.transaction);
  if (!transaction) return null;

  const candidateInflows = Array.isArray(proposal.evidence.candidateInflows)
    ? proposal.evidence.candidateInflows
      .map(jsonObjectValue)
      .filter((inflow): inflow is Record<string, unknown> => inflow !== null)
      .map((inflow) => ({
        amount: numberValue(inflow.amount),
        category: stringValue(inflow.category),
        date: stringValue(inflow.date),
        id: stringValue(inflow.id),
        merchant: stringValue(inflow.merchant)
      }))
    : [];
  const question = stringValue(proposal.proposedPatch.question) ||
    stringValue(proposal.evidence.question) ||
    proposal.clarificationQuestion;
  const rationale = stringValue(proposal.proposedPatch.reason) ||
    "Review whether this expense should be tracked as reimbursable.";
  const built: ReimbursementCandidateAgentInboxProposal = {
    action: "reimbursement-candidate",
    amount: numberValue(transaction.amount),
    candidateInflows,
    category: stringValue(transaction.category),
    confidence: proposal.confidence,
    createdAt: proposal.createdAt,
    date: stringValue(transaction.date),
    id: `agent-proposal-${proposal.id}`,
    merchant: stringValue(transaction.merchant),
    proposalId: proposal.id,
    question: question || null,
    recommendation: {
      rationale,
      signals: safeSignals(proposal.evidence.signals, proposal.evidence.heuristicReasons),
      suggestedIntent: transactionIntentValue(proposal.proposedPatch.suggestedIntent)
    },
    status: "needs-review",
    transactionId: stringValue(transaction.id) || proposal.targetId
  };

  assertFinanceManifestSafe(built);
  return built;
}

function buildReimbursementMatchProposal(proposal: AgentProposalRecord): ReimbursementMatchAgentInboxProposal | null {
  if (proposal.proposalType !== "reimbursement_match") return null;
  if (!isJsonObject(proposal.evidence) || !isJsonObject(proposal.proposedPatch)) return null;
  const expense = jsonObjectValue(proposal.evidence.expense);
  const inflow = jsonObjectValue(proposal.evidence.inflow);
  const reimbursement = jsonObjectValue(proposal.evidence.reimbursement);
  const ranking = jsonObjectValue(proposal.evidence.ranking);
  if (!expense || !inflow || !reimbursement || !ranking) return null;

  const matchAmount = numberValue(proposal.proposedPatch.matchAmount);
  const reasons = stringArrayValue(ranking.reasons);
  const built: ReimbursementMatchAgentInboxProposal = {
    action: "reimbursement-match",
    amount: numberValue(inflow.amount),
    category: stringValue(inflow.category),
    confidence: proposal.confidence,
    createdAt: proposal.createdAt,
    date: stringValue(inflow.date),
    expense: {
      amount: numberValue(expense.amount),
      category: stringValue(expense.category),
      date: stringValue(expense.date),
      id: stringValue(expense.id),
      merchant: stringValue(expense.merchant)
    },
    id: `agent-proposal-${proposal.id}`,
    inflow: {
      amount: numberValue(inflow.amount),
      category: stringValue(inflow.category),
      date: stringValue(inflow.date),
      id: stringValue(inflow.id),
      merchant: stringValue(inflow.merchant)
    },
    matchAmount,
    merchant: stringValue(inflow.merchant),
    proposalId: proposal.id,
    recommendation: {
      rationale: `Link ${stringValue(inflow.merchant)} to the expected reimbursement for ${stringValue(expense.merchant)}.`,
      signals: reasons.slice(0, 6)
    },
    reimbursement: {
      counterparty: stringValue(reimbursement.counterparty) || null,
      expectedAmount: numberValue(reimbursement.expectedAmount),
      id: stringValue(reimbursement.id),
      status: stringValue(reimbursement.status)
    },
    status: "accept-ready",
    unmatchedAmount: numberValue(ranking.unmatchedAmount)
  };

  assertFinanceManifestSafe(built);
  return built;
}

export function buildAgentInboxProposals(
  reviewItems: readonly ReviewQueueItem[],
  agentProposals: readonly AgentProposalRecord[] = []
) {
  return [
    ...reviewItems.map(buildProposal),
    ...agentProposals
      .map(buildReimbursementCandidateProposal)
      .filter((proposal): proposal is ReimbursementCandidateAgentInboxProposal => proposal !== null),
    ...agentProposals
      .map(buildReimbursementMatchProposal)
      .filter((proposal): proposal is ReimbursementMatchAgentInboxProposal => proposal !== null)
  ]
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "accept-ready" ? -1 : 1;
      if (left.action !== right.action) {
        if (left.action === "reimbursement-match") return -1;
        if (right.action === "reimbursement-match") return 1;
        if (left.action === "reimbursement-candidate") return -1;
        if (right.action === "reimbursement-candidate") return 1;
      }
      return Math.abs(right.amount) - Math.abs(left.amount);
    });
}

export function applyAgentInboxDisplayPolicy(
  proposals: readonly AgentInboxProposal[]
): AgentInboxDisplayPolicyResult {
  const alwaysVisible = proposals.filter((proposal) => proposal.action !== "reimbursement-candidate");
  const reimbursementCandidates = proposals.filter(
    (proposal): proposal is ReimbursementCandidateAgentInboxProposal => proposal.action === "reimbursement-candidate"
  );
  const eligibleCandidates = reimbursementCandidates
    .map((proposal) => ({ proposal, score: reimbursementCandidateDisplayScore(proposal) }))
    .filter(({ proposal, score }) =>
      proposal.candidateInflows.length > 0 &&
      (proposal.confidence ?? 0) >= MIN_DEFAULT_REIMBURSEMENT_CONFIDENCE &&
      score > 0.55
    )
    .sort((left, right) =>
      right.score - left.score ||
      (right.proposal.confidence ?? 0) - (left.proposal.confidence ?? 0) ||
      Math.abs(right.proposal.amount) - Math.abs(left.proposal.amount)
    );
  const visibleCandidateIds = new Set(
    eligibleCandidates
      .slice(0, MAX_DEFAULT_REIMBURSEMENT_CANDIDATES)
      .map(({ proposal }) => proposal.id)
  );
  const visible = proposals.filter((proposal) =>
    proposal.action !== "reimbursement-candidate" || visibleCandidateIds.has(proposal.id)
  );

  return {
    hiddenLowerConfidenceCount: proposals.length - visible.length,
    proposals: visible.length === alwaysVisible.length && reimbursementCandidates.length === 0
      ? alwaysVisible
      : visible
  };
}

export function summarizeAgentInbox(
  proposals: readonly AgentInboxProposal[],
  options: { hiddenLowerConfidenceCount?: number } = {}
): AgentInboxSummary {
  return proposals.reduce<AgentInboxSummary>(
    (summary, proposal) => ({
      acceptReadyCount: summary.acceptReadyCount + (proposal.status === "accept-ready" ? 1 : 0),
      hiddenLowerConfidenceCount: summary.hiddenLowerConfidenceCount,
      manualReviewCount: summary.manualReviewCount + (proposal.status === "needs-review" ? 1 : 0),
      proposedFieldCount: summary.proposedFieldCount + proposedFieldCount(proposal),
      totalCount: summary.totalCount + 1
    }),
    {
      acceptReadyCount: 0,
      hiddenLowerConfidenceCount: options.hiddenLowerConfidenceCount ?? 0,
      manualReviewCount: 0,
      proposedFieldCount: 0,
      totalCount: 0
    }
  );
}
