import {
  assertAssistantContextSafe,
  buildWeeklyPlanningContext,
  forbiddenAssistantContextFields
} from "@/lib/agents";
import type { AgentProposalRecord, FinanceSupabaseClient, Json } from "@/lib/db";
import {
  listAccounts,
  listAgentProposals,
  listRecurringExpenses,
  listReviewItems,
  listTransactions
} from "@/lib/db";
import { emptyUpcomingCalendarContext, loadUpcomingCalendarContext } from "@/lib/calendar";
import {
  OPENCLAW_SIGNAL_CONTRACT_VERSION,
  type OpenClawClarificationQuestion,
  type OpenClawProposalSignal,
  type OpenClawSignalsResponse
} from "./types";

const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_OPEN_QUESTION_LIMIT = 25;
const DEFAULT_TRANSACTION_LOOKBACK_DAYS = 120;
const DEFAULT_TRANSACTION_LIMIT = 250;
const OPENCLAW_STRIPPED_EVIDENCE_KEYS = new Set(["aiProvider", "provider", "providerId", "provider_id"]);

export class OpenClawSignalsBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawSignalsBadRequestError";
  }
}

export interface OpenClawSignalsLoadOptions {
  now?: Date;
  openQuestionLimit?: number;
  since?: string;
}

export interface OpenClawSignalsBuildInput {
  calendarContext?: OpenClawSignalsResponse["calendarContext"];
  generatedAt: string;
  openClarificationProposals: readonly AgentProposalRecord[];
  pendingProposals: readonly AgentProposalRecord[];
  since: string;
  weeklyPlanningContext: OpenClawSignalsResponse["weeklyPlanningContext"];
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function defaultSince(now: Date) {
  return new Date(now.getTime() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
}

export function openClawTransactionWindow(now = new Date()) {
  const asOfDate = isoDate(now);
  return {
    asOfDate,
    fromDate: addDays(asOfDate, -DEFAULT_TRANSACTION_LOOKBACK_DAYS),
    toDate: asOfDate
  };
}

export function resolveOpenClawSince(value: string | null | undefined, now = new Date()) {
  if (!value) return defaultSince(now);

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new OpenClawSignalsBadRequestError("since must be a valid ISO timestamp.");
  }

  return new Date(parsed).toISOString();
}

function cloneOpenClawJson(value: Json): Json {
  if (Array.isArray(value)) return value.map(cloneOpenClawJson) as Json;
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, nested]) => !OPENCLAW_STRIPPED_EVIDENCE_KEYS.has(key) && nested !== undefined)
      .map(([key, nested]) => [key, cloneOpenClawJson(nested as Json)])
  ) as Json;
}

function proposalSignal(proposal: AgentProposalRecord): OpenClawProposalSignal {
  return {
    id: proposal.id,
    clarificationQuestion: proposal.clarificationQuestion,
    confidence: proposal.confidence,
    createdAt: proposal.createdAt,
    evidence: cloneOpenClawJson(proposal.evidence),
    expiresAt: proposal.expiresAt,
    proposalType: proposal.proposalType,
    proposedPatch: cloneOpenClawJson(proposal.proposedPatch),
    questionFingerprint: proposal.questionFingerprint,
    sourceAgent: proposal.sourceAgent,
    status: proposal.status,
    targetId: proposal.targetId,
    targetKind: proposal.targetKind,
    updatedAt: proposal.updatedAt
  };
}

function clarificationQuestion(proposal: AgentProposalRecord): OpenClawClarificationQuestion | null {
  const question = proposal.clarificationQuestion?.trim();
  if (!question) return null;

  return {
    confidence: proposal.confidence,
    createdAt: proposal.createdAt,
    evidence: cloneOpenClawJson(proposal.evidence),
    expiresAt: proposal.expiresAt,
    proposalId: proposal.id,
    proposedPatch: cloneOpenClawJson(proposal.proposedPatch),
    question,
    questionFingerprint: proposal.questionFingerprint,
    targetId: proposal.targetId,
    targetKind: proposal.targetKind
  };
}

export function selectOpenClarificationProposals(
  proposals: readonly AgentProposalRecord[],
  limit: number
): AgentProposalRecord[] {
  return proposals
    .filter((proposal) => proposal.status === "pending" && Boolean(proposal.clarificationQuestion?.trim()))
    .slice(0, limit);
}

export function buildOpenClawSignalsResponse({
  calendarContext,
  generatedAt,
  openClarificationProposals,
  pendingProposals,
  since,
  weeklyPlanningContext
}: OpenClawSignalsBuildInput): OpenClawSignalsResponse {
  const response: OpenClawSignalsResponse = {
    object: "ledger.openclaw.signals",
    calendarContext: calendarContext ?? emptyUpcomingCalendarContext({
      generatedAt,
      now: new Date(`${weeklyPlanningContext.asOfDate}T12:00:00.000Z`)
    }),
    contractVersion: OPENCLAW_SIGNAL_CONTRACT_VERSION,
    generatedAt,
    nextCursor: generatedAt,
    openClarificationQuestions: openClarificationProposals
      .map(clarificationQuestion)
      .filter((question): question is OpenClawClarificationQuestion => question !== null),
    pendingProposals: pendingProposals.map(proposalSignal),
    safety: {
      excludedFields: forbiddenAssistantContextFields,
      rawProviderPayloadIncluded: false,
      secretsIncluded: false,
      userScoped: true,
      writesAllowed: false
    },
    since,
    weeklyPlanningContext
  };

  assertAssistantContextSafe(response);
  return response;
}

export async function loadOpenClawSignals(
  client: FinanceSupabaseClient,
  userId: string,
  options: OpenClawSignalsLoadOptions = {}
): Promise<OpenClawSignalsResponse> {
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const since = resolveOpenClawSince(options.since, now);
  const { asOfDate, fromDate, toDate } = openClawTransactionWindow(now);
  const openQuestionLimit = options.openQuestionLimit ?? DEFAULT_OPEN_QUESTION_LIMIT;

  const [
    pendingProposals,
    openClarificationProposals,
    accounts,
    calendarContext,
    transactions,
    reviewItems,
    recurringExpenses
  ] = await Promise.all([
    listAgentProposals(client, userId, { since, status: "pending" }),
    listAgentProposals(client, userId, { status: "pending" }),
    listAccounts(client, userId),
    loadUpcomingCalendarContext(client, userId, { generatedAt, now }),
    listTransactions(client, userId, { fromDate, limit: DEFAULT_TRANSACTION_LIMIT, toDate }),
    listReviewItems(client, userId, "open"),
    listRecurringExpenses(client, userId)
  ]);

  return buildOpenClawSignalsResponse({
    generatedAt,
    calendarContext,
    openClarificationProposals: selectOpenClarificationProposals(openClarificationProposals, openQuestionLimit),
    pendingProposals,
    since,
    weeklyPlanningContext: buildWeeklyPlanningContext({
      accounts,
      generatedAt,
      now,
      recurringExpenses,
      reviewItems,
      transactions
    })
  });
}
