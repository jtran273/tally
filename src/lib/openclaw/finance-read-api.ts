import { assertAssistantContextSafe } from "@/lib/agents";
import {
  calendarPressureCategoryPhrase,
  summarizeCalendarPressure,
  type CalendarPressureLevel
} from "@/lib/calendar";
import type { ReviewQueueItem, TransactionRecord } from "@/lib/db";
import { summarizeTransactionReimbursement } from "@/lib/finance/reimbursements";
import type { OpenClawSignalsResponse } from "./types";

export type OpenClawFinanceQueryIntent =
  | "recent_transactions"
  | "review_items"
  | "reimbursements"
  | "safe_to_spend";

export interface OpenClawRecentTransaction {
  id: string;
  accountNickname: string;
  amount: number;
  category: string;
  date: string;
  merchant: string;
  reimbursement: {
    outstandingAmount: number;
    state: ReturnType<typeof summarizeTransactionReimbursement>["state"];
  };
  status: TransactionRecord["status"];
}

export interface OpenClawRecentTransactionsResponse {
  object: "ledger.openclaw.recent_transactions";
  generatedAt: string;
  limit: number;
  transactions: OpenClawRecentTransaction[];
  safety: OpenClawReadSafety;
}

export interface OpenClawReviewItem {
  id: string;
  amount: number;
  category: string;
  date: string;
  explanation: string;
  merchant: string;
  reason: ReviewQueueItem["reason"];
  status: ReviewQueueItem["status"];
  transactionId: string;
}

export interface OpenClawReviewItemsResponse {
  object: "ledger.openclaw.review_items";
  generatedAt: string;
  items: OpenClawReviewItem[];
  limit: number;
  openCount: number;
  safety: OpenClawReadSafety;
}

export interface OpenClawReimbursementItem {
  transactionId: string;
  amount: number;
  date: string;
  expectedAmount: number;
  merchant: string;
  outstandingAmount: number;
  receivedAmount: number;
  records: Array<{
    counterparty: string | null;
    dueDate: string | null;
    expectedAmount: number;
    outstandingAmount: number;
    receivedAmount: number;
    receivedAt: string | null;
    status: TransactionRecord["reimbursements"][number]["status"];
  }>;
  state: ReturnType<typeof summarizeTransactionReimbursement>["state"];
}

export interface OpenClawReimbursementsResponse {
  object: "ledger.openclaw.reimbursements";
  generatedAt: string;
  items: OpenClawReimbursementItem[];
  limit: number;
  pageSummary: {
    expectedAmount: number;
    outstandingAmount: number;
    receivedAmount: number;
  };
  summary: {
    expectedAmount: number;
    outstandingAmount: number;
    receivedAmount: number;
  };
  safety: OpenClawReadSafety;
}

export interface OpenClawSafeToSpendResponse {
  object: "ledger.openclaw.safe_to_spend";
  amount: number | null;
  asOfDate: string;
  generatedAt: string;
  rationale: string;
  status: "green" | "yellow" | "red";
  summary: {
    billsDue: number;
    calendarPlannedSpendEvents: number;
    calendarPressure: CalendarPressureLevel;
    openReviewCount: number;
    projectedCash: number | null;
    reimbursementOutstanding: number;
    startingCash: number | null;
    weekSpend: number;
    weekVsPrevious: number;
  };
  safety: OpenClawReadSafety;
}

export interface OpenClawQueryResponse {
  object: "ledger.openclaw.query";
  generatedAt: string;
  intent: OpenClawFinanceQueryIntent;
  result:
    | OpenClawRecentTransactionsResponse
    | OpenClawReviewItemsResponse
    | OpenClawReimbursementsResponse
    | OpenClawSafeToSpendResponse;
  safety: OpenClawReadSafety;
}

export interface OpenClawReadSafety {
  accountNumbersIncluded: false;
  directFinanceWritesAllowed: false;
  rawProviderPayloadIncluded: false;
  secretsIncluded: false;
  userScoped: true;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;
const REDACTED_TEXT = "[redacted]";
const SECRET_VALUE_PATTERN =
  /\bBearer\s+\S{12,}|\b(?:postgres|postgresql|mysql):\/\/[^ \n]+|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\b(?:access|public)-(?:sandbox|development|production)-[A-Za-z0-9_-]{12,}\b|\bservice[_-]?role[_-]?key\s*[:=]\s*\S{12,}/gi;

export class OpenClawFinanceReadBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawFinanceReadBadRequestError";
  }
}

export function openClawReadSafety(): OpenClawReadSafety {
  return {
    accountNumbersIncluded: false,
    directFinanceWritesAllowed: false,
    rawProviderPayloadIncluded: false,
    secretsIncluded: false,
    userScoped: true
  };
}

export function parseOpenClawLimit(value: string | number | null | undefined, defaultLimit = DEFAULT_LIMIT) {
  if (value === null || value === undefined || value === "") return defaultLimit;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_LIMIT) {
    throw new OpenClawFinanceReadBadRequestError(`limit must be an integer from 0 to ${MAX_LIMIT}.`);
  }
  return parsed;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function reimbursementRecordOutstanding(record: TransactionRecord["reimbursements"][number]) {
  return roundMoney(Math.max(0, record.expectedAmount - record.receivedAmount));
}

