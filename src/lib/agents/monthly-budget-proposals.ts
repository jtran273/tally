import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  emptyUpcomingCalendarContext,
  loadUpcomingCalendarContext,
  summarizeCalendarPressure,
  type CalendarPressureSummary,
  type UpcomingCalendarContext,
  type UpcomingCalendarSuspectedCategory
} from "@/lib/calendar";
import type { AccountRecord, AgentProposalRecord, Database, Json, RecurringExpenseRecord, ReviewQueueItem, TransactionRecord } from "@/lib/db";
import {
  listAccounts,
  listRecurringExpenses,
  listReviewItems,
  listTransactions,
  upsertAgentProposalBySourceContext,
  type AgentProposalMutationInput,
  type FinanceSupabaseClient
} from "@/lib/db/queries";
import {
  buildBudgetGuardrailSummary,
  type BudgetGuardrailItem,
  type BudgetGuardrailSummary
} from "@/lib/finance/budget-guardrails";
import { getSupabaseConfig } from "@/lib/supabase/env";
import { assertAssistantContextSafe } from "./assistant-contract";
import { buildWeeklyPlanningContext, type WeeklyPlanningContext } from "./weekly-planning-context";

export class MonthlyBudgetProposalConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonthlyBudgetProposalConfigurationError";
  }
}

export interface MonthlyBudgetProposalCategory {
  amount: number;
  basis: "historical_guardrail";
  calendarAdjustmentPercent: number;
  currentAmount: number;
  label: string;
  projectedAmount: number;
  sourceBudgetAmount: number;
}

export interface MonthlyBudgetProposalPlan {
  categories: MonthlyBudgetProposalCategory[];
  month: string;
  totalAmount: number;
}

export interface MonthlyBudgetProposalCompileResult {
  plan: MonthlyBudgetProposalPlan;
  proposal: AgentProposalMutationInput;
  sourceContextId: string;
}

export interface PersistMonthlyBudgetProposalResult {
  plan: MonthlyBudgetProposalPlan;
  proposal: AgentProposalRecord;
}

const SOURCE_AGENT = "ledger-monthly-budget-proposal-generator";
const MAX_PROPOSAL_CATEGORIES = 8;
const MIN_CATEGORY_BUDGET_AMOUNT = 50;

export function resolveMonthlyBudgetProposalEnabled(value = process.env.MONTHLY_BUDGET_PROPOSAL_ENABLED) {
  return value?.trim().toLowerCase() === "true";
}

export function resolveMonthlyBudgetProposalUserId() {
  return process.env.MONTHLY_BUDGET_PROPOSAL_USER_ID?.trim() || process.env.OPENCLAW_USER_ID?.trim() || null;
}

export function createMonthlyBudgetProposalServiceContext(): { client: FinanceSupabaseClient; userId: string } {
  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const userId = resolveMonthlyBudgetProposalUserId();

  if (!config || !serviceRoleKey || !userId) {
    throw new MonthlyBudgetProposalConfigurationError(
      "Missing monthly budget proposal configuration. Set MONTHLY_BUDGET_PROPOSAL_USER_ID or OPENCLAW_USER_ID plus SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return {
    client: createClient<Database>(config.url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }) as unknown as FinanceSupabaseClient,
    userId
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function addDays(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function nextMonthKey(asOfDate: string) {
  const date = parseIsoDate(`${asOfDate.slice(0, 7)}-01`);
  return isoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 12))).slice(0, 7);
}

