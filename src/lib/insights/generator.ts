import type {
  AccountRecord,
  InsightRecord,
  Json,
  RecurringExpenseRecord,
  ReviewQueueItem,
  TransactionRecord
} from "@/lib/db";
import { accountSyncState, type BalanceTrendPoint } from "@/lib/finance/balances";
import type { DashboardInsightCard } from "./types";

interface DashboardInsightInput {
  accounts: readonly AccountRecord[];
  persistedInsights?: readonly InsightRecord[];
  recentTransactions: readonly TransactionRecord[];
  recurringExpenses: readonly RecurringExpenseRecord[];
  reviewItems: readonly ReviewQueueItem[];
  trend: readonly BalanceTrendPoint[];
  limit?: number;
  now?: Date;
}

interface EvidenceLink {
  evidenceLabel: string;
  href: string;
}

type JsonObject = { [key: string]: Json | undefined };

const DEFAULT_LIMIT = 6;
const GENERATED_PREFIX = "generated";
const PEER_MERCHANT_PATTERN = /\b(venmo|zelle|cash app|paypal)\b/i;

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short"
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatSignedMoney(value: number) {
  if (value === 0) return formatMoney(0);
  return `${value > 0 ? "+" : "-"}${formatMoney(Math.abs(value))}`;
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function transactionsHref(params: Record<string, boolean | number | string | undefined>) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "" || value === false) return;
    search.set(key, value === true ? "1" : String(value));
  });

  const query = search.toString();
  return query ? `/transactions?${query}` : "/transactions";
}

