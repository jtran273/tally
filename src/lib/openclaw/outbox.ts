import { assertAssistantContextSafe } from "@/lib/agents";
import { calendarPressureCategoryPhrase, summarizeCalendarPressure } from "@/lib/calendar";
import type { OpenClawAnomalyPacket } from "@/lib/anomaly/packet";
import type { AccountLifecycleHint } from "@/lib/finance/account-lifecycle";
import type { CreditOptimizationPacket } from "./credit-nudges";
import type { OpenClawClarificationQuestion, OpenClawSignalsResponse } from "./types";

export type OpenClawOutboxMessageKind =
  | "budget_briefing"
  | "anomaly_alert"
  | "credit_optimization"
  | "lifecycle_guidance"
  | "reimbursement_alert"
  | "reimbursement_clarification"
  | "review_queue_alert";

const LIFECYCLE_HINT_LIMIT = 1;
export type OpenClawOutboxMessagePriority = "normal" | "high";
export type OpenClawOutboxMinimumPriority = OpenClawOutboxMessagePriority;

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
const PRIORITY_RANK: Record<OpenClawOutboxMessagePriority, number> = {
  normal: 0,
  high: 1
};

// Categories that warrant a calendar hint in reimbursement-clarification and review prompt copy.
const PROMPT_CALENDAR_CATEGORIES = new Set(["dining", "gift", "travel", "wedding"]);

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

function reimbursementQuestionBody(question: OpenClawClarificationQuestion, calendarHint: string | null) {
  const hint = calendarHint ? ` ${calendarHint}` : "";
  return compact(`Tally reimbursement check: ${question.question} Reply yes/no or a name.${hint}`, MAX_MESSAGE_LENGTH);
}

