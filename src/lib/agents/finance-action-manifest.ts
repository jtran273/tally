import type {
  AccountRecord,
  ReviewQueueItem,
  ReviewReason,
  TransactionIntent,
  TransactionRecord
} from "@/lib/db";
import { accountSyncState, summarizeSync, type SyncSummary } from "@/lib/finance/balances";
import { buildReimbursementReportingSummary } from "@/lib/finance/reimbursements";
import { transactionSpendingAmount } from "@/lib/finance/spending";
import type { WeeklyPlanningContext } from "./weekly-planning-context";

export const FINANCE_ACTION_MANIFEST_VERSION = "2026-05-06" as const;
export const FINANCE_ACTION_MANIFEST_MODE = "proposal-only" as const;

export const financeReadActionIds = [
  "read.weekly_planning_context",
  "read.review_queue_summary",
  "read.spending_summary",
  "read.stale_sync_summary"
] as const;

export const financeProposalActionIds = [
  "propose.review_suggestions",
  "propose.merchant_rule"
] as const;

export const financeActionIds = [
  ...financeReadActionIds,
  ...financeProposalActionIds
] as const;

export type FinanceReadActionId = typeof financeReadActionIds[number];
export type FinanceProposalActionId = typeof financeProposalActionIds[number];
export type FinanceActionId = typeof financeActionIds[number];

export const forbiddenFinanceManifestFields = [
  "access_token_ciphertext",
  "auth_header",
  "authorization",
  "cookie",
  "location",
  "openai_api_key",
  "payment_meta",
  "plaid_access_token",
  "plaid_account_id",
  "plaid_item_id",
  "plaid_secret",
  "plaid_transaction_id",
  "raw_payload",
  "service_role_key",
  "set_cookie",
  "supabase_service_role_key",
  "transaction_cursor"
] as const;

const forbiddenFieldSet = new Set<string>(forbiddenFinanceManifestFields);

export interface FinanceAgentCapability {
  action: FinanceActionId;
  approvalRequired: boolean;
  description: string;
  kind: "read" | "proposal";
}

export interface ReviewQueueSummary {
  action: "read.review_queue_summary";
  examples: ReviewQueueSummaryExample[];
  generatedAt: string;
  openCount: number;
  reasonCounts: Partial<Record<ReviewReason, number>>;
  totalAbsoluteAmount: number;
}

export interface ReviewQueueSummaryExample {
  amount: number;
  category: string;
  confidence: number | null;
  date: string;
  intent: TransactionIntent;
  merchant: string;
  reason: ReviewReason;
  reviewItemId: string;
  transactionId: string;
}

export interface SpendingSummary {
  action: "read.spending_summary";
  byCategory: SpendingSummaryBucket[];
  byIntent: SpendingSummaryIntentBucket[];
  fromDate: string | null;
  generatedAt: string;
  openReviewCount: number;
  reimbursementOutstanding: number;
  reimbursableAmount: number;
  reimbursedAmount: number;
  toDate: string | null;
  totalSpending: number;
  transactionCount: number;
}

export interface SpendingSummaryBucket {
  category: string;
  transactionCount: number;
  total: number;
}

export interface SpendingSummaryIntentBucket {
  intent: TransactionIntent;
  transactionCount: number;
  total: number;
}

export interface StaleSyncSummary {
  action: "read.stale_sync_summary";
  accounts: StaleSyncAccountExample[];
  generatedAt: string;
  summary: SyncSummary;
}

export interface StaleSyncAccountExample {
  accountId: string;
  accountName: string;
  institutionName: string;
  lastSyncedAt: string | null;
  state: "fresh" | "stale" | "never";
  type: AccountRecord["type"];
}

export interface ReviewSuggestionProposal {
  action: "propose.review_suggestions";
  categoryId?: string | null;
  categoryName?: string;
  confidence?: number;
  intent?: TransactionIntent;
  merchantName?: string;
  proposalId: string;
  rationale: string;
  recurring?: boolean;
  reviewItemId: string;
  transactionId: string;
}