function transactionEvidenceHref(transactionIds: readonly string[], params: Record<string, boolean | number | string | undefined>) {
  return transactionIds.length === 1 ? `/transactions/${transactionIds[0]}` : transactionsHref(params);
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isJsonObject(value: Json): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function payloadString(payload: JsonObject | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPeerReviewItem(item: ReviewQueueItem) {
  return (
    item.reason === "venmo" ||
    item.transaction.intent === "shared" ||
    item.transaction.intent === "reimbursable" ||
    PEER_MERCHANT_PATTERN.test(item.transaction.merchant)
  );
}

function buildGeneratedId(key: string) {
  return `${GENERATED_PREFIX}:${key}`;
}

function buildPeerReviewInsight(reviewItems: readonly ReviewQueueItem[]): DashboardInsightCard | null {
  const peerItems = reviewItems.filter(isPeerReviewItem);
  if (peerItems.length === 0) return null;

  const transactionIds = peerItems.map((item) => item.transaction.id);
  const merchants = uniqueStrings(peerItems.map((item) => item.transaction.merchant)).slice(0, 2);
  const merchantText = merchants.length > 0 ? ` including ${merchants.join(" and ")}` : "";

  return {
    body: `Review ${peerItems.length} unresolved peer-to-peer ${pluralize(peerItems.length, "transaction")}${merchantText} before shared spend or reimbursements are treated as confirmed.`,
    evidenceLabel: peerItems.length === 1 ? "Open transaction" : "Open review transactions",
    evidenceTransactionIds: transactionIds,
    generatedAt: null,
    href: transactionEvidenceHref(transactionIds, { review: "open" }),
    id: buildGeneratedId("peer-review"),
    key: "peer-review",
    source: "generated",
    title: `${peerItems.length} peer-to-peer ${pluralize(peerItems.length, "item")} unresolved`,
    tone: "warn"
  };
}

function buildReviewBacklogInsight(reviewItems: readonly ReviewQueueItem[]): DashboardInsightCard | null {
  const nonPeerItems = reviewItems.filter((item) => !isPeerReviewItem(item));
  if (nonPeerItems.length === 0) return null;

  const transactionIds = nonPeerItems.map((item) => item.transaction.id);
  const topItem = nonPeerItems[0];
  const lead = topItem ? `${topItem.transaction.merchant} is the largest open item. ` : "";

  return {
    body: `${lead}Resolve ${nonPeerItems.length} open ${pluralize(nonPeerItems.length, "review item")} before category-sensitive insights are treated as final.`,
    evidenceLabel: nonPeerItems.length === 1 ? "Open transaction" : "Open review transactions",
    evidenceTransactionIds: transactionIds,
    generatedAt: null,
    href: transactionEvidenceHref(transactionIds, { review: "open" }),
    id: buildGeneratedId("review-backlog"),
    key: "review-backlog",
    source: "generated",
    title: `${nonPeerItems.length} ${pluralize(nonPeerItems.length, "transaction")} need review`,
    tone: "warn"
  };
}

function buildRecurringInsight(recurringExpenses: readonly RecurringExpenseRecord[]): DashboardInsightCard | null {
  const pending = recurringExpenses
    .filter((expense) => expense.status === "pending" || expense.isNew)
    .sort((left, right) => left.nextDueDate.localeCompare(right.nextDueDate));

  if (pending.length > 0) {
    const lead = pending[0];
    return {
      body: `${lead.merchant} is still pending confirmation. Treat this recurring signal as unresolved until the matching transactions are reviewed.`,
      evidenceLabel: "View transaction evidence",
      evidenceTransactionIds: [],
      generatedAt: null,
      href: transactionsHref({ q: lead.merchant }),
      id: buildGeneratedId("recurring-pending"),
      key: "recurring-pending",
      source: "generated",
      title: `${pending.length} recurring ${pluralize(pending.length, "signal")} need confirmation`,
      tone: "warn"
    };
  }

  const active = recurringExpenses
    .filter((expense) => expense.status === "active")
    .sort((left, right) => left.nextDueDate.localeCompare(right.nextDueDate));

  const next = active[0];
  if (!next) return null;

  return {
    body: `The next tracked recurring charge is ${next.merchant} for ${formatMoney(next.amount)} on ${formatDate(next.nextDueDate)}.`,
    evidenceLabel: "View transaction evidence",
    evidenceTransactionIds: [],
    generatedAt: null,
    href: transactionsHref({ q: next.merchant }),
    id: buildGeneratedId("recurring-next"),
    key: "recurring-next",
    source: "generated",
    title: `${active.length} recurring ${pluralize(active.length, "cost")} tracked`,
    tone: "info"
  };
}

function buildSyncInsight(accounts: readonly AccountRecord[], now: Date): DashboardInsightCard | null {
  const staleAccounts = accounts.filter((account) => accountSyncState(account, { now }) !== "fresh");
  if (staleAccounts.length === 0) return null;

  const neverSyncedCount = staleAccounts.filter((account) => {
    if (!account.lastSyncedAt) return true;
    return Number.isNaN(new Date(account.lastSyncedAt).getTime());
  }).length;
  const staleCount = staleAccounts.length - neverSyncedCount;
  const detail = [
    staleCount > 0 ? `${staleCount} stale` : null,
    neverSyncedCount > 0 ? `${neverSyncedCount} never synced` : null
  ].filter(Boolean).join(" and ");

  return {
    body: `${detail} ${pluralize(staleAccounts.length, "account")} can make balances and account-level insights change after the next sync.`,
    evidenceLabel: "Open accounts",
    evidenceTransactionIds: [],
    generatedAt: null,
    href: "/accounts",
    id: buildGeneratedId("account-sync"),
    key: "account-sync",
    source: "generated",
    title: `${staleAccounts.length} ${pluralize(staleAccounts.length, "account")} need a fresh sync`,
    tone: "warn"
  };
}

function buildBalanceTrendInsight(trend: readonly BalanceTrendPoint[]): DashboardInsightCard | null {
  if (trend.length < 2) return null;

  const first = trend[0];
  const latest = trend[trend.length - 1];
  const amount = latest.netWorth - first.netWorth;
  const percent = first.netWorth === 0 ? 0 : (amount / Math.abs(first.netWorth)) * 100;

  if (Math.abs(amount) < 1) return null;

  return {
    body: `Net worth moved ${formatSignedMoney(amount)} (${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%) from ${formatDate(first.date)} to ${formatDate(latest.date)} across ${trend.length} balance points.`,
    evidenceLabel: "Open accounts",
    evidenceTransactionIds: [],
    generatedAt: null,
    href: "/accounts",
    id: buildGeneratedId("balance-trend"),
    key: "balance-trend",
    source: "generated",
    title: amount >= 0 ? "Net worth is trending up" : "Net worth dipped",
    tone: amount >= 0 ? "ok" : "warn"
  };
}

function buildRecentTransactionInsight(
  transactions: readonly TransactionRecord[],
  reviewItems: readonly ReviewQueueItem[]
): DashboardInsightCard | null {
  if (transactions.length === 0) return null;

  const openReviewTransactionIds = new Set(reviewItems.map((item) => item.transaction.id));
  const largest = [...transactions].sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))[0];
  if (!largest) return null;

  const isUnresolved = openReviewTransactionIds.has(largest.id) || largest.reviewStatus === "open";

  return {
    body: isUnresolved
      ? `${largest.merchant} is still unresolved, so do not treat its category or intent as confirmed yet.`
      : `${largest.merchant} posted for ${formatSignedMoney(largest.amount)} on ${formatDate(largest.date)} from ${largest.accountName}.`,
    evidenceLabel: "Open transaction",
    evidenceTransactionIds: [largest.id],
    generatedAt: null,
    href: `/transactions/${largest.id}`,
    id: buildGeneratedId("recent-transaction"),
    key: "recent-transaction",
    source: "generated",
    title: isUnresolved ? "Recent activity needs evidence" : "Largest recent transaction",
    tone: isUnresolved ? "warn" : "info"
  };
}

