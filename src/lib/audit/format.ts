import type { AuditEventRow, Json } from "@/lib/db";

export type AuditActionGroup =
  | "review"
  | "merchant-rule"
  | "agent-proposal"
  | "recurring"
  | "reimbursement"
  | "plaid"
  | "seed-demo"
  | "other";

const GROUP_ORDER: AuditActionGroup[] = [
  "review",
  "merchant-rule",
  "agent-proposal",
  "recurring",
  "reimbursement",
  "plaid",
  "seed-demo",
  "other"
];

const GROUP_LABELS: Record<AuditActionGroup, string> = {
  review: "Review",
  "merchant-rule": "Merchant rule",
  "agent-proposal": "Agent proposal",
  recurring: "Recurring",
  reimbursement: "Reimbursement",
  plaid: "Plaid",
  "seed-demo": "Seed/demo",
  other: "Other"
};

const ENTITY_LABELS: Record<string, string> = {
  review_items: "Review item",
  merchant_rules: "Merchant rule",
  agent_proposals: "Agent proposal",
  recurring_expenses: "Recurring expense",
  reimbursement_records: "Reimbursement record",
  enriched_transactions: "Transaction",
  transaction_splits: "Transaction split",
  plaid_items: "Bank connection",
  accounts: "Account",
  seed: "Seed"
};

const SENSITIVE_KEY_FRAGMENTS = [
  "token",
  "secret",
  "password",
  "authorization",
  "auth_header",
  "cookie",
  "ciphertext",
  "raw_payload",
  "raw_response",
  "plaid_access",
  "access_key",
  "private_key"
];

const ALLOWED_SUMMARY_KEYS = new Set([
  "merchantName",
  "merchant_name",
  "merchant",
  "categoryId",
  "category_id",
  "categoryName",
  "category_name",
  "category",
  "intent",
  "amount",
  "confidence",
  "recurring",
  "status",
  "reason",
  "appliedAmount",
  "applied_amount",
  "splitId",
  "split_id",
  "transactionId",
  "transaction_id",
  "proposalType",
  "proposal_type",
  "targetKind",
  "target_kind",
  "name",
  "title",
  "label",
  "source",
  "cadence",
  "nextDueDate",
  "next_due_date",
  "monthlyAverage",
  "monthly_average",
  "accounts",
  "transactions",
  "review_items",
  "recurring_expenses",
  "count"
]);

const ACTION_LABELS: Record<string, string> = {
  "review.suggestion_generated": "AI suggestion generated",
  "review.suggestion_accepted": "AI suggestion accepted",
  "review.suggestion_auto_applied": "AI suggestion auto-applied",
  "review.dismissed": "Review dismissed",
  "review.peer_to_peer_resolved": "Peer-to-peer resolved",
  "review.transaction_edited_resolved": "Transaction edited from review",
  "review.transaction_edit_resolved": "Transaction edited from review",
  "merchant_rule.learned_from_edit": "Merchant rule learned",
  "merchant_rule.ai_accepted_upserted": "Merchant rule from AI",
  "agent_proposal.accepted": "Agent proposal accepted",
  "agent_proposal.dismissed": "Agent proposal dismissed",
  "agent_proposal.clarification_answered": "Clarification answered",
  "recurring.pending_confirmed": "Recurring confirmed",
  "recurring.pending_dismissed": "Recurring dismissed",
  "recurring.candidate_confirmed": "Recurring candidate confirmed",
  "recurring.candidate_dismissed": "Recurring candidate dismissed",
  "reimbursement.inflow_linked": "Reimbursement linked",
  "reimbursement.inflow_unlinked": "Reimbursement unlinked",
  "reimbursement.status_changed": "Reimbursement status changed",
  "ledger_seed_loaded": "Seed data loaded"
};

export function actionGroup(action: string): AuditActionGroup {
  if (action.startsWith("review.")) return "review";
  if (action.startsWith("merchant_rule.")) return "merchant-rule";
  if (action.startsWith("agent_proposal.")) return "agent-proposal";
  if (action.startsWith("recurring.")) return "recurring";
  if (action.startsWith("reimbursement.")) return "reimbursement";
  if (action.startsWith("plaid.")) return "plaid";
  if (action.startsWith("ledger_seed") || action.startsWith("demo.") || action.startsWith("seed.")) {
    return "seed-demo";
  }
  return "other";
}

export function actionGroupLabel(group: AuditActionGroup): string {
  return GROUP_LABELS[group];
}

export function allActionGroups(): AuditActionGroup[] {
  return [...GROUP_ORDER];
}

export function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const parts = action.split(".");
  const tail = parts[parts.length - 1] ?? action;
  return tail
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

export function entityLabel(entityTable: string): string {
  if (ENTITY_LABELS[entityTable]) return ENTITY_LABELS[entityTable];
  return entityTable
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

export function shortenId(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.length <= 8) return value;
  return value.slice(0, 8);
}

function isPlainObject(value: Json | undefined | null): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function formatPrimitive(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
  return "";
}

export interface AuditSummaryEntry {
  key: string;
  value: string;
}

function collectSummary(
  obj: Record<string, Json>,
  prefix = "",
  out: AuditSummaryEntry[] = [],
  depth = 0
): AuditSummaryEntry[] {
  if (depth > 2 || out.length >= 8) return out;
  for (const [key, raw] of Object.entries(obj)) {
    if (out.length >= 8) break;
    if (isSensitiveKey(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(raw)) {
      collectSummary(raw, path, out, depth + 1);
      continue;
    }
    const allowed = ALLOWED_SUMMARY_KEYS.has(key) || depth > 0;
    if (!allowed) continue;
    out.push({ key: path, value: formatPrimitive(raw) });
  }
  return out;
}

export function summarizeData(value: Json | null | undefined): AuditSummaryEntry[] {
  if (!isPlainObject(value)) return [];
  return collectSummary(value);
}

export interface DisplayAuditEvent {
  id: string;
  occurredAt: string;
  action: string;
  actionLabel: string;
  group: AuditActionGroup;
  groupLabel: string;
  entityTable: string;
  entityLabel: string;
  entityIdShort: string;
  actorIdShort: string;
  before: AuditSummaryEntry[];
  after: AuditSummaryEntry[];
  metadata: AuditSummaryEntry[];
}

export function formatAuditEvent(row: AuditEventRow): DisplayAuditEvent {
  const group = actionGroup(row.action);
  return {
    id: row.id,
    occurredAt: row.created_at,
    action: row.action,
    actionLabel: actionLabel(row.action),
    group,
    groupLabel: actionGroupLabel(group),
    entityTable: row.entity_table,
    entityLabel: entityLabel(row.entity_table),
    entityIdShort: shortenId(row.entity_id),
    actorIdShort: shortenId(row.actor_id),
    before: summarizeData(row.before_data),
    after: summarizeData(row.after_data),
    metadata: summarizeData(row.metadata)
  };
}

export function countByGroup(rows: AuditEventRow[]): Record<AuditActionGroup, number> {
  const counts: Record<AuditActionGroup, number> = {
    review: 0,
    "merchant-rule": 0,
    "agent-proposal": 0,
    recurring: 0,
    reimbursement: 0,
    plaid: 0,
    "seed-demo": 0,
    other: 0
  };
  for (const row of rows) {
    counts[actionGroup(row.action)] += 1;
  }
  return counts;
}
