import { createHash } from "node:crypto";
import type { AgentProposalRecord, Json } from "@/lib/db/types";
import {
  listAccounts,
  listAgentProposals,
  listRecurringExpenses,
  listReviewItems,
  listTransactions,
  upsertAgentProposalBySourceContext,
  type AgentProposalMutationInput,
  type FinanceSupabaseClient
} from "@/lib/db/queries";
import { emptyUpcomingCalendarContext, loadUpcomingCalendarContext, type UpcomingCalendarContext } from "@/lib/calendar";
import { openClawTransactionWindow } from "@/lib/openclaw/signals";
import { assertAssistantContextSafe } from "./assistant-contract";
import type { WeeklyPlanningContext } from "./weekly-planning-context";
import { buildWeeklyPlanningContext } from "./weekly-planning-context";

export type OpenClawBriefingCadence = "daily" | "weekly";
export type OpenClawBriefingMotion = "down" | "flat" | "up";

export interface OpenClawBriefingDelta {
  currentAmount: number;
  deltaAmount: number;
  deltaPercent: number;
  previousAmount: number;
}

export interface OpenClawBriefingCategoryMotion {
  amount: number;
  category: string;
  count: number;
  deltaAmount: number;
  deltaPercent: number;
  motion: OpenClawBriefingMotion;
  openReviewCount: number;
  previousAmount: number;
}

export interface OpenClawBriefingReimbursementCandidate {
  amount: number | null;
  confidence: number | null;
  date: string | null;
  merchant: string | null;
  proposalId: string;
  question: string | null;
  suggestedInflowCount: number;
  targetId: string;
}

export interface OpenClawBriefingCalendarPressure {
  busyDayCount: number;
  categories: UpcomingCalendarContext["categories"];
  eventCount: number;
  level: "high" | "light" | "moderate" | "none";
  notableEvents: Array<{
    category: string;
    date: string;
    locationCity: string | null;
    title: string;
  }>;
}

export interface OpenClawBriefing {
  object: "ledger.openclaw.briefing";
  asOfDate: string;
  cadence: OpenClawBriefingCadence;
  calendarPressure: OpenClawBriefingCalendarPressure;
  financeMotion: {
    income: OpenClawBriefingDelta;
    netCashflow: OpenClawBriefingDelta;
    reimbursementOutstanding: OpenClawBriefingDelta;
    reimbursable: OpenClawBriefingDelta;
    spending: OpenClawBriefingDelta;
  };
  generatedAt: string;
  reimbursementCandidates: {
    count: number;
    top: OpenClawBriefingReimbursementCandidate[];
  };
  suggestedQuestions: string[];
  topCategories: OpenClawBriefingCategoryMotion[];
  window: WeeklyPlanningContext["window"];
}

export interface OpenClawBriefingProposalResult {
  briefing: OpenClawBriefing;
  proposal: AgentProposalMutationInput;
  sourceContextId: string;
}

export interface PersistOpenClawBriefingResult {
  briefing: OpenClawBriefing;
  proposal: AgentProposalRecord;
}