function deterministicUuid(value: string) {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

function safeJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function categoryMatchesPressure(label: string, category: UpcomingCalendarSuspectedCategory) {
  const normalized = label.toLowerCase();
  if (category === "dining") return /dining|restaurant|food|coffee|bar|cafe|meal/.test(normalized);
  if (category === "travel") return /travel|flight|airfare|train|transit/.test(normalized);
  if (category === "lodging") return /hotel|lodging|airbnb/.test(normalized);
  if (category === "rideshare") return /uber|lyft|rideshare|taxi/.test(normalized);
  if (category === "delivery") return /delivery|doordash|uber eats|postmates/.test(normalized);
  if (category === "gift" || category === "birthday" || category === "wedding") {
    return /gift|shopping|wedding|birthday/.test(normalized);
  }
  return false;
}

function calendarAdjustmentPercent(item: BudgetGuardrailItem, pressure: CalendarPressureSummary) {
  if (pressure.level !== "moderate" && pressure.level !== "high") return 0;
  const hasMatchingCategory = pressure.topPlannedSpendCategories.some((entry) =>
    categoryMatchesPressure(item.label, entry.category)
  );
  if (!hasMatchingCategory) return 0;
  return pressure.level === "high" ? 15 : 10;
}

function proposalCategory(item: BudgetGuardrailItem, pressure: CalendarPressureSummary): MonthlyBudgetProposalCategory {
  const adjustment = calendarAdjustmentPercent(item, pressure);
  const amount = roundMoney(item.budgetAmount * (1 + adjustment / 100));
  return {
    amount,
    basis: "historical_guardrail",
    calendarAdjustmentPercent: adjustment,
    currentAmount: item.currentAmount,
    label: item.label,
    projectedAmount: item.projectedAmount,
    sourceBudgetAmount: item.budgetAmount
  };
}

function monthlyBudgetCategories(guardrails: BudgetGuardrailSummary, pressure: CalendarPressureSummary) {
  return guardrails.items
    .filter((item) => item.budgetAmount >= MIN_CATEGORY_BUDGET_AMOUNT || item.currentAmount >= MIN_CATEGORY_BUDGET_AMOUNT)
    .map((item) => proposalCategory(item, pressure))
    .sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label))
    .slice(0, MAX_PROPOSAL_CATEGORIES);
}

function compactUncertaintyNotes(guardrails: BudgetGuardrailSummary, context: WeeklyPlanningContext) {
  const notes: string[] = [];
  if (context.review.openCount > 0) {
    notes.push(`${context.review.openCount} open reviews could shift category budgets`);
  }
  if (guardrails.items.some((item) => item.openReviewCount > 0)) {
    notes.push("reviewed totals separate trusted spend from unresolved review impact");
  }
  if (context.reimbursements.outstandingAmount > 0) {
    notes.push(`$${roundMoney(context.reimbursements.outstandingAmount)} outstanding reimbursements not treated as budget relief`);
  }
  if (context.cashflow.upcoming.billTotal > context.cashflow.upcoming.incomeTotal) {
    notes.push("upcoming bills exceed projected income in the next cashflow window");
  }
  return notes.slice(0, 3);
}

function evidenceCalendarPressure(pressure: CalendarPressureSummary) {
  if (pressure.level !== "moderate" && pressure.level !== "high") return null;
  const categories = pressure.topPlannedSpendCategories.map((entry) => entry.category).slice(0, 3);
  return categories.length > 0 ? { categories, level: pressure.level } : null;
}

