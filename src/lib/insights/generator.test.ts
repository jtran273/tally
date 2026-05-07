import type {
  AccountRecord,
  InsightRecord,
  RecurringExpenseRecord,
  ReviewQueueItem,
  ReviewReason,
  TransactionRecord
} from "@/lib/db";
import type { BalanceTrendPoint } from "@/lib/finance/balances";
import type { RecurringCandidate } from "@/lib/recurring";
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
    plaidName: null,
    plaidTransactionId: null,
    rawTransactionId: `raw-${input.id}`,
    recurring: false,
    reimbursements: [],
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
  category: "Groceries",
  categoryId: "category-groceries",
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

export const insightGeneratorRecurringCandidateFixture = [
  {
    accountId: "account-checking",
    amount: 13.99,
    amountEvidence: {
      averageAmount: 11.33,
      baselineAmount: 10,
      maxAmount: 13.99,
      minAmount: 10,
      score: 0.82,
      toleranceAmount: 2
    },
    cadence: "monthly",
    cadenceEvidence: {
      averageIntervalDays: 30,
      intervalDays: [31, 30],
      matchingIntervals: 2,
      score: 0.95,
      totalIntervals: 2
    },
    category: "Media",
    categoryId: "category-media",
    confidence: 0.88,
    existingRecurringId: "rec-streaming",
    firstChargeDate: "2026-03-05",
    flags: [],
    id: "candidate-streaming",
    isNew: false,
    lastAmount: 13.99,
    lastChargeDate: "2026-05-05",
    lastTransactionId: "tx-streaming",
    merchant: "Streaming Co",
    nextDueDate: "2026-06-05",
    normalizedMerchant: "streaming",
    occurrenceCount: 3,
    priceChange: {
      changedAt: "2026-05-05",
      currentAmount: 13.99,
      deltaAmount: 3.99,
      deltaRatio: 0.4,
      previousAmount: 10,
      source: "known-recurring",
      transactionId: "tx-streaming"
    },
    transactions: [],
    userId
  }
] satisfies readonly RecurringCandidate[];

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
  recurringCandidates: insightGeneratorRecurringCandidateFixture,
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

  const priceChangeCard = requireCard(cards, "recurring-price-change");
  if (!priceChangeCard.body.includes("$10.00 to $13.99") || priceChangeCard.href !== "/transactions/tx-streaming") {
    throw new Error("Expected known recurring price changes to become actionable insight cards.");
  }

  const persistedCard = requireCard(cards, "software-costs-up");
  if (!persistedCard.body.includes("directional") || !persistedCard.href.includes("Software")) {
    throw new Error("Expected persisted spend-sensitive insight to be labeled directional with a filtered link.");
  }

  const cashflowCard = requireCard(cards, "spending-cashflow");
  if (
    !cashflowCard.title.includes("Month cashflow") ||
    !cashflowCard.href.includes("exclude_transfers=1") ||
    !cashflowCard.body.includes("trusted spending") ||
    !cashflowCard.body.includes("open review")
  ) {
    throw new Error("Expected generated cashflow insight to split trusted and unresolved spending with filtered evidence.");
  }

  const categoryCard = requireCard(cards, "spending-top-category");
  if (!categoryCard.title.includes("Groceries") || !categoryCard.href.includes("category=category-groceries")) {
    throw new Error("Expected generated top category insight to use deterministic category spend evidence.");
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
