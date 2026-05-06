import type {
  AccountRecord,
  InsightRecord,
  RecurringExpenseRecord,
  ReviewQueueItem,
  ReviewReason,
  TransactionRecord
} from "@/lib/db";
import type { BalanceTrendPoint } from "@/lib/finance/balances";
import { buildDashboardInsightCards } from ".";

const userId = "11111111-1111-1111-1111-111111111111";

function account(id: string, name: string, lastSyncedAt: string | null): AccountRecord {
  return {
    availableBalance: null,
    balance: 1200,
    color: null,
    creditLimit: null,
    currency: "USD",
    id,
    institutionId: "institution-1",
    institutionName: "Seed Bank",
    isActive: true,
    lastSyncedAt,
    mask: "1111",
    name,
    officialName: null,
    plaidAccountId: `plaid-${id}`,
    subtype: "checking",
    type: "depository",
    userId
  };
}

function transaction(
  input: Pick<TransactionRecord, "amount" | "date" | "id" | "merchant"> & Partial<TransactionRecord>
): TransactionRecord {
  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Checking",
    category: "Uncategorized",
    categoryId: null,
    confidence: 0.91,
    institutionName: "Seed Bank",
    intent: "personal",
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidTransactionId: null,
    rawTransactionId: `raw-${input.id}`,
    recurring: false,
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId,
    ...input
  };
}

function reviewItem(id: string, reason: ReviewReason, tx: TransactionRecord): ReviewQueueItem {
  const review = {
    aiSuggestion: {},
    confidence: 0.72,
    createdAt: "2026-05-06T12:00:00.000Z",
    explanation: "Fixture review item",
    id,
    reason,
    resolutionNote: null,
    resolvedAt: null,
    status: "open",
    transactionId: tx.id
  } satisfies Omit<ReviewQueueItem, "transaction">;

  return {
    ...review,
    transaction: {
      ...tx,
      reviewItems: [review],
      reviewReason: reason,
      reviewStatus: "open"
    }
  };
}

export const insightGeneratorAccountsFixture = [
  account("account-checking", "Checking", "2026-05-06T18:00:00.000Z"),
  account("account-savings", "Savings", "2026-05-01T18:00:00.000Z")
] satisfies readonly AccountRecord[];

const venmoTransaction = transaction({
  amount: -42,
  date: "2026-05-05",
  id: "tx-venmo",
  intent: "shared",
  merchant: "Venmo Rachel"
});

const groceryTransaction = transaction({
  amount: -92.45,
  date: "2026-05-04",
  id: "tx-grocery",
  merchant: "Grocery Mart"
});

export const insightGeneratorTransactionsFixture = [
  venmoTransaction,
  groceryTransaction,
  transaction({
    amount: -20,
    date: "2026-05-03",
    id: "tx-openai",
    merchant: "OpenAI",
    recurring: true
  })
] satisfies readonly TransactionRecord[];

export const insightGeneratorReviewFixture = [
  reviewItem("review-venmo", "venmo", venmoTransaction),
  reviewItem("review-grocery", "missing-category", groceryTransaction)
] satisfies readonly ReviewQueueItem[];

export const insightGeneratorRecurringFixture = [
  {
    accountId: "account-checking",
    accountName: "Checking",
    amount: 8,
    cadence: "monthly",
    category: "Media",
    categoryId: "category-media",
    confidence: 0.78,
    id: "rec-substack",
    isNew: true,
    lastAmount: 8,
    lastChargeDate: "2026-05-01",
    merchant: "Substack",
    nextDueDate: "2026-06-01",
    status: "pending"
  }
] satisfies readonly RecurringExpenseRecord[];

export const insightGeneratorPersistedFixture = [
  {
    actionLabel: "See breakdown",
    body: "Software costs are up 18%.",
    expiresAt: null,
    generatedAt: "2026-05-06T12:00:00.000Z",
    id: "insight-software",
    key: "software-costs-up",
    payload: { category: "Software", delta: 18 },
    title: "Software costs are up",
    tone: "info"
  }
] satisfies readonly InsightRecord[];

export const insightGeneratorTrendFixture = [
  { date: "2026-05-01", netWorth: 10000, source: "snapshot" },
  { date: "2026-05-06", netWorth: 10550, source: "snapshot" }
] satisfies readonly BalanceTrendPoint[];

export const insightGeneratorCardsFixture = buildDashboardInsightCards({
  accounts: insightGeneratorAccountsFixture,
  limit: 8,
  now: new Date("2026-05-06T20:00:00.000Z"),
  persistedInsights: insightGeneratorPersistedFixture,
  recentTransactions: insightGeneratorTransactionsFixture,
  recurringExpenses: insightGeneratorRecurringFixture,
  reviewItems: insightGeneratorReviewFixture,
  trend: insightGeneratorTrendFixture
});

export const insightGeneratorStaticAssertions = assertInsightGeneratorFixture(insightGeneratorCardsFixture);

function assertInsightGeneratorFixture(cards: ReturnType<typeof buildDashboardInsightCards>): true {
  const peerCard = requireCard(cards, "peer-review");
  if (!peerCard.body.includes("unresolved") || peerCard.href !== "/transactions/tx-venmo") {
    throw new Error("Expected peer-to-peer insight to call out unresolved evidence and link to the transaction.");
  }

  const recurringCard = requireCard(cards, "recurring-pending");
  if (!recurringCard.body.includes("pending confirmation") || !recurringCard.href.includes("Substack")) {
    throw new Error("Expected pending recurring insight to link back to transaction evidence.");
  }

  const persistedCard = requireCard(cards, "software-costs-up");
  if (!persistedCard.body.includes("directional") || !persistedCard.href.includes("Software")) {
    throw new Error("Expected persisted spend-sensitive insight to be labeled directional with a filtered link.");
  }

  if (cards.some((card) => !card.href.startsWith("/") || !card.evidenceLabel)) {
    throw new Error("Expected every insight card to expose an internal evidence link.");
  }

  return true;
}

function requireCard(cards: ReturnType<typeof buildDashboardInsightCards>, key: string) {
  const card = cards.find((item) => item.key === key);
  if (!card) throw new Error(`Expected insight fixture to include ${key}.`);
  return card;
}
