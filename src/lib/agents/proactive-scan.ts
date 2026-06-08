import { createClient } from "@supabase/supabase-js";
import { createAutoReviewTransactionSuggestionService, isOpenAiAutoReviewEnabled } from "@/lib/ai/server";
import type { TransactionSuggestionService } from "@/lib/ai/suggestion-service";
import type { AiSuggestionProviderKind } from "@/lib/ai/types";
import type { AgentProposalRecord, AuditEventInput, Database, TransactionRecord } from "@/lib/db";
import {
  listAgentProposals,
  listTransactions,
  recordAuditEvent,
  type AgentProposalListFilters,
  type FinanceSupabaseClient,
  type TransactionListFilters
} from "@/lib/db/queries";
import {
  createReimbursementMatchProposals,
  type PersistReimbursementMatchProposalInput
} from "@/lib/agents/reimbursement-match-proposals";
import { createDetectedReimbursementCandidateProposals } from "@/lib/review/reimbursement-candidates";
import type { PersistReimbursementCandidateInput } from "@/lib/review/reimbursement-candidates";
import { logSafeError } from "@/lib/security/logging";
import { getSupabaseConfig } from "@/lib/supabase/env";

export interface ProactiveScanResult {
  createdProposalCount: number;
  errorCode: "detector_failed" | "proposal_schema_missing" | null;
  fromDate: string;
  includeDisconnectedAccounts: boolean;
  maxCandidateProposals: number;
  maxTransactions: number;
  mode: ProactiveScanMode;
  openAiAutoReviewEnabled: boolean;
  scannedTransactionCount: number;
  status: "disabled" | "failed" | "succeeded";
  suggestionProviderKind: AiSuggestionProviderKind | null;
  suggestionProviderVersion: string | null;
  toDate: string;
}

export type ProactiveScanMode = "recent" | "historical_backfill";

type ProactiveScanSuggestionService = Pick<TransactionSuggestionService, "suggestReimbursementCandidate"> & {
  readonly adapter?: {
    readonly descriptor?: {
      readonly kind: AiSuggestionProviderKind;
      readonly version: string;
    };
  };
};

export interface ProactiveScanDependencies {
  createDetectedReimbursementCandidateProposals?: typeof createDetectedReimbursementCandidateProposals;
  createReimbursementMatchProposals?: typeof createReimbursementMatchProposals;
  createSuggestionService?: () => ProactiveScanSuggestionService;
  listAgentProposals?: (
    client: FinanceSupabaseClient,
    userId: string,
    filters?: AgentProposalListFilters
  ) => Promise<AgentProposalRecord[]>;
  listTransactions?: (
    client: FinanceSupabaseClient,
    userId: string,
    filters?: TransactionListFilters
  ) => Promise<TransactionRecord[]>;
  logger?: Pick<Console, "error">;
  recordAuditEvent?: (
    client: FinanceSupabaseClient,
    userId: string,
    input: AuditEventInput
  ) => Promise<unknown>;
}

export class ProactiveScanConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProactiveScanConfigurationError";
  }
}

const DEFAULT_MAX_TRANSACTIONS = 100;
const DEFAULT_HISTORICAL_BACKFILL_MAX_TRANSACTIONS = 750;
const DEFAULT_HISTORICAL_BACKFILL_MAX_CANDIDATES = 50;
const DEFAULT_HISTORICAL_BACKFILL_LOOKBACK_DAYS = 730;
const EXPENSE_LOOKBACK_DAYS = 45;
const INFLOW_PRE_EXPENSE_LOOKBACK_DAYS = 2;

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const normalized = value?.trim();
  if (!normalized) return fallback;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function enabledEnvFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function proposalAuditData(proposal: AgentProposalRecord) {
  return {
    confidence: proposal.confidence,
    proposalType: proposal.proposalType,
    questionFingerprint: proposal.questionFingerprint,
    sourceAgent: proposal.sourceAgent,
    status: proposal.status,
    targetId: proposal.targetId,
    targetKind: proposal.targetKind
  };
}