function reimbursementMessage(
  question: OpenClawClarificationQuestion,
  generatedAt: string,
  calendarHint: string | null
): OpenClawOutboxMessage {
  return {
    id: `openclaw-outbox:reimbursement:${question.proposalId}`,
    body: reimbursementQuestionBody(question, calendarHint),
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

function calendarPressureText(signals: OpenClawSignalsResponse) {
  const pressure = summarizeCalendarPressure(signals.calendarContext);
  if (pressure.level !== "moderate" && pressure.level !== "high") return null;
  const phrase = calendarPressureCategoryPhrase(pressure.topPlannedSpendCategories);
  if (!phrase) return null;
  return `calendar pressure ${pressure.level} (${phrase} ahead)`;
}

function promptCalendarHint(signals: OpenClawSignalsResponse): string | null {
  const pressure = summarizeCalendarPressure(signals.calendarContext);
  const relevant = pressure.topPlannedSpendCategories.filter((c) => PROMPT_CALENDAR_CATEGORIES.has(c.category));
  const phrase = calendarPressureCategoryPhrase(relevant);
  if (!phrase) return null;
  return `Heads-up: upcoming ${phrase} on your calendar.`;
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
    reimbursementText,
    calendarPressureText(signals)
  ].filter((piece): piece is string => Boolean(piece));

  return compact(`${pieces.join("; ")}.`, MAX_MESSAGE_LENGTH);
}

function budgetBriefingMessage(signals: OpenClawSignalsResponse): OpenClawOutboxMessage {
  return {
    id: `openclaw-outbox:budget:${signals.weeklyPlanningContext.asOfDate}`,
    body: budgetBriefingBody(signals),
    createdAt: signals.generatedAt,
    kind: "budget_briefing",
    priority: "normal",
    replyAction: null,
    target: "openclaw"
  };
}

function reviewQueueAlert(signals: OpenClawSignalsResponse): OpenClawOutboxMessage | null {
  const review = signals.weeklyPlanningContext.review;
  if (review.openCount <= 0) return null;

  const top = review.examples[0];
  const topText = top
    ? ` top ${top.merchant} ${money(top.amount)} (${top.reason})`
    : "";
  const calendarHint = promptCalendarHint(signals);
  const hintText = calendarHint ? ` ${calendarHint}` : "";
  return {
    id: `openclaw-outbox:review:${signals.weeklyPlanningContext.asOfDate}`,
    body: compact(`Tally review: ${review.openCount} open item${review.openCount === 1 ? "" : "s"} totaling ${money(review.totalAbsoluteAmount)}.${topText ? `${topText}.` : ""}${hintText}`, MAX_MESSAGE_LENGTH),
    createdAt: signals.generatedAt,
    kind: "review_queue_alert",
    priority: "high",
    replyAction: null,
    target: "openclaw"
  };
}

function reimbursementAlert(signals: OpenClawSignalsResponse): OpenClawOutboxMessage | null {
  const outstanding = signals.weeklyPlanningContext.spending.currentWeek.reimbursementOutstanding;
  if (outstanding <= 0) return null;

  return {
    id: `openclaw-outbox:reimbursement-summary:${signals.weeklyPlanningContext.asOfDate}`,
    body: compact(`Tally reimbursement: ${money(outstanding)} still outstanding this week. Ask Tally for reimbursements to see the items.`, MAX_MESSAGE_LENGTH),
    createdAt: signals.generatedAt,
    kind: "reimbursement_alert",
    priority: "high",
    replyAction: null,
    target: "openclaw"
  };
}

function creditOptimizationMessage(
  packet: CreditOptimizationPacket,
  generatedAt: string
): OpenClawOutboxMessage {
  return {
    id: packet.id,
    body: compact(`Tally credit: ${packet.rationale}`, MAX_MESSAGE_LENGTH),
    createdAt: generatedAt,
    kind: "credit_optimization",
    priority: packet.priority,
    replyAction: null,
    target: "openclaw"
  };
}

function lifecycleHintMessage(hint: AccountLifecycleHint, generatedAt: string): OpenClawOutboxMessage {
  return {
    id: hint.id,
    body: compact(`Tally heads-up: ${hint.rationale}`, MAX_MESSAGE_LENGTH),
    createdAt: generatedAt,
    kind: "lifecycle_guidance",
    priority: "normal",
    replyAction: null,
    target: "openclaw"
  };
}

function anomalyAlertMessage(packet: OpenClawAnomalyPacket): OpenClawOutboxMessage {
  return {
    id: `openclaw-outbox:anomaly:${packet.id}`,
    body: compact(`Tally alert: ${packet.title}. ${packet.body}`, MAX_MESSAGE_LENGTH),
    createdAt: packet.createdAt,
    kind: "anomaly_alert",
    priority: packet.priority,
    replyAction: null,
    target: "openclaw"
  };
}

export function buildOpenClawOutboxResponse(
  signals: OpenClawSignalsResponse,
  options: {
    anomalyPackets?: readonly OpenClawAnomalyPacket[];
    creditOptimizationPackets?: readonly CreditOptimizationPacket[];
    lifecycleHints?: readonly AccountLifecycleHint[];
    includeBudgetBriefing?: boolean;
    messageLimit?: number;
    minPriority?: OpenClawOutboxMinimumPriority;
  } = {}
): OpenClawOutboxResponse {
  const includeBudgetBriefing = options.includeBudgetBriefing ?? true;
  const messageLimit = Math.max(0, Math.min(options.messageLimit ?? 5, 25));
  const minPriority = options.minPriority ?? "normal";
  const calendarHint = promptCalendarHint(signals);
  const messages = [
    ...(options.anomalyPackets ?? []).map(anomalyAlertMessage),
    ...(options.creditOptimizationPackets ?? []).map((packet) =>
      creditOptimizationMessage(packet, signals.generatedAt)
    ),
    ...(options.lifecycleHints ?? [])
      .slice(0, LIFECYCLE_HINT_LIMIT)
      .map((hint) => lifecycleHintMessage(hint, signals.generatedAt)),
    ...signals.openClarificationQuestions.map((question) => reimbursementMessage(question, signals.generatedAt, calendarHint)),
    reimbursementAlert(signals),
    reviewQueueAlert(signals),
    ...(includeBudgetBriefing ? [budgetBriefingMessage(signals)] : [])
  ].filter((message): message is OpenClawOutboxMessage => message !== null)
    .filter((message) => PRIORITY_RANK[message.priority] >= PRIORITY_RANK[minPriority])
    .slice(0, messageLimit);

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
