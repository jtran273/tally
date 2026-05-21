import { assertAssistantContextSafe } from "@/lib/agents";
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
  state: ReturnType<typeof summarizeTransactionReimbursement>["state"];
}

export interface OpenClawReimbursementsResponse {
  object: "ledger.openclaw.reimbursements";
  generatedAt: string;
  items: OpenClawReimbursementItem[];
  limit: number;
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

function accountNickname(transaction: TransactionRecord) {
  return transaction.accountName.trim() || "Account";
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
        merchant: transaction.merchant,
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
      explanation: item.explanation,
      merchant: item.transaction.merchant,
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
  const items = transactions
    .map((transaction) => ({
      transaction,
      reimbursement: summarizeTransactionReimbursement(transaction)
    }))
    .filter(({ reimbursement }) => reimbursement.state !== "none")
    .sort((left, right) => right.reimbursement.outstandingAmount - left.reimbursement.outstandingAmount)
    .slice(0, limit)
    .map(({ transaction, reimbursement }) => ({
      transactionId: transaction.id,
      amount: transaction.amount,
      date: transaction.date,
      expectedAmount: reimbursement.expectedAmount,
      merchant: transaction.merchant,
      outstandingAmount: reimbursement.outstandingAmount,
      receivedAmount: reimbursement.receivedAmount,
      state: reimbursement.state
    }));

  const summary = items.reduce(
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

function safeToSpendStatus(input: {
  amount: number;
  billsDue: number;
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
  return "green";
}

function safeToSpendRationale(status: OpenClawSafeToSpendResponse["status"], amount: number | null, summary: OpenClawSafeToSpendResponse["summary"]) {
  const amountText = amount === null ? "new spending" : `$${Math.round(amount).toLocaleString("en-US")}`;
  if (status === "red") {
    return `${amountText} would push projected cash below zero after upcoming bills.`;
  }
  if (summary.openReviewCount > 0 || summary.reimbursementOutstanding > 0) {
    return `${amountText} is possible, but open reviews or reimbursements make the current picture less clean.`;
  }
  if (status === "yellow") {
    return `${amountText} is possible, but upcoming bills or this week's pace make it worth keeping tight.`;
  }
  return `${amountText} looks reasonable against projected cash, bills due, and this week's pace.`;
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
  const summary = {
    billsDue: upcoming.billTotal,
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
    rationale: safeToSpendRationale(status, amount, summary),
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