function isAgentProposalSchemaMissingError(error: unknown) {
  const text = error instanceof Error
    ? `${error.message} ${"code" in error ? String(error.code) : ""}`
    : String(error);
  return /agent_proposals/i.test(text) && (
    /schema cache/i.test(text) ||
    /could not find the table/i.test(text) ||
    /relation .*agent_proposals.* does not exist/i.test(text) ||
    /\b42P01\b/i.test(text) ||
    /\bPGRST205\b/i.test(text)
  );
}

export function resolveProactiveScanMaxTransactions(value = process.env.PROACTIVE_SCAN_MAX_TX) {
  return parsePositiveInteger(value, DEFAULT_MAX_TRANSACTIONS);
}

export function resolveProactiveScanHistoricalMaxTransactions(
  value = process.env.PROACTIVE_SCAN_HISTORY_MAX_TX
) {
  return parsePositiveInteger(value, DEFAULT_HISTORICAL_BACKFILL_MAX_TRANSACTIONS);
}

export function resolveProactiveScanHistoricalMaxCandidates(
  value = process.env.PROACTIVE_SCAN_HISTORY_MAX_CANDIDATES
) {
  return parsePositiveInteger(value, DEFAULT_HISTORICAL_BACKFILL_MAX_CANDIDATES);
}

export function resolveProactiveScanHistoricalLookbackDays(
  value = process.env.PROACTIVE_SCAN_HISTORY_LOOKBACK_DAYS
) {
  return parsePositiveInteger(value, DEFAULT_HISTORICAL_BACKFILL_LOOKBACK_DAYS);
}

export function resolveProactiveScanEnabled(value = process.env.PROACTIVE_SCAN_ENABLED) {
  return enabledEnvFlag(value);
}

export function resolveProactiveScanUserId() {
  return process.env.PROACTIVE_SCAN_USER_ID?.trim() || process.env.OPENCLAW_USER_ID?.trim() || null;
}

export function proactiveScanWindow(now = new Date(), lookbackDays = EXPENSE_LOOKBACK_DAYS) {
  const toDate = isoDate(now);
  const fromDate = addDays(toDate, -lookbackDays);
  return {
    fromDate,
    inflowFromDate: addDays(fromDate, -INFLOW_PRE_EXPENSE_LOOKBACK_DAYS),
    toDate
  };
}