export interface MerchantRuleProposal {
  action: "propose.merchant_rule";
  categoryId?: string | null;
  intent?: TransactionIntent | null;
  isRecurring?: boolean | null;
  maxAmount?: number | null;
  merchantPattern: string;
  minAmount?: number | null;
  normalizedMerchantName?: string | null;
  priority?: number;
  proposalId: string;
  rationale: string;
}

export type FinanceProposal = ReviewSuggestionProposal | MerchantRuleProposal;

export interface FinanceAgentManifestEnvelope {
  actions: FinanceActionId[];
  forbiddenFieldCheck: "passed";
  handoffId: string;
  manifestVersion: typeof FINANCE_ACTION_MANIFEST_VERSION;
  mode: typeof FINANCE_ACTION_MANIFEST_MODE;
  proposals: FinanceProposal[];
  source: "ledger";
  summary: Partial<{
    weeklyPlanning: WeeklyPlanningContext;
    reviewQueue: ReviewQueueSummary;
    spending: SpendingSummary;
    staleSync: StaleSyncSummary;
  }>;
  userScoped: true;
}

export interface ForbiddenFieldViolation {
  field: string;
  path: string;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeFieldName(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function sumReasonCounts(items: readonly ReviewQueueItem[]) {
  return items.reduce<Partial<Record<ReviewReason, number>>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    return counts;
  }, {});
}

export function listFinanceAgentCapabilities(): FinanceAgentCapability[] {
  return [
    {
      action: "read.weekly_planning_context",
      approvalRequired: false,
      description: "Read a bounded, AI-safe weekly planning context composed from deterministic finance summaries.",
      kind: "read"
    },
    {
      action: "read.review_queue_summary",
      approvalRequired: false,
      description: "Read minimized counts and examples for open review queue items.",
      kind: "read"
    },
    {
      action: "read.spending_summary",
      approvalRequired: false,
      description: "Read grouped spending totals over a bounded transaction set.",
      kind: "read"
    },
    {
      action: "read.stale_sync_summary",
      approvalRequired: false,
      description: "Read fresh, stale, and never-synced account counts with limited account examples.",
      kind: "read"
    },
    {
      action: "propose.review_suggestions",
      approvalRequired: true,
      description: "Draft review item suggestions that require explicit user approval before writes.",
      kind: "proposal"
    },
    {
      action: "propose.merchant_rule",
      approvalRequired: true,
      description: "Draft merchant rule proposals that require explicit user approval before writes.",
      kind: "proposal"
    }
  ];
}

export function buildReviewQueueSummary(
  reviewItems: readonly ReviewQueueItem[],
  options: { generatedAt?: string; limit?: number } = {}
): ReviewQueueSummary {
  const limit = options.limit ?? 5;
  const sorted = [...reviewItems].sort((left, right) =>
    Math.abs(right.transaction.amount) - Math.abs(left.transaction.amount)
  );

  return {
    action: "read.review_queue_summary",
    examples: sorted.slice(0, limit).map((item) => ({
      amount: item.transaction.amount,
      category: item.transaction.category,
      confidence: item.confidence,
      date: item.transaction.date,
      intent: item.transaction.intent,
      merchant: item.transaction.merchant,
      reason: item.reason,
      reviewItemId: item.id,
      transactionId: item.transaction.id
    })),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    openCount: reviewItems.length,
    reasonCounts: sumReasonCounts(reviewItems),
    totalAbsoluteAmount: roundMoney(
      reviewItems.reduce((sum, item) => sum + Math.abs(item.transaction.amount), 0)
    )
  };
}

