import { assertAssistantContextSafe } from "@/lib/agents";
import type { OpenClawClarificationQuestion, OpenClawSignalsResponse } from "./types";

export type OpenClawOutboxMessageKind = "budget_briefing" | "reimbursement_clarification";
export type OpenClawOutboxMessagePriority = "normal" | "high";

export interface OpenClawOutboxReplyAction {
  endpoint: "/api/openclaw/replies";
  method: "POST";
  proposalId: string;
  prompt: string;
}

export interface OpenClawOutboxMessage {
  id: string;
  body: string;
  createdAt: string;
  kind: OpenClawOutboxMessageKind;
  priority: OpenClawOutboxMessagePriority;
  replyAction: OpenClawOutboxReplyAction | null;
  target: "openclaw";
}

export interface OpenClawOutboxResponse {
  object: "ledger.openclaw.outbox";
  contractVersion: OpenClawSignalsResponse["contractVersion"];
  generatedAt: string;
  messages: OpenClawOutboxMessage[];
  nextCursor: string;
  safety: OpenClawSignalsResponse["safety"] & {
    deliveryContainsPhoneNumber: false;
    directFinanceWritesAllowed: false;
  };
}

const MAX_MESSAGE_LENGTH = 320;
const MAX_QUESTION_LENGTH = 180;

function money(value: number) {
  const rounded = Math.round(value);
  return `$${Math.abs(rounded).toLocaleString("en-US")}`;
}

function signedMoney(value: number) {
  if (value === 0) return "$0";
  return `${value > 0 ? "+" : "-"}${money(value)}`;
}

function compact(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function reimbursementQuestionBody(question: OpenClawClarificationQuestion) {
  return compact(`Tally reimbursement check: ${question.question} Reply yes/no or a name.`, MAX_MESSAGE_LENGTH);
}

function reimbursementMessage(
  question: OpenClawClarificationQuestion,
  generatedAt: string
): OpenClawOutboxMessage {
  return {
    id: `openclaw-outbox:reimbursement:${question.proposalId}`,
    body: reimbursementQuestionBody(question),
    createdAt: generatedAt,
    kind: "reimbursement_clarification",
    priority: "high",
    replyAction: {
      endpoint: "/api/openclaw/replies",
      method: "POST",
      proposalId: question.proposalId,
      prompt: compact(question.question, MAX_QUESTION_LENGTH)
    },
    target: "openclaw"
  };
}

function topCategoryText(signals: OpenClawSignalsResponse) {
  const category = signals.weeklyPlanningContext.spending.currentWeek.topCategories[0];
  if (!category) return null;
  return `${category.label} ${money(category.amount)}`;
}

function budgetBriefingBody(signals: OpenClawSignalsResponse) {
  const context = signals.weeklyPlanningContext;
  const current = context.spending.currentWeek;
  const previous = context.spending.previousWeek;
  const spendingDelta = current.spending - previous.spending;
  const cashflow = context.cashflow.upcoming;
  const projectedCash = cashflow.projectedCashBalance === null
    ? null
    : `projected cash ${money(cashflow.projectedCashBalance)}`;
  const topCategory = topCategoryText(signals);
  const reviewText = context.review.openCount > 0
    ? `${context.review.openCount} open reviews`
    : "no open reviews";
  const reimbursementText = current.reimbursementOutstanding > 0
    ? `${money(current.reimbursementOutstanding)} reimbursements outstanding`
    : "no reimbursements outstanding";
  const pieces = [
    `Tally budget: week spend ${money(current.spending)} (${signedMoney(spendingDelta)} vs last week)`,
    `bills due ${money(cashflow.billTotal)}`,
    projectedCash,
    topCategory ? `top ${topCategory}` : null,
    reviewText,
    reimbursementText
  ].filter((piece): piece is string => Boolean(piece));

  return compact(`${pieces.join("; ")}.`, MAX_MESSAGE_LENGTH);
}

function budgetBriefingMessage(signals: OpenClawSignalsResponse): OpenClawOutboxMessage {
  const current = signals.weeklyPlanningContext.spending.currentWeek;
  const priority: OpenClawOutboxMessagePriority =
    current.reimbursementOutstanding > 0 || signals.weeklyPlanningContext.review.openCount > 0
      ? "high"
      : "normal";

  return {
    id: `openclaw-outbox:budget:${signals.weeklyPlanningContext.asOfDate}`,
    body: budgetBriefingBody(signals),
    createdAt: signals.generatedAt,
    kind: "budget_briefing",
    priority,
    replyAction: null,
    target: "openclaw"
  };
}

export function buildOpenClawOutboxResponse(
  signals: OpenClawSignalsResponse,
  options: { includeBudgetBriefing?: boolean; messageLimit?: number } = {}
): OpenClawOutboxResponse {
  const includeBudgetBriefing = options.includeBudgetBriefing ?? true;
  const messageLimit = Math.max(0, Math.min(options.messageLimit ?? 5, 25));
  const messages = [
    ...signals.openClarificationQuestions.map((question) => reimbursementMessage(question, signals.generatedAt)),
    ...(includeBudgetBriefing ? [budgetBriefingMessage(signals)] : [])
  ].slice(0, messageLimit);

  const response: OpenClawOutboxResponse = {
    object: "ledger.openclaw.outbox",
    contractVersion: signals.contractVersion,
    generatedAt: signals.generatedAt,
    messages,
    nextCursor: signals.nextCursor,
    safety: {
      ...signals.safety,
      deliveryContainsPhoneNumber: false,
      directFinanceWritesAllowed: false
    }
  };

  assertAssistantContextSafe(response);
  return response;
}