const SOURCE_AGENT = "ledger-openclaw-briefing-compiler";
const DEFAULT_BRIEFING_CADENCE: OpenClawBriefingCadence = "weekly";

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function deltaPercent(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function delta(currentAmount: number, previousAmount: number): OpenClawBriefingDelta {
  const current = roundMoney(currentAmount);
  const previous = roundMoney(previousAmount);
  return {
    currentAmount: current,
    deltaAmount: roundMoney(current - previous),
    deltaPercent: deltaPercent(current, previous),
    previousAmount: previous
  };
}

function motion(deltaAmount: number): OpenClawBriefingMotion {
  if (deltaAmount > 0) return "up";
  if (deltaAmount < 0) return "down";
  return "flat";
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function expiresAtForCadence(asOfDate: string, cadence: OpenClawBriefingCadence) {
  const days = cadence === "daily" ? 2 : 14;
  return `${addDays(asOfDate, days)}T23:59:59.999Z`;
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

function jsonObject(value: Json | undefined): Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function stringValue(value: Json | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: Json | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayValue(value: Json | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function proposalTransactionEvidence(proposal: AgentProposalRecord) {
  return jsonObject(jsonObject(proposal.evidence).transaction);
}

function proposalPatch(proposal: AgentProposalRecord) {
  return jsonObject(proposal.proposedPatch);
}

function reimbursementCandidate(proposal: AgentProposalRecord): OpenClawBriefingReimbursementCandidate {
  const transaction = proposalTransactionEvidence(proposal);
  const patch = proposalPatch(proposal);
  const amount = numberValue(transaction.amount);

  return {
    amount: amount === null ? null : roundMoney(Math.abs(amount)),
    confidence: proposal.confidence,
    date: stringValue(transaction.date),
    merchant: stringValue(transaction.merchant),
    proposalId: proposal.id,
    question: proposal.clarificationQuestion ?? stringValue(patch.question),
    suggestedInflowCount: stringArrayValue(patch.suggestedInflowIds).length,
    targetId: proposal.targetId
  };
}

function topReimbursementCandidates(proposals: readonly AgentProposalRecord[]) {
  return proposals
    .filter((proposal) => proposal.proposalType === "reimbursement_candidate" && proposal.status === "pending")
    .map(reimbursementCandidate)
    .sort((left, right) =>
      (right.confidence ?? 0) - (left.confidence ?? 0) ||
      (right.amount ?? 0) - (left.amount ?? 0) ||
      left.proposalId.localeCompare(right.proposalId)
    )
    .slice(0, 3);
}

function calendarPressure(calendar: UpcomingCalendarContext): OpenClawBriefingCalendarPressure {
  const busyDays = new Set(calendar.events.map((event) => event.start.slice(0, 10)));
  const eventCount = calendar.eventCount;
  const travelPressure = (calendar.categories.travel ?? 0) + (calendar.categories.lodging ?? 0);
  const level = eventCount === 0
    ? "none"
    : eventCount >= 8 || travelPressure >= 2
      ? "high"
      : eventCount >= 4 || travelPressure >= 1
        ? "moderate"
        : "light";

  return {
    busyDayCount: busyDays.size,
    categories: calendar.categories,
    eventCount,
    level,
    notableEvents: calendar.events
      .filter((event) => event.suspected_category !== "other")
      .slice(0, 5)
      .map((event) => ({
        category: event.suspected_category,
        date: event.start.slice(0, 10),
        locationCity: event.locationCity,
        title: event.title
      }))
  };
}

function topCategories(context: WeeklyPlanningContext): OpenClawBriefingCategoryMotion[] {
  return context.spending.currentWeek.topCategories.slice(0, 5).map((category) => ({
    amount: category.amount,
    category: category.label,
    count: category.count,
    deltaAmount: category.deltaAmount,
    deltaPercent: category.deltaPercent,
    motion: motion(category.deltaAmount),
    openReviewCount: category.openReviewCount,
    previousAmount: category.previousAmount
  }));
}

function suggestedQuestions(
  context: WeeklyPlanningContext,
  categories: readonly OpenClawBriefingCategoryMotion[],
  reimbursementCandidates: readonly OpenClawBriefingReimbursementCandidate[],
  pressure: OpenClawBriefingCalendarPressure
) {
  const questions: string[] = [];
  const risingCategory = categories.find((category) => category.deltaAmount >= 50);

  if (risingCategory) {
    questions.push(`Do you want to review why ${risingCategory.category} spending is up $${risingCategory.deltaAmount.toFixed(2)} this week?`);
  }
  if (reimbursementCandidates.length > 0) {
    questions.push(`Should any of the ${reimbursementCandidates.length} top reimbursement candidates be marked reimbursable or matched to inflows?`);
  }
  if (pressure.level === "high" || pressure.level === "moderate") {
    questions.push("Do upcoming calendar commitments change the budget plan for travel, dining, gifts, or rideshares?");
  }
  if (context.review.openCount > 0) {
    questions.push(`Do you want to clear ${context.review.openCount} open transaction review items before planning the week?`);
  }
  if (questions.length === 0) {
    questions.push("Is there anything unusual this week that should change the plan before the next Ledger sync?");
  }

  return questions.slice(0, 4);
}

function sourceContextId(context: WeeklyPlanningContext, cadence: OpenClawBriefingCadence) {
  return cadence === "daily"
    ? `openclaw-briefing:daily:${context.asOfDate}`
    : `openclaw-briefing:weekly:${context.window.fromDate}:${context.window.toDate}`;
}

function safeJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export function resolveOpenClawBriefingCadence(value = process.env.OPENCLAW_BRIEFING_CADENCE): OpenClawBriefingCadence {
  const normalized = value?.trim().toLowerCase() || DEFAULT_BRIEFING_CADENCE;
  if (normalized === "daily" || normalized === "weekly") return normalized;
  throw new Error("OPENCLAW_BRIEFING_CADENCE must be daily or weekly.");
}

export function buildOpenClawBriefingProposal({
  calendarContext,
  cadence = DEFAULT_BRIEFING_CADENCE,
  generatedAt,
  reimbursementCandidates,
  weeklyPlanningContext
}: {
  calendarContext: UpcomingCalendarContext;
  cadence?: OpenClawBriefingCadence;
  generatedAt?: string;
  reimbursementCandidates: readonly AgentProposalRecord[];
  weeklyPlanningContext: WeeklyPlanningContext;
}): OpenClawBriefingProposalResult {
  const resolvedGeneratedAt = generatedAt ?? weeklyPlanningContext.generatedAt;
  const topCandidates = topReimbursementCandidates(reimbursementCandidates);
  const categories = topCategories(weeklyPlanningContext);
  const pressure = calendarPressure(calendarContext);
  const briefing: OpenClawBriefing = {
    object: "ledger.openclaw.briefing",
    asOfDate: weeklyPlanningContext.asOfDate,
    cadence,
    calendarPressure: pressure,
    financeMotion: {
      income: delta(
        weeklyPlanningContext.spending.currentWeek.income,
        weeklyPlanningContext.spending.previousWeek.income
      ),
      netCashflow: delta(
        weeklyPlanningContext.spending.currentWeek.netCashflow,
        weeklyPlanningContext.spending.previousWeek.netCashflow
      ),
      reimbursementOutstanding: delta(
        weeklyPlanningContext.spending.currentWeek.reimbursementOutstanding,
        weeklyPlanningContext.spending.previousWeek.reimbursementOutstanding
      ),
      reimbursable: delta(
        weeklyPlanningContext.spending.currentWeek.reimbursable,
        weeklyPlanningContext.spending.previousWeek.reimbursable
      ),
      spending: delta(
        weeklyPlanningContext.spending.currentWeek.spending,
        weeklyPlanningContext.spending.previousWeek.spending
      )
    },
    generatedAt: resolvedGeneratedAt,
    reimbursementCandidates: {
      count: reimbursementCandidates.filter((proposal) =>
        proposal.proposalType === "reimbursement_candidate" && proposal.status === "pending"
      ).length,
      top: topCandidates
    },
    suggestedQuestions: [],
    topCategories: categories,
    window: weeklyPlanningContext.window
  };
  briefing.suggestedQuestions = suggestedQuestions(weeklyPlanningContext, categories, topCandidates, pressure);

  const contextId = sourceContextId(weeklyPlanningContext, cadence);
  const evidence = safeJson({ briefing });
  const proposedPatch = safeJson({
    action: "review_openclaw_briefing",
    suggestedQuestions: briefing.suggestedQuestions
  });
  assertAssistantContextSafe(evidence);
  assertAssistantContextSafe(proposedPatch);

  return {
    briefing,
    sourceContextId: contextId,
    proposal: {
      confidence: null,
      evidence,
      expiresAt: expiresAtForCadence(weeklyPlanningContext.asOfDate, cadence),
      proposedPatch,
      proposalType: "openclaw_briefing",
      questionFingerprint: contextId,
      sourceAgent: SOURCE_AGENT,
      sourceContextId: contextId,
      targetId: deterministicUuid(contextId),
      targetKind: "openclaw_briefing"
    }
  };
}

export async function persistOpenClawBriefing(
  client: FinanceSupabaseClient,
  userId: string,
  options: {
    cadence?: OpenClawBriefingCadence;
    now?: Date;
  } = {}
): Promise<PersistOpenClawBriefingResult> {
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const cadence = options.cadence ?? resolveOpenClawBriefingCadence();
  const { fromDate, toDate } = openClawTransactionWindow(now);
  const [
    accounts,
    calendarContext,
    pendingProposals,
    recurringExpenses,
    reviewItems,
    transactions
  ] = await Promise.all([
    listAccounts(client, userId),
    loadUpcomingCalendarContext(client, userId, { generatedAt, now }),
    listAgentProposals(client, userId, { status: "pending" }),
    listRecurringExpenses(client, userId),
    listReviewItems(client, userId, "open"),
    listTransactions(client, userId, { fromDate, limit: 250, toDate })
  ]);

  const weeklyPlanningContext = buildWeeklyPlanningContext({
    accounts,
    generatedAt,
    now,
    recurringExpenses,
    reviewItems,
    transactions
  });
  const compiled = buildOpenClawBriefingProposal({
    calendarContext: calendarContext ?? emptyUpcomingCalendarContext({ generatedAt, now }),
    cadence,
    generatedAt,
    reimbursementCandidates: pendingProposals,
    weeklyPlanningContext
  });

  return {
    briefing: compiled.briefing,
    proposal: await upsertAgentProposalBySourceContext(
      client,
      userId,
      compiled.proposal,
      { now }
    )
  };
}
