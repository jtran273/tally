import { createClient } from "@supabase/supabase-js";
import { createAutoReviewTransactionSuggestionService } from "@/lib/ai/server";
import type { TransactionSuggestionService } from "@/lib/ai/suggestion-service";
import type { AgentProposalRecord, AuditEventInput, Database, TransactionRecord } from "@/lib/db";
import {
  listAgentProposals,
  listTransactions,
  recordAuditEvent,
  type AgentProposalListFilters,
  type FinanceSupabaseClient,
  type TransactionListFilters
} from "@/lib/db/queries";
import { createDetectedReimbursementCandidateProposals } from "@/lib/review/reimbursement-candidates";
import type { PersistReimbursementCandidateInput } from "@/lib/review/reimbursement-candidates";
import { getSupabaseConfig } from "@/lib/supabase/env";

export interface ProactiveScanResult {
  createdProposalCount: number;
  errorCode: "detector_failed" | null;
  fromDate: string;
  maxTransactions: number;
  scannedTransactionCount: number;
  status: "failed" | "succeeded";
  toDate: string;
}

export interface ProactiveScanDependencies {
  createDetectedReimbursementCandidateProposals?: typeof createDetectedReimbursementCandidateProposals;
  createSuggestionService?: () => Pick<TransactionSuggestionService, "suggestReimbursementCandidate">;
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

export function resolveProactiveScanMaxTransactions(value = process.env.PROACTIVE_SCAN_MAX_TX) {
  return parsePositiveInteger(value, DEFAULT_MAX_TRANSACTIONS);
}

export function resolveProactiveScanUserId() {
  return process.env.PROACTIVE_SCAN_USER_ID?.trim() || process.env.OPENCLAW_USER_ID?.trim() || null;
}

export function proactiveScanWindow(now = new Date()) {
  const toDate = isoDate(now);
  const fromDate = addDays(toDate, -EXPENSE_LOOKBACK_DAYS);
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

export async function runProactiveReimbursementScan(
  client: FinanceSupabaseClient,
  userId: string,
  options: {
    maxTransactions?: number;
    now?: Date;
  } = {},
  dependencies: ProactiveScanDependencies = {}
): Promise<ProactiveScanResult> {
  const now = options.now ?? new Date();
  const maxTransactions = options.maxTransactions ?? resolveProactiveScanMaxTransactions();
  const { fromDate, inflowFromDate, toDate } = proactiveScanWindow(now);
  const loadTransactions = dependencies.listTransactions ?? listTransactions;
  const loadProposals = dependencies.listAgentProposals ?? listAgentProposals;
  const createProposals = dependencies.createDetectedReimbursementCandidateProposals ??
    createDetectedReimbursementCandidateProposals;
  const audit = dependencies.recordAuditEvent ?? recordAuditEvent;
  const logger = dependencies.logger ?? console;
  const suggestionService = dependencies.createSuggestionService?.() ?? createProactiveScanSuggestionService();

  const [transactions, inflows, existingProposals] = await Promise.all([
    loadTransactions(client, userId, {
      fromDate,
      intent: "personal",
      limit: maxTransactions,
      recurring: false,
      toDate
    }),
    loadTransactions(client, userId, {
      fromDate: inflowFromDate,
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
    created = await createProposals(client, userId, {
      existingProposals,
      inflows,
      maxCandidates: maxTransactions,
      now,
      suggestionService,
      transactions
    } satisfies PersistReimbursementCandidateInput);
  } catch (error) {
    logger.error("proactive_reimbursement_scan_failed", error);
    return {
      createdProposalCount: 0,
      errorCode: "detector_failed",
      fromDate,
      maxTransactions,
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
        source: "agents_proactive_scan",
        toDate
      }
    })
  ));

  return {
    createdProposalCount: created.length,
    errorCode: null,
    fromDate,
    maxTransactions,
    scannedTransactionCount: transactions.length,
    status: "succeeded",
    toDate
  };
}