export function createProactiveScanServiceContext(): { client: FinanceSupabaseClient; userId: string } {
  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const userId = resolveProactiveScanUserId();

  if (!config || !serviceRoleKey || !userId) {
    throw new ProactiveScanConfigurationError(
      "Missing proactive scan server configuration. Set PROACTIVE_SCAN_USER_ID or OPENCLAW_USER_ID plus SUPABASE_SERVICE_ROLE_KEY."
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

export function createProactiveScanSuggestionService() {
  return createAutoReviewTransactionSuggestionService();
}

function suggestionProviderMetadata(suggestionService: ProactiveScanSuggestionService) {
  return {
    openAiAutoReviewEnabled: isOpenAiAutoReviewEnabled(),
    suggestionProviderKind: suggestionService.adapter?.descriptor?.kind ?? null,
    suggestionProviderVersion: suggestionService.adapter?.descriptor?.version ?? null
  };
}

export function createDisabledProactiveScanResult(options: {
  includeDisconnectedAccounts?: boolean;
  lookbackDays?: number;
  maxCandidateProposals?: number;
  maxTransactions?: number;
  mode?: ProactiveScanMode;
  now?: Date;
} = {}): ProactiveScanResult {
  const mode = options.mode ?? "recent";
  const maxTransactions = options.maxTransactions ?? resolveProactiveScanMaxTransactions();
  const maxCandidateProposals = options.maxCandidateProposals ?? maxTransactions;
  const includeDisconnectedAccounts = options.includeDisconnectedAccounts ?? false;
  const { fromDate, toDate } = proactiveScanWindow(options.now ?? new Date(), options.lookbackDays);

  return {
    createdProposalCount: 0,
    errorCode: null,
    fromDate,
    includeDisconnectedAccounts,
    maxCandidateProposals,
    maxTransactions,
    mode,
    openAiAutoReviewEnabled: isOpenAiAutoReviewEnabled(),
    scannedTransactionCount: 0,
    status: "disabled",
    suggestionProviderKind: null,
    suggestionProviderVersion: null,
    toDate
  };
}

export async function runProactiveReimbursementScan(
  client: FinanceSupabaseClient,
  userId: string,
  options: {
    includeDisconnectedAccounts?: boolean;
    lookbackDays?: number;
    maxCandidateProposals?: number;
    maxTransactions?: number;
    mode?: ProactiveScanMode;
    now?: Date;
  } = {},
  dependencies: ProactiveScanDependencies = {}
): Promise<ProactiveScanResult> {
  const now = options.now ?? new Date();
  const mode = options.mode ?? "recent";
  const maxTransactions = options.maxTransactions ?? resolveProactiveScanMaxTransactions();
  const maxCandidateProposals = options.maxCandidateProposals ?? maxTransactions;
  const includeDisconnectedAccounts = options.includeDisconnectedAccounts ?? mode === "historical_backfill";
  const { fromDate, inflowFromDate, toDate } = proactiveScanWindow(now, options.lookbackDays);
  const loadTransactions = dependencies.listTransactions ?? listTransactions;
  const loadProposals = dependencies.listAgentProposals ?? listAgentProposals;
  const createProposals = dependencies.createDetectedReimbursementCandidateProposals ??
    createDetectedReimbursementCandidateProposals;
  const createMatchProposals = dependencies.createReimbursementMatchProposals ?? createReimbursementMatchProposals;
  const audit = dependencies.recordAuditEvent ?? recordAuditEvent;
  const logger = dependencies.logger ?? { error: logSafeError };
  const suggestionService = dependencies.createSuggestionService?.() ?? createProactiveScanSuggestionService();
  const providerMetadata = suggestionProviderMetadata(suggestionService);

  const [transactions, inflows, existingProposals] = await Promise.all([
    loadTransactions(client, userId, {
      fromDate,
      includeDisconnectedAccounts,
      intent: "personal",
      limit: maxTransactions,
      recurring: false,
      toDate
    }),
    loadTransactions(client, userId, {
      fromDate: inflowFromDate,
      includeDisconnectedAccounts,
      limit: Math.max(maxTransactions, maxTransactions * 3),
      toDate
    }),
    loadProposals(client, userId, {
      includeExpired: true,
      status: "all"
    })
  ]);

  let created: AgentProposalRecord[];
  try {
    const [candidateProposals, matchProposals] = await Promise.all([
      createProposals(client, userId, {
        existingProposals,
        inflows,
        maxCandidates: maxCandidateProposals,
        now,
        suggestionService,
        transactions
      } satisfies PersistReimbursementCandidateInput),
      createMatchProposals(client, userId, {
        existingProposals,
        inflows,
        maxProposals: maxCandidateProposals,
        now,
        transactions
      } satisfies PersistReimbursementMatchProposalInput)
    ]);
    created = [...candidateProposals, ...matchProposals];
  } catch (error) {
    logger.error("proactive_reimbursement_scan_failed", error);
    const errorCode = isAgentProposalSchemaMissingError(error)
      ? "proposal_schema_missing"
      : "detector_failed";
    return {
      createdProposalCount: 0,
      errorCode,
      fromDate,
      includeDisconnectedAccounts,
      maxCandidateProposals,
      maxTransactions,
      mode,
      ...providerMetadata,
      scannedTransactionCount: transactions.length,
      status: "failed",
      toDate
    };
  }

  await Promise.all(created.map((proposal) =>
    audit(client, userId, {
      action: "agent_proposal.proactive_scan_created",
      actorId: null,
      afterData: proposalAuditData(proposal),
      entityId: proposal.id,
      entityTable: "agent_proposals",
      metadata: {
        fromDate,
        mode,
        source: "agents_proactive_scan",
        toDate
      }
    })
  ));

  return {
    createdProposalCount: created.length,
    errorCode: null,
    fromDate,
    includeDisconnectedAccounts,
    maxCandidateProposals,
    maxTransactions,
    mode,
    ...providerMetadata,
    scannedTransactionCount: transactions.length,
    status: "succeeded",
    toDate
  };
}