function safeDisplayText(value: string, fallback: string) {
  const cleaned = value.replace(SECRET_VALUE_PATTERN, REDACTED_TEXT).trim();
  return cleaned && cleaned !== REDACTED_TEXT ? cleaned : fallback;
}

function accountNickname(transaction: TransactionRecord) {
  return safeDisplayText(transaction.accountName, "Account");
}

function merchantName(transaction: Pick<TransactionRecord, "merchant">) {
  return safeDisplayText(transaction.merchant, "Merchant");
}

export function buildOpenClawRecentTransactionsResponse(
  transactions: readonly TransactionRecord[],
  options: { generatedAt?: string; limit?: number } = {}
): OpenClawRecentTransactionsResponse {
  const limit = Math.max(0, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const response: OpenClawRecentTransactionsResponse = {
    object: "ledger.openclaw.recent_transactions",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    limit,
    transactions: transactions.slice(0, limit).map((transaction) => {
      const reimbursement = summarizeTransactionReimbursement(transaction);
      return {
        id: transaction.id,
        accountNickname: accountNickname(transaction),
        amount: transaction.amount,
        category: transaction.category,
        date: transaction.date,
        merchant: merchantName(transaction),
        reimbursement: {
          outstandingAmount: reimbursement.outstandingAmount,
          state: reimbursement.state
        },
        status: transaction.status
      };
    }),
    safety: openClawReadSafety()
  };

  assertAssistantContextSafe(response);
  return response;
}

export function buildOpenClawReviewItemsResponse(
  reviewItems: readonly ReviewQueueItem[],
  options: { generatedAt?: string; limit?: number } = {}
): OpenClawReviewItemsResponse {
  const limit = Math.max(0, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const openItems = reviewItems.filter((item) => item.status === "open");
  const response: OpenClawReviewItemsResponse = {
    object: "ledger.openclaw.review_items",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    items: openItems.slice(0, limit).map((item) => ({
      id: item.id,
      amount: item.transaction.amount,
      category: item.transaction.category,
      date: item.transaction.date,
      explanation: safeDisplayText(item.explanation, "Review item needs attention."),
      merchant: merchantName(item.transaction),
      reason: item.reason,
      status: item.status,
      transactionId: item.transaction.id
    })),
    limit,
    openCount: openItems.length,
    safety: openClawReadSafety()
  };

  assertAssistantContextSafe(response);
  return response;
}

export function buildOpenClawReimbursementsResponse(
  transactions: readonly TransactionRecord[],
  options: { generatedAt?: string; limit?: number } = {}
): OpenClawReimbursementsResponse {
  const limit = Math.max(0, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const reimbursableItems = transactions
    .map((transaction) => ({
      transaction,
      reimbursement: summarizeTransactionReimbursement(transaction)
    }))
    .filter(({ reimbursement }) => reimbursement.state !== "none")
    .sort((left, right) => right.reimbursement.outstandingAmount - left.reimbursement.outstandingAmount);

  const summary = reimbursableItems.reduce(
    (totals, { reimbursement }) => ({
      expectedAmount: roundMoney(totals.expectedAmount + reimbursement.expectedAmount),
      outstandingAmount: roundMoney(totals.outstandingAmount + reimbursement.outstandingAmount),
      receivedAmount: roundMoney(totals.receivedAmount + reimbursement.receivedAmount)
    }),
    { expectedAmount: 0, outstandingAmount: 0, receivedAmount: 0 }
  );

  const items = reimbursableItems.slice(0, limit).map(({ transaction, reimbursement }) => ({
    transactionId: transaction.id,
    amount: transaction.amount,
    date: transaction.date,
    expectedAmount: reimbursement.expectedAmount,
    merchant: merchantName(transaction),
    outstandingAmount: reimbursement.outstandingAmount,
    receivedAmount: reimbursement.receivedAmount,
    records: transaction.reimbursements
      .map((record) => ({
        counterparty: record.counterparty ? safeDisplayText(record.counterparty, "Counterparty") : null,
        dueDate: record.dueDate,
        expectedAmount: record.expectedAmount,
        outstandingAmount: reimbursementRecordOutstanding(record),
        receivedAmount: record.receivedAmount,
        receivedAt: record.receivedAt,
        status: record.status
      }))
      .sort((left, right) =>
        right.outstandingAmount - left.outstandingAmount ||
        right.expectedAmount - left.expectedAmount
      ),
    state: reimbursement.state
  }));

  const pageSummary = items.reduce(
    (totals, item) => ({
      expectedAmount: roundMoney(totals.expectedAmount + item.expectedAmount),
      outstandingAmount: roundMoney(totals.outstandingAmount + item.outstandingAmount),
      receivedAmount: roundMoney(totals.receivedAmount + item.receivedAmount)
    }),
    { expectedAmount: 0, outstandingAmount: 0, receivedAmount: 0 }
  );

  const response: OpenClawReimbursementsResponse = {
    object: "ledger.openclaw.reimbursements",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    items,
    limit,
    summary,
    pageSummary,
    safety: openClawReadSafety()
  };

  assertAssistantContextSafe(response);
  return response;
}

export function parseSafeToSpendAmount(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) {
    throw new OpenClawFinanceReadBadRequestError("amount must be a number from 0 to 100000.");
  }
  return roundMoney(parsed);
}

const CALENDAR_PRESSURE_AMOUNT_THRESHOLD = 150;

function safeToSpendStatus(input: {
  amount: number;
  billsDue: number;
  calendarPressure: CalendarPressureLevel;
  openReviewCount: number;
  projectedCash: number | null;
  reimbursementOutstanding: number;
  weekSpend: number;
  weekVsPrevious: number;
}) {
  if (input.projectedCash !== null && input.projectedCash - input.amount < 0) return "red";
  if (input.amount > 250 && input.weekVsPrevious > 0) return "yellow";
  if (input.openReviewCount >= 10 || input.reimbursementOutstanding >= 100) return "yellow";
  if (input.billsDue >= 500 && input.projectedCash !== null && input.projectedCash < input.billsDue * 2) return "yellow";
  // High upcoming calendar pressure softens an otherwise-green answer for a meaningful spend,
  // because planned commitments (travel, dining, gifts) likely add spend the ledger has not seen yet.
  // It never escalates to red: calendar inference must not block spending on its own.
  if (input.calendarPressure === "high" && input.amount >= CALENDAR_PRESSURE_AMOUNT_THRESHOLD) return "yellow";
  return "green";
}

function safeToSpendRationale(
  status: OpenClawSafeToSpendResponse["status"],
  amount: number | null,
  summary: OpenClawSafeToSpendResponse["summary"],
  calendarClause: string | null
) {
  const amountText = amount === null ? "new spending" : `$${Math.round(amount).toLocaleString("en-US")}`;
  const withCalendar = (base: string) => (calendarClause ? `${base} ${calendarClause}` : base);

  if (status === "red") {
    return `${amountText} would push projected cash below zero after upcoming bills.`;
  }
  if (summary.openReviewCount > 0 || summary.reimbursementOutstanding > 0) {
    return withCalendar(`${amountText} is possible, but open reviews or reimbursements make the current picture less clean.`);
  }
  if (status === "yellow") {
    return withCalendar(`${amountText} is possible, but upcoming bills or this week's pace make it worth keeping tight.`);
  }
  return withCalendar(`${amountText} looks reasonable against projected cash, bills due, and this week's pace.`);
}

function calendarRationaleClause(
  pressure: ReturnType<typeof summarizeCalendarPressure>
): string | null {
  if (pressure.level !== "moderate" && pressure.level !== "high") return null;
  const phrase = calendarPressureCategoryPhrase(pressure.topPlannedSpendCategories);
  if (!phrase) return null;
  return `Upcoming ${phrase} on your calendar may add planned spend, so keep a buffer.`;
}

export function buildOpenClawSafeToSpendResponse(
  signals: OpenClawSignalsResponse,
  options: { amount?: number | null } = {}
): OpenClawSafeToSpendResponse {
  const context = signals.weeklyPlanningContext;
  const amount = options.amount ?? null;
  const current = context.spending.currentWeek;
  const previous = context.spending.previousWeek;
  const upcoming = context.cashflow.upcoming;
  const calendarPressure = summarizeCalendarPressure(signals.calendarContext);
  const summary = {
    billsDue: upcoming.billTotal,
    calendarPlannedSpendEvents: calendarPressure.plannedSpendEventCount,
    calendarPressure: calendarPressure.level,
    openReviewCount: context.review.openCount,
    projectedCash: upcoming.projectedCashBalance,
    reimbursementOutstanding: current.reimbursementOutstanding,
    startingCash: upcoming.startingCashBalance,
    weekSpend: current.spending,
    weekVsPrevious: roundMoney(current.spending - previous.spending)
  };
  const status = safeToSpendStatus({
    ...summary,
    amount: amount ?? 0
  });
  const response: OpenClawSafeToSpendResponse = {
    object: "ledger.openclaw.safe_to_spend",
    amount,
    asOfDate: context.asOfDate,
    generatedAt: signals.generatedAt,
    rationale: safeToSpendRationale(status, amount, summary, calendarRationaleClause(calendarPressure)),
    status,
    summary,
    safety: openClawReadSafety()
  };

  assertAssistantContextSafe(response);
  return response;
}

export function buildOpenClawQueryResponse(
  intent: OpenClawFinanceQueryIntent,
  result: OpenClawQueryResponse["result"],
  generatedAt = new Date().toISOString()
): OpenClawQueryResponse {
  const response: OpenClawQueryResponse = {
    object: "ledger.openclaw.query",
    generatedAt,
    intent,
    result,
    safety: openClawReadSafety()
  };
  assertAssistantContextSafe(response);
  return response;
}