function persistedEvidenceLink(insight: InsightRecord): EvidenceLink {
  const payload = isJsonObject(insight.payload) ? insight.payload : null;
  const transactionId = payloadString(payload, "transactionId") ?? payloadString(payload, "transaction_id");
  const merchant = payloadString(payload, "merchant");
  const category = payloadString(payload, "category");
  const reason = payloadString(payload, "reason");
  const accountId = payloadString(payload, "accountId") ?? payloadString(payload, "account_id");

  if (transactionId) {
    return {
      evidenceLabel: "Open transaction",
      href: `/transactions/${transactionId}`
    };
  }

  if (reason) {
    return {
      evidenceLabel: "Open review transactions",
      href: transactionsHref({ review: "open" })
    };
  }

  if (merchant) {
    return {
      evidenceLabel: "View transaction evidence",
      href: transactionsHref({ q: merchant })
    };
  }

  if (category) {
    return {
      evidenceLabel: "View filtered transactions",
      href: transactionsHref({ exclude_transfers: true, q: category })
    };
  }

  if (accountId) {
    return {
      evidenceLabel: "Open accounts",
      href: "/accounts"
    };
  }

  return {
    evidenceLabel: "View transactions",
    href: "/transactions"
  };
}

function insightLooksSpendSensitive(insight: InsightRecord) {
  const payload = isJsonObject(insight.payload) ? insight.payload : null;
  const text = `${insight.key} ${insight.title} ${insight.body}`.toLowerCase();

  return Boolean(
    payloadString(payload, "category") ||
    payload?.spent !== undefined ||
    payload?.delta !== undefined ||
    /\b(spend|spent|cost|costs|run rate|category|bucket)\b/.test(text)
  );
}

function addUnresolvedCaution(body: string, reviewItems: readonly ReviewQueueItem[]) {
  if (reviewItems.length === 0 || /\b(unresolved|directional|not confirmed|trusted)\b/i.test(body)) {
    return body;
  }

  return `${body} ${reviewItems.length} open ${pluralize(reviewItems.length, "review item")} remain unresolved, so treat this as directional.`;
}

function toPersistedInsightCard(
  insight: InsightRecord,
  reviewItems: readonly ReviewQueueItem[]
): DashboardInsightCard {
  const evidence = persistedEvidenceLink(insight);

  return {
    body: insightLooksSpendSensitive(insight) ? addUnresolvedCaution(insight.body, reviewItems) : insight.body,
    evidenceLabel: evidence.evidenceLabel,
    evidenceTransactionIds: [],
    generatedAt: insight.generatedAt,
    href: evidence.href,
    id: insight.id,
    key: insight.key,
    source: "persisted",
    title: insight.title,
    tone: insight.tone
  };
}

function withoutDuplicateKeys(cards: readonly DashboardInsightCard[]) {
  const seen = new Set<string>();

  return cards.filter((card) => {
    if (seen.has(card.key)) return false;
    seen.add(card.key);
    return true;
  });
}

export function buildDashboardInsightCards(input: DashboardInsightInput): DashboardInsightCard[] {
  const now = input.now ?? new Date();
  const generated = [
    buildPeerReviewInsight(input.reviewItems),
    buildReviewBacklogInsight(input.reviewItems),
    buildRecurringInsight(input.recurringExpenses),
    buildSyncInsight(input.accounts, now),
    buildBalanceTrendInsight(input.trend),
    buildRecentTransactionInsight(input.recentTransactions, input.reviewItems)
  ].filter((card): card is DashboardInsightCard => Boolean(card));

  const persisted = (input.persistedInsights ?? []).map((insight) =>
    toPersistedInsightCard(insight, input.reviewItems)
  );

  return withoutDuplicateKeys([
    ...generated.slice(0, 3),
    ...persisted,
    ...generated.slice(3)
  ]).slice(0, input.limit ?? DEFAULT_LIMIT);
}
