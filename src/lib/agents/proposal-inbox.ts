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
export type AgentInboxProposalAction = "review-suggestion" | "manual-review" | "reimbursement-match";

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

export type AgentInboxProposal = ReviewAgentInboxProposal | ReimbursementMatchAgentInboxProposal;

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
  manualReviewCount: number;
  proposedFieldCount: number;
  totalCount: number;
}

function accountLabel(item: ReviewQueueItem) {
  return [
    item.transaction.accountName,
    item.transaction.accountMask ? `ending ${item.transaction.accountMask}` : null
  ].filter(Boolean).join(" ");
}

function proposedFieldCount(proposal: AgentInboxProposal) {
  if (proposal.action === "reimbursement-match") return 1;

  return [
    proposal.recommendation.merchantName,
    proposal.recommendation.categoryName,
    proposal.recommendation.intent,
    proposal.recommendation.recurring,
    proposal.recommendation.confidence
  ].filter((value) => value !== undefined && value !== null && value !== "").length;
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

function jsonObjectValue(value: unknown): Record<string, unknown> | null {
  return isJsonObject(value as Json) ? value as Record<string, unknown> : null;
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
      .map(buildReimbursementMatchProposal)
      .filter((proposal): proposal is ReimbursementMatchAgentInboxProposal => proposal !== null)
  ]
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "accept-ready" ? -1 : 1;
      if (left.action !== right.action) return left.action === "reimbursement-match" ? -1 : 1;
      return Math.abs(right.amount) - Math.abs(left.amount);
    });
}

export function summarizeAgentInbox(proposals: readonly AgentInboxProposal[]): AgentInboxSummary {
  return proposals.reduce<AgentInboxSummary>(
    (summary, proposal) => ({
      acceptReadyCount: summary.acceptReadyCount + (proposal.status === "accept-ready" ? 1 : 0),
      manualReviewCount: summary.manualReviewCount + (proposal.status === "needs-review" ? 1 : 0),
      proposedFieldCount: summary.proposedFieldCount + proposedFieldCount(proposal),
      totalCount: summary.totalCount + 1
    }),
    { acceptReadyCount: 0, manualReviewCount: 0, proposedFieldCount: 0, totalCount: 0 }
  );
}