export function buildSpendingSummary(
  transactions: readonly TransactionRecord[],
  options: { fromDate?: string | null; generatedAt?: string; toDate?: string | null } = {}
): SpendingSummary {
  const byCategory = new Map<string, SpendingSummaryBucket>();
  const byIntent = new Map<TransactionIntent, SpendingSummaryIntentBucket>();
  let totalSpending = 0;

  transactions.forEach((transaction) => {
    const spending = transactionSpendingAmount(transaction);
    if (spending <= 0) return;

    totalSpending += spending;

    const category = transaction.category || "Uncategorized";
    const categoryBucket = byCategory.get(category) ?? { category, total: 0, transactionCount: 0 };
    categoryBucket.total = roundMoney(categoryBucket.total + spending);
    categoryBucket.transactionCount += 1;
    byCategory.set(category, categoryBucket);

    const intentBucket = byIntent.get(transaction.intent) ?? {
      intent: transaction.intent,
      total: 0,
      transactionCount: 0
    };
    intentBucket.total = roundMoney(intentBucket.total + spending);
    intentBucket.transactionCount += 1;
    byIntent.set(transaction.intent, intentBucket);
  });
  const reimbursement = buildReimbursementReportingSummary(transactions);

  return {
    action: "read.spending_summary",
    byCategory: [...byCategory.values()].sort((left, right) => right.total - left.total),
    byIntent: [...byIntent.values()].sort((left, right) => right.total - left.total),
    fromDate: options.fromDate ?? null,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    openReviewCount: transactions.filter((transaction) => transaction.reviewStatus === "open").length,
    reimbursementOutstanding: reimbursement.outstandingAmount,
    reimbursableAmount: reimbursement.reimbursableAmount,
    reimbursedAmount: reimbursement.receivedAmount,
    toDate: options.toDate ?? null,
    totalSpending: roundMoney(totalSpending),
    transactionCount: transactions.length
  };
}

export function buildStaleSyncSummary(
  accounts: readonly AccountRecord[],
  options: { generatedAt?: string; limit?: number; now?: Date; staleAfterHours?: number } = {}
): StaleSyncSummary {
  const limit = options.limit ?? 5;
  const sorted = [...accounts].sort((left, right) => {
    const leftState = accountSyncState(left, options);
    const rightState = accountSyncState(right, options);
    const stateRank = { never: 0, stale: 1, fresh: 2 };
    const rankDelta = stateRank[leftState] - stateRank[rightState];
    if (rankDelta !== 0) return rankDelta;
    return (left.lastSyncedAt ?? "").localeCompare(right.lastSyncedAt ?? "");
  });

  return {
    action: "read.stale_sync_summary",
    accounts: sorted.slice(0, limit).map((account) => ({
      accountId: account.id,
      accountName: account.name,
      institutionName: account.institutionName,
      lastSyncedAt: account.lastSyncedAt,
      state: accountSyncState(account, options),
      type: account.type
    })),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    summary: summarizeSync(accounts, options)
  };
}

export function findForbiddenFinanceManifestFields(value: unknown): ForbiddenFieldViolation[] {
  const violations: ForbiddenFieldViolation[] = [];
  const seen = new WeakSet<object>();

  function visit(current: unknown, path: string) {
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    Object.entries(current as Record<string, unknown>).forEach(([key, nested]) => {
      const normalizedKey = normalizeFieldName(key);
      const nextPath = path ? `${path}.${key}` : key;
      if (forbiddenFieldSet.has(normalizedKey)) {
        violations.push({ field: key, path: nextPath });
      }
      visit(nested, nextPath);
    });
  }

  visit(value, "");
  return violations;
}

export function assertFinanceManifestSafe(value: unknown): void {
  const violations = findForbiddenFinanceManifestFields(value);
  if (violations.length > 0) {
    const paths = violations.map((violation) => violation.path).join(", ");
    throw new Error(`Finance agent manifest contains forbidden fields: ${paths}`);
  }
}

export function buildFinanceAgentManifestEnvelope(input: {
  actions: readonly FinanceActionId[];
  handoffId: string;
  proposals?: readonly FinanceProposal[];
  summary?: FinanceAgentManifestEnvelope["summary"];
}): FinanceAgentManifestEnvelope {
  const envelope: FinanceAgentManifestEnvelope = {
    actions: [...input.actions],
    forbiddenFieldCheck: "passed",
    handoffId: input.handoffId,
    manifestVersion: FINANCE_ACTION_MANIFEST_VERSION,
    mode: FINANCE_ACTION_MANIFEST_MODE,
    proposals: [...(input.proposals ?? [])],
    source: "ledger",
    summary: input.summary ?? {},
    userScoped: true
  };

  assertFinanceManifestSafe(envelope);
  return envelope;
}