export function buildMonthlyBudgetProposal({
  budgetGuardrails,
  calendarContext,
  generatedAt,
  weeklyPlanningContext
}: {
  budgetGuardrails: BudgetGuardrailSummary;
  calendarContext: UpcomingCalendarContext;
  generatedAt?: string;
  weeklyPlanningContext: WeeklyPlanningContext;
}): MonthlyBudgetProposalCompileResult | null {
  const calendarPressure = summarizeCalendarPressure(calendarContext);
  const categories = monthlyBudgetCategories(budgetGuardrails, calendarPressure);
  if (categories.length === 0) return null;

  const month = nextMonthKey(budgetGuardrails.asOfDate);
  const totalAmount = roundMoney(categories.reduce((sum, category) => sum + category.amount, 0));
  const sourceContextId = `monthly-budget-proposal:${month}`;
  const generated = generatedAt ?? weeklyPlanningContext.generatedAt;
  const pressureEvidence = evidenceCalendarPressure(calendarPressure);
  const uncertaintyNotes = compactUncertaintyNotes(budgetGuardrails, weeklyPlanningContext);
  const plan: MonthlyBudgetProposalPlan = {
    categories,
    month,
    totalAmount
  };
  const evidence = safeJson({
    basis: {
      baselineMonthCount: budgetGuardrails.baselineMonthCount,
      generatedFrom: "budget_guardrails",
      guardrailCategoryCount: budgetGuardrails.items.length,
      monthElapsedDays: budgetGuardrails.monthElapsedDays,
      monthTotalDays: budgetGuardrails.monthTotalDays
    },
    calendarPressure: pressureEvidence ?? undefined,
    cashflow: {
      nextWindowBillTotal: weeklyPlanningContext.cashflow.upcoming.billTotal,
      nextWindowIncomeTotal: weeklyPlanningContext.cashflow.upcoming.incomeTotal,
      nextWindowNetTotal: weeklyPlanningContext.cashflow.upcoming.netTotal
    },
    directFinanceWritesAllowed: false,
    generatedAt: generated,
    reimbursements: {
      outstandingAmount: weeklyPlanningContext.reimbursements.outstandingAmount,
      reimbursableAmount: weeklyPlanningContext.reimbursements.reimbursableAmount
    },
    review: {
      openCount: weeklyPlanningContext.review.openCount,
      unresolvedReviewAmount: weeklyPlanningContext.spending.currentWeek.unresolvedReviewSpending
    },
    uncertaintyNotes
  });
  const proposedPatch = safeJson({
    action: "review_monthly_budget_proposal",
    categories,
    directFinanceWritesAllowed: false,
    month,
    totalAmount
  });
  assertAssistantContextSafe(evidence);
  assertAssistantContextSafe(proposedPatch);

  return {
    plan,
    proposal: {
      confidence: null,
      evidence,
      expiresAt: `${addDays(budgetGuardrails.asOfDate, 14)}T23:59:59.999Z`,
      proposedPatch,
      proposalType: "monthly_budget_proposal",
      questionFingerprint: sourceContextId,
      sourceAgent: SOURCE_AGENT,
      sourceContextId,
      targetId: deterministicUuid(sourceContextId),
      targetKind: "monthly_budget"
    },
    sourceContextId
  };
}

export async function persistMonthlyBudgetProposal(
  client: FinanceSupabaseClient,
  userId: string,
  options: { now?: Date } = {}
): Promise<PersistMonthlyBudgetProposalResult | null> {
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const asOfDate = isoDate(now);
  const fromDate = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1, 12)));
  const [
    accounts,
    calendarContext,
    recurringExpenses,
    reviewItems,
    transactions
  ]: [
    AccountRecord[],
    UpcomingCalendarContext | null,
    RecurringExpenseRecord[],
    ReviewQueueItem[],
    TransactionRecord[]
  ] = await Promise.all([
    listAccounts(client, userId),
    loadUpcomingCalendarContext(client, userId, { generatedAt, now }),
    listRecurringExpenses(client, userId),
    listReviewItems(client, userId, "open", { includeRawContext: false }),
    listTransactions(client, userId, { fromDate, includeRawContext: false, limit: 500, toDate: asOfDate })
  ]);

  const weeklyPlanningContext = buildWeeklyPlanningContext({
    accounts,
    asOfDate,
    generatedAt,
    now,
    recurringExpenses,
    reviewItems,
    transactions
  });
  const budgetGuardrails = buildBudgetGuardrailSummary(transactions, { asOfDate, baselineMonths: 3 });
  const compiled = buildMonthlyBudgetProposal({
    budgetGuardrails,
    calendarContext: calendarContext ?? emptyUpcomingCalendarContext({ generatedAt, now }),
    generatedAt,
    weeklyPlanningContext
  });
  if (!compiled) return null;

  return {
    plan: compiled.plan,
    proposal: await upsertAgentProposalBySourceContext(client, userId, compiled.proposal, { now })
  };
}
