export type ClarificationDecisionAction = "ask" | "app-only-queue" | "silent";

export type ClarificationDecisionReason =
  | "ask-meaningful-medium-confidence"
  | "ask-meaningful-high-confidence"
  | "batch-similar-open-request"
  | "too-many-open-requests"
  | "below-value-threshold"
  | "below-confidence-threshold"
  | "no-accounting-impact";

export type ClarificationAnswerKind =
  | "confirm-reimbursement"
  | "counterparty"
  | "not-reimbursement"
  | "split-counterparties"
  | "unknown";

export interface ReimbursementClarificationCandidate {
  accountingImpactAmount: number;
  amount: number;
  candidateId: string;
  confidence: number;
  currency?: string;
  date: string;
  evidence: readonly string[];
  merchant: string;
  questionFingerprint: string;
  suggestedCounterparty?: string | null;
  transactionId: string;
}

export interface OpenClarificationRequestSummary {
  questionFingerprint: string;
  status: "open" | "queued";
}

export interface ReimbursementClarificationPolicy {
  highConfidenceThreshold: number;
  maxOpenRequests: number;
  mediumConfidenceThreshold: number;
  meaningfulImpactAmount: number;
}

export interface AssistantClarificationRequest {
  object: "assistant_clarification_request";
  accountingImpactAmount: number;
  answerType: "reimbursement_clarification";
  approvalRequired: true;
  audit: {
    evidence: readonly string[];
    writesAllowed: false;
  };
  candidateId: string;
  confidence: number;
  context: {
    amount: number;
    currency: string;
    date: string;
    merchant: string;
    suggestedCounterparty: string | null;
  };
  id: string;
  priority: "medium" | "high";
  question: string;
  questionFingerprint: string;
  transactionId: string;
}

export interface ClarificationDecision {
  action: ClarificationDecisionAction;
  reason: ClarificationDecisionReason;
  request?: AssistantClarificationRequest;
}

export interface NormalizedClarificationAnswer {
  kind: ClarificationAnswerKind;
  counterparties: string[];
  rawAnswer: string;
}

export const defaultReimbursementClarificationPolicy: ReimbursementClarificationPolicy = {
  highConfidenceThreshold: 0.8,
  maxOpenRequests: 3,
  mediumConfidenceThreshold: 0.55,
  meaningfulImpactAmount: 20
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMoney(amount: number, currency: string) {
  const prefix = currency === "USD" ? "$" : `${currency} `;
  return `${prefix}${roundMoney(Math.abs(amount)).toFixed(2)}`;
}

function requestId(candidate: ReimbursementClarificationCandidate) {
  return `clarify-reimbursement-${candidate.candidateId}`;
}

function priorityForConfidence(
  confidence: number,
  policy: ReimbursementClarificationPolicy
): AssistantClarificationRequest["priority"] {
  return confidence >= policy.highConfidenceThreshold ? "high" : "medium";
}

export function buildReimbursementClarificationQuestion(candidate: ReimbursementClarificationCandidate): string {
  const currency = candidate.currency ?? "USD";
  const counterparty = candidate.suggestedCounterparty?.trim();
  const subject = counterparty ? `${counterparty}'s share` : "someone else's share";

  return `Was ${formatMoney(candidate.accountingImpactAmount, currency)} of ${candidate.merchant} on ${candidate.date} ${subject} to reimburse?`;
}

export function createAssistantClarificationRequest(
  candidate: ReimbursementClarificationCandidate,
  policy: ReimbursementClarificationPolicy = defaultReimbursementClarificationPolicy
): AssistantClarificationRequest {
  return {
    object: "assistant_clarification_request",
    accountingImpactAmount: roundMoney(Math.abs(candidate.accountingImpactAmount)),
    answerType: "reimbursement_clarification",
    approvalRequired: true,
    audit: {
      evidence: candidate.evidence,
      writesAllowed: false
    },
    candidateId: candidate.candidateId,
    confidence: candidate.confidence,
    context: {
      amount: candidate.amount,
      currency: candidate.currency ?? "USD",
      date: candidate.date,
      merchant: candidate.merchant,
      suggestedCounterparty: candidate.suggestedCounterparty ?? null
    },
    id: requestId(candidate),
    priority: priorityForConfidence(candidate.confidence, policy),
    question: buildReimbursementClarificationQuestion(candidate),
    questionFingerprint: candidate.questionFingerprint,
    transactionId: candidate.transactionId
  };
}

export function decideReimbursementClarification(
  candidate: ReimbursementClarificationCandidate,
  openRequests: readonly OpenClarificationRequestSummary[] = [],
  policy: ReimbursementClarificationPolicy = defaultReimbursementClarificationPolicy
): ClarificationDecision {
  const impactAmount = Math.abs(candidate.accountingImpactAmount);

  if (impactAmount <= 0) {
    return { action: "silent", reason: "no-accounting-impact" };
  }

  if (impactAmount < policy.meaningfulImpactAmount) {
    return { action: "silent", reason: "below-value-threshold" };
  }

  if (candidate.confidence < policy.mediumConfidenceThreshold) {
    return { action: "silent", reason: "below-confidence-threshold" };
  }

  if (openRequests.some((request) => request.questionFingerprint === candidate.questionFingerprint)) {
    return { action: "app-only-queue", reason: "batch-similar-open-request" };
  }

  if (openRequests.length >= policy.maxOpenRequests) {
    return { action: "app-only-queue", reason: "too-many-open-requests" };
  }

  const request = createAssistantClarificationRequest(candidate, policy);
  const reason: ClarificationDecisionReason = request.priority === "high"
    ? "ask-meaningful-high-confidence"
    : "ask-meaningful-medium-confidence";

  return {
    action: "ask",
    reason,
    request
  };
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function splitCounterpartyText(value: string) {
  return value
    .split(/\s+(?:and|&)\s+|,\s*/i)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

export function normalizeReimbursementClarificationAnswer(answer: string): NormalizedClarificationAnswer {
  const rawAnswer = normalizeText(answer);
  const normalized = rawAnswer.toLowerCase();

  if (["yes", "y", "yeah", "yep", "correct"].includes(normalized)) {
    return { kind: "confirm-reimbursement", counterparties: [], rawAnswer };
  }

  if (["no", "n", "not reimbursement", "not a reimbursement"].includes(normalized)) {
    return { kind: "not-reimbursement", counterparties: [], rawAnswer };
  }

  const splitMatch = rawAnswer.match(/^split between (.+)$/i);
  if (splitMatch?.[1]) {
    return {
      kind: "split-counterparties",
      counterparties: splitCounterpartyText(splitMatch[1]),
      rawAnswer
    };
  }

  const counterpartyMatch = rawAnswer.match(/^([A-Za-z][A-Za-z.'-]*)(?:\s+.+)?$/);
  if (counterpartyMatch?.[1]) {
    return {
      kind: "counterparty",
      counterparties: [normalizeText(counterpartyMatch[1])],
      rawAnswer
    };
  }

  return { kind: "unknown", counterparties: [], rawAnswer };
}
