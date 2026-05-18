import type { CategoryRecord, MerchantRuleRow, TransactionIntent } from "../db/types";
import type {
  AiSuggestionAdapter,
  AiSuggestionProviderDescriptor,
  AiSuggestionSource,
  CategorySuggestion,
  MerchantCleanupSuggestion,
  ReimbursementCandidateAiRequest,
  ReimbursementCandidateAiSuggestion,
  TransactionAiSuggestion,
  TransactionSuggestionRequest
} from "./types";

const PEER_TO_PEER_CATEGORY = "Uncategorized";
const FALLBACK_SPENDING_CATEGORY = "Shopping";
const MOCK_VERSION = "mock-v2";

export const MOCK_AI_SUGGESTION_PROVIDER: AiSuggestionProviderDescriptor = {
  id: "mock-deterministic",
  kind: "mock",
  label: "Deterministic mock suggestions",
  version: MOCK_VERSION
};

interface Cue {
  categoryName: string;
  intent: TransactionIntent;
  confidence: number;
  reason: string;
  source: AiSuggestionSource;
  normalizedMerchantName?: string;
  recurring?: boolean;
  signals: string[];
}

interface MerchantCue {
  patterns: readonly string[];
  categoryName: string;
  intent: TransactionIntent;
  confidence: number;
  reason: string;
  normalizedMerchantName?: string | ((merchant: string) => string);
  recurring?: boolean;
}

interface PlaidCategoryCue {
  patterns: readonly string[];
  categoryName: string;
  intent: TransactionIntent;
  confidence: number;
  reason: string;
}

const MERCHANT_CUES: readonly MerchantCue[] = [
  {
    patterns: ["VENMO", "ZELLE", "CASH APP", "PAYPAL"],
    categoryName: PEER_TO_PEER_CATEGORY,
    intent: "shared",
    confidence: 0.64,
    reason: "Peer-to-peer payment needs an explanation before Tally should trust a spend bucket.",
    normalizedMerchantName: normalizePeerToPeerMerchant
  },
  {
    patterns: ["CARD PAYMENT", "PMT THANK YOU", "AUTOPAY", "ACH TRANSFER"],
    categoryName: "Transfer",
    intent: "transfer",
    confidence: 0.91,
    reason: "Payment and transfer wording points to movement between accounts, not spending."
  },
  {
    patterns: ["PAYROLL", "DIRECT DEP", "SALARY"],
    categoryName: "Income",
    intent: "personal",
    confidence: 0.93,
    reason: "Deposit wording and positive cashflow point to income."
  },
  {
    patterns: ["OPENAI", "ANTHROPIC", "CURSOR"],
    categoryName: "Software / AI Tools",
    intent: "business",
    confidence: 0.95,
    reason: "Known AI software subscription merchant.",
    normalizedMerchantName: normalizeKnownMerchantName,
    recurring: true
  },
  {
    patterns: ["VERCEL"],
    categoryName: "Software / Hosting",
    intent: "business",
    confidence: 0.94,
    reason: "Known hosting software merchant.",
    normalizedMerchantName: "Vercel",
    recurring: true
  },
  {
    patterns: ["LINEAR", "FIGMA", "NOTION", "GITHUB"],
    categoryName: "Software / SaaS",
    intent: "business",
    confidence: 0.93,
    reason: "Known work software merchant.",
    normalizedMerchantName: normalizeKnownMerchantName,
    recurring: true
  },
  {
    patterns: ["LUCKY STRIKE", "BOWLERO", "AMF BOWLING", "BOWLING"],
    categoryName: "Entertainment",
    intent: "personal",
    confidence: 0.96,
    reason: "Known bowling and entertainment venue merchant.",
    normalizedMerchantName: normalizeKnownMerchantName
  },
  {
    patterns: ["AMC", "REGAL", "CINEMARK", "ALAMO DRAFTHOUSE", "FANDANGO", "MOVIE", "CINEMA"],
    categoryName: "Entertainment",
    intent: "personal",
    confidence: 0.94,
    reason: "Known movie and cinema merchant.",
    normalizedMerchantName: normalizeKnownMerchantName
  },
  {
    patterns: ["TICKETMASTER", "LIVE NATION", "AXS", "SEATGEEK", "EVENTBRITE"],
    categoryName: "Entertainment",
    intent: "personal",
    confidence: 0.93,
    reason: "Known event ticketing merchant.",
    normalizedMerchantName: normalizeKnownMerchantName
  },
  {
    patterns: ["NETFLIX", "HULU", "DISNEY+", "DISNEY PLUS", "HBO MAX", "PARAMOUNT+", "PEACOCK", "APPLE TV", "SPOTIFY"],
    categoryName: "Entertainment",
    intent: "personal",
    confidence: 0.93,
    reason: "Known personal entertainment subscription merchant.",
    normalizedMerchantName: normalizeKnownMerchantName,
    recurring: true
  },
  {
    patterns: ["SUBSTACK"],
    categoryName: "Software / SaaS",
    intent: "personal",
    confidence: 0.86,
    reason: "Known personal subscription merchant.",
    normalizedMerchantName: normalizeKnownMerchantName,
    recurring: true
  },
  {
    patterns: ["SWEETGREEN", "PIZZA", "BAGEL", "STARBUCKS", "RESTAURANT", "CAFE"],
    categoryName: "Food / Restaurants",
    intent: "personal",
    confidence: 0.9,
    reason: "Restaurant merchant cue.",
    normalizedMerchantName: normalizeKnownMerchantName
  },
  {
    patterns: ["WHOLE FOODS", "TRADER JOE", "SAFEWAY", "GROCERY"],
    categoryName: "Groceries",
    intent: "personal",
    confidence: 0.91,
    reason: "Grocery merchant cue.",
    normalizedMerchantName: normalizeKnownMerchantName
  },
  {
    patterns: ["UBER", "LYFT"],
    categoryName: "Transport / Rideshare",
    intent: "personal",
    confidence: 0.9,
    reason: "Rideshare merchant cue.",
    normalizedMerchantName: normalizeKnownMerchantName
  },
  {
    patterns: ["DELTA", "UNITED AIRLINES", "AMERICAN AIRLINES", "SOUTHWEST"],
    categoryName: "Travel / Flights",
    intent: "business",
    confidence: 0.76,
    reason: "Airline merchant cue; travel intent should stay reviewable.",
    normalizedMerchantName: normalizeKnownMerchantName
  },
  {
    patterns: ["EQUINOX"],
    categoryName: "Health / Fitness",
    intent: "personal",
    confidence: 0.94,
    reason: "Known fitness subscription merchant.",
    normalizedMerchantName: "Equinox",
    recurring: true
  },
  {
    patterns: ["CVS", "PHARMACY", "WALGREENS"],
    categoryName: "Health / Pharmacy",
    intent: "personal",
    confidence: 0.89,
    reason: "Pharmacy merchant cue.",
    normalizedMerchantName: normalizeKnownMerchantName
  },
  {
    patterns: ["AMAZON", "TARGET"],
    categoryName: "Shopping",
    intent: "personal",
    confidence: 0.84,
    reason: "General retail merchant cue.",
    normalizedMerchantName: normalizeKnownMerchantName
  },
  {
    patterns: ["RENT", "APARTMENT", "PROPERTY MGMT"],
    categoryName: "Housing",
    intent: "personal",
    confidence: 0.9,
    reason: "Housing merchant cue.",
    recurring: true
  }
];

const PLAID_CATEGORY_CUES: readonly PlaidCategoryCue[] = [
  {
    patterns: ["TRANSFER", "PAYMENT"],
    categoryName: "Transfer",
    intent: "transfer",
    confidence: 0.79,
    reason: "Plaid category indicates a transfer or payment."
  },
  {
    patterns: ["DEPOSIT", "PAYROLL", "INCOME"],
    categoryName: "Income",
    intent: "personal",
    confidence: 0.82,
    reason: "Plaid category indicates money coming in."
  },
  {
    patterns: ["FOOD", "RESTAURANT", "DINING"],
    categoryName: "Food / Restaurants",
    intent: "personal",
    confidence: 0.74,
    reason: "Plaid category indicates restaurant spending."
  },
  {
    patterns: ["GROCER"],
    categoryName: "Groceries",
    intent: "personal",
    confidence: 0.76,
    reason: "Plaid category indicates groceries."
  },
  {
    patterns: ["TRAVEL", "AIRLINE", "FLIGHT"],
    categoryName: "Travel / Flights",
    intent: "personal",
    confidence: 0.68,
    reason: "Plaid category indicates travel."
  },
  {
    patterns: ["TAXI", "RIDE", "TRANSPORT"],
    categoryName: "Transport / Rideshare",
    intent: "personal",
    confidence: 0.7,
    reason: "Plaid category indicates transport."
  },
  {
    patterns: ["ENTERTAINMENT", "RECREATION", "BOWLING", "MOVIE", "CINEMA", "MUSIC", "ARTS"],
    categoryName: "Entertainment",
    intent: "personal",
    confidence: 0.82,
    reason: "Plaid category indicates entertainment or recreational spending."
  },
  {
    patterns: ["SERVICE"],
    categoryName: "Software / SaaS",
    intent: "business",
    confidence: 0.58,
    reason: "Plaid category is a generic service cue, so confidence stays low."
  }
];

export function createMockSuggestionAdapter(): AiSuggestionAdapter {
  return {
    descriptor: MOCK_AI_SUGGESTION_PROVIDER,
    async suggestReimbursementCandidate(request) {
      return suggestReimbursementCandidateWithMockProvider(request);
    },
    async suggestTransaction(request) {
      return suggestTransactionWithMockProvider(request);
    },
    async suggestTransactions(requests) {
      return requests.map(suggestTransactionWithMockProvider);
    }
  };
}

export function suggestReimbursementCandidateWithMockProvider(
  request: ReimbursementCandidateAiRequest
): ReimbursementCandidateAiSuggestion {
  const transaction = request.transaction;
  const categoryText = transaction.category.toLowerCase();
  const hasTravelOrHousing = /\b(travel|hotel|flight|airfare|rent|housing|utilities)\b/.test(categoryText);
  const hasPeerInflow = request.candidateInflows.some((inflow) =>
    /\b(venmo|zelle|cash app|cashapp|paypal|apple cash)\b/i.test(inflow.merchant)
  );
  const historicalBoost = request.historicalPatterns?.some((pattern) =>
    (pattern.merchant && transaction.merchant.toLowerCase().includes(pattern.merchant.toLowerCase())) ||
    (pattern.category && transaction.category.toLowerCase() === pattern.category.toLowerCase())
  ) ? 0.06 : 0;
  const confidence = roundConfidence(clamp(
    request.heuristicConfidence +
      (hasPeerInflow ? 0.08 : 0) +
      (hasTravelOrHousing ? 0.03 : 0) +
      historicalBoost,
    0.35,
    0.96
  ));
  const suggestedIntent = hasPeerInflow || hasTravelOrHousing ? "reimbursable" : "shared";
  const question = `Was ${transaction.merchant} on ${transaction.date} reimbursable or split with someone?`;

  return {
    suggestionId: `mock-reimbursement-${stableHash([
      MOCK_VERSION,
      transaction.id,
      transaction.amount.toFixed(2),
      request.candidateInflows.map((inflow) => inflow.id).join(",")
    ].join("|"))}`,
    provider: MOCK_AI_SUGGESTION_PROVIDER,
    targetTransactionId: transaction.id,
    suggestedIntent,
    suggestedInflowIds: request.candidateInflows.map((inflow) => inflow.id),
    confidence,
    question,
    reason: hasPeerInflow
      ? "Nearby peer-payment inflow makes this charge worth confirming."
      : "Category and amount make this charge worth confirming.",
    signals: [
      ...request.heuristicReasons.slice(0, 4),
      hasPeerInflow ? "nearby peer-payment inflow" : "no strong peer-payment inflow",
      `heuristic confidence ${request.heuristicConfidence.toFixed(2)}`
    ]
  };
}

export function suggestTransactionWithMockProvider(request: TransactionSuggestionRequest): TransactionAiSuggestion {
  const raw = request.rawTransaction;
  const originalMerchant = getOriginalMerchant(raw.merchant_name, raw.name);
  const cleanedMerchant = cleanupMerchantName(originalMerchant);
  const categoryLookup = createCategoryLookup(request.categories ?? []);
  const merchantCue = findMerchantCue(originalMerchant, cleanedMerchant);
  const cue = mergeWithMerchantRule({
    cue: merchantCue ?? findPlaidCategoryCue(raw.plaid_category) ?? findAmountCue(raw.amount) ?? fallbackCue(cleanedMerchant),
    cleanedMerchant,
    categoryLookup,
    merchantRule: findMatchingMerchantRule(originalMerchant, raw.amount, request.merchantRules ?? [])
  });
  const category = resolveCategory(cue.categoryName, categoryLookup);
  const merchantCleanup = resolveMerchantCleanup({
    original: originalMerchant,
    cleaned: cleanedMerchant,
    cue
  });
  const confidence = adjustConfidence(cue.confidence, {
    amount: raw.amount,
    categoryName: category.name,
    intent: cue.intent,
    hasMerchantName: Boolean(raw.merchant_name)
  });
  const reason = buildReason(cue.reason, {
    amount: raw.amount,
    categoryName: category.name,
    intent: cue.intent
  });
  const signals = [
    ...cue.signals,
    raw.plaid_category ? `plaid category: ${raw.plaid_category}` : "plaid category missing",
    raw.payment_channel ? `payment channel: ${raw.payment_channel}` : "payment channel missing"
  ];

  return {
    suggestionId: `mock-${stableHash([
      MOCK_VERSION,
      raw.id,
      raw.name,
      raw.merchant_name ?? "",
      raw.amount.toFixed(2),
      raw.iso_currency_code,
      raw.payment_channel ?? "",
      raw.plaid_category ?? "",
      raw.transaction_type ?? ""
    ].join("|"))}`,
    provider: MOCK_AI_SUGGESTION_PROVIDER,
    rawTransactionId: raw.id,
    merchantCleanup: {
      value: merchantCleanup,
      confidence,
      source: cue.source,
      reason: merchantCleanup.original === merchantCleanup.normalized
        ? "Merchant already looks normalized."
        : "Normalized provider merchant text into a ledger-friendly label."
    },
    category: {
      value: category,
      confidence,
      source: cue.source,
      reason: cue.reason
    },
    intent: {
      value: cue.intent,
      confidence,
      source: cue.source,
      reason: cue.reason
    },
    recurring: cue.recurring === undefined
      ? undefined
      : {
        value: cue.recurring,
        confidence,
        source: cue.source,
        reason: cue.recurring
          ? "Merchant cue suggests a repeating charge."
          : "Merchant cue does not suggest a repeating charge."
      },
    confidence,
    reason,
    signals
  };
}

function getOriginalMerchant(merchantName: string | null, name: string) {
  return (merchantName ?? name).trim();
}

function createCategoryLookup(categories: readonly CategoryRecord[]) {
  return {
    byId: new Map(categories.map((category) => [category.id, category])),
    byName: new Map(categories.map((category) => [normalizeKey(category.name), category]))
  };
}

function resolveCategory(
  categoryName: string,
  lookup: ReturnType<typeof createCategoryLookup>,
  categoryId?: string | null
): CategorySuggestion {
  if (categoryId) {
    const category = lookup.byId.get(categoryId);
    if (category) {
      return { id: category.id, name: category.name };
    }
  }

  const category = lookup.byName.get(normalizeKey(categoryName));
  return {
    id: category?.id ?? null,
    name: category?.name ?? categoryName
  };
}

function findMerchantCue(originalMerchant: string, cleanedMerchant: string): Cue | null {
  const haystack = `${originalMerchant} ${cleanedMerchant}`.toUpperCase();
  const cue = MERCHANT_CUES.find((candidate) =>
    candidate.patterns.some((pattern) => haystack.includes(pattern))
  );

  if (!cue) return null;

  const normalizedMerchantName = typeof cue.normalizedMerchantName === "function"
    ? cue.normalizedMerchantName(originalMerchant)
    : cue.normalizedMerchantName;

  return {
    categoryName: cue.categoryName,
    intent: cue.intent,
    confidence: cue.confidence,
    reason: cue.reason,
    source: "merchant-cue",
    normalizedMerchantName,
    recurring: cue.recurring,
    signals: [`merchant cue: ${cue.patterns.join(" or ")}`]
  };
}

function findPlaidCategoryCue(plaidCategory: string | null): Cue | null {
  if (!plaidCategory) return null;

  const haystack = plaidCategory.toUpperCase();
  const cue = PLAID_CATEGORY_CUES.find((candidate) =>
    candidate.patterns.some((pattern) => haystack.includes(pattern))
  );

  if (!cue) return null;

  return {
    categoryName: cue.categoryName,
    intent: cue.intent,
    confidence: cue.confidence,
    reason: cue.reason,
    source: "plaid-category",
    signals: [`plaid category cue: ${cue.patterns.join(" or ")}`]
  };
}

function findAmountCue(amount: number): Cue | null {
  if (amount <= 0) return null;

  return {
    categoryName: "Income",
    intent: "personal",
    confidence: 0.62,
    reason: "Positive transaction amount suggests incoming money.",
    source: "amount-cue",
    signals: ["amount cue: positive amount"]
  };
}

function fallbackCue(cleanedMerchant: string): Cue {
  return {
    categoryName: FALLBACK_SPENDING_CATEGORY,
    intent: "personal",
    confidence: 0.45,
    reason: `${cleanedMerchant} has no strong merchant or category cue, so Tally proposes a low-confidence spending category for review.`,
    source: "fallback",
    signals: ["fallback cue"]
  };
}

function mergeWithMerchantRule({
  cue,
  cleanedMerchant,
  categoryLookup,
  merchantRule
}: {
  cue: Cue;
  cleanedMerchant: string;
  categoryLookup: ReturnType<typeof createCategoryLookup>;
  merchantRule: MerchantRuleRow | null;
}): Cue {
  if (!merchantRule) return cue;

  const ruleCategory = merchantRule.category_id
    ? resolveCategory(cue.categoryName, categoryLookup, merchantRule.category_id)
    : null;

  return {
    categoryName: ruleCategory?.name ?? cue.categoryName,
    intent: merchantRule.intent ?? cue.intent,
    confidence: Math.max(cue.confidence, merchantRule.normalized_merchant_name || merchantRule.category_id || merchantRule.intent ? 0.9 : 0.68),
    reason: merchantRule.notes ?? "Matched a saved merchant rule.",
    source: "merchant-rule",
    normalizedMerchantName: merchantRule.normalized_merchant_name ?? cue.normalizedMerchantName ?? cleanedMerchant,
    recurring: merchantRule.is_recurring ?? cue.recurring,
    signals: [`merchant rule: ${merchantRule.merchant_pattern}`, ...cue.signals]
  };
}

function findMatchingMerchantRule(
  merchant: string,
  amount: number,
  merchantRules: readonly MerchantRuleRow[]
): MerchantRuleRow | null {
  const absoluteAmount = Math.abs(amount);

  return merchantRules
    .filter((rule) => {
      if (!rule.enabled) return false;
      if (rule.min_amount !== null && absoluteAmount < rule.min_amount) return false;
      if (rule.max_amount !== null && absoluteAmount > rule.max_amount) return false;
      return sqlLikeMatches(rule.merchant_pattern, merchant);
    })
    .sort((a, b) => a.priority - b.priority)[0] ?? null;
}

function sqlLikeMatches(pattern: string, value: string) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
  return regex.test(value);
}

function resolveMerchantCleanup({
  original,
  cleaned,
  cue
}: {
  original: string;
  cleaned: string;
  cue: Cue;
}): MerchantCleanupSuggestion {
  return {
    original,
    normalized: cue.normalizedMerchantName ?? cleaned
  };
}

function cleanupMerchantName(merchant: string) {
  const withoutPrefixes = merchant
    .replace(/^(pos|debit|checkcard|sq \*|tst\*|paypal \*)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const withoutStoreNumber = withoutPrefixes.replace(/\s+#?\d{3,}\b.*$/i, "");
  const withoutLocation = withoutStoreNumber.replace(
    /\s+(new york|ny|san francisco|sf|ca|brooklyn|los angeles|online)$/i,
    ""
  );

  return titleCase(withoutLocation.trim() || merchant.trim());
}

function normalizePeerToPeerMerchant(merchant: string) {
  const compact = merchant.replace(/\s+/g, " ").trim();
  const upper = compact.toUpperCase();
  const platform = upper.includes("CASH APP")
    ? "Cash App"
    : upper.includes("ZELLE")
      ? "Zelle"
      : upper.includes("PAYPAL")
        ? "PayPal"
        : "Venmo";
  const counterparty = compact
    .replace(/venmo|zelle|cash app|paypal/ig, "")
    .replace(/cashout|payment to|payment|transfer|to|-/ig, "")
    .trim();

  return counterparty ? `${platform} - ${titleCase(counterparty)}` : platform;
}

function normalizeKnownMerchantName(merchant: string) {
  const upper = merchant.toUpperCase();
  const knownNames: readonly [string, string][] = [
    ["OPENAI", "OpenAI"],
    ["ANTHROPIC", "Anthropic"],
    ["CURSOR", "Cursor"],
    ["LINEAR", "Linear"],
    ["FIGMA", "Figma"],
    ["NOTION", "Notion"],
    ["GITHUB", "GitHub"],
    ["SPOTIFY", "Spotify"],
    ["SUBSTACK", "Substack"],
    ["LUCKY STRIKE", "Lucky Strike"],
    ["BOWLERO", "Bowlero"],
    ["AMF BOWLING", "AMF Bowling"],
    ["AMC", "AMC Theatres"],
    ["REGAL", "Regal"],
    ["CINEMARK", "Cinemark"],
    ["ALAMO DRAFTHOUSE", "Alamo Drafthouse"],
    ["FANDANGO", "Fandango"],
    ["TICKETMASTER", "Ticketmaster"],
    ["LIVE NATION", "Live Nation"],
    ["SEATGEEK", "SeatGeek"],
    ["EVENTBRITE", "Eventbrite"],
    ["NETFLIX", "Netflix"],
    ["HULU", "Hulu"],
    ["DISNEY", "Disney+"],
    ["HBO MAX", "HBO Max"],
    ["PARAMOUNT", "Paramount+"],
    ["PEACOCK", "Peacock"],
    ["APPLE TV", "Apple TV"],
    ["SWEETGREEN", "Sweetgreen"],
    ["WHOLE FOODS", "Whole Foods"],
    ["TRADER JOE", "Trader Joe's"],
    ["UBER", "Uber"],
    ["LYFT", "Lyft"],
    ["DELTA", "Delta Air Lines"],
    ["UNITED AIRLINES", "United Airlines"],
    ["AMERICAN AIRLINES", "American Airlines"],
    ["SOUTHWEST", "Southwest"],
    ["CVS", "CVS Pharmacy"],
    ["WALGREENS", "Walgreens"],
    ["AMAZON", "Amazon"],
    ["TARGET", "Target"]
  ];
  const knownName = knownNames.find(([pattern]) => upper.includes(pattern));

  return knownName?.[1] ?? cleanupMerchantName(merchant);
}

function adjustConfidence(
  baseConfidence: number,
  context: {
    amount: number;
    categoryName: string;
    intent: TransactionIntent;
    hasMerchantName: boolean;
  }
) {
  const absoluteAmount = Math.abs(context.amount);
  const largeReviewableAmount = absoluteAmount >= 500
    && context.intent !== "transfer"
    && context.categoryName !== "Income"
    && context.categoryName !== "Housing";
  const merchantPenalty = context.hasMerchantName ? 0 : 0.03;
  const largeAmountPenalty = largeReviewableAmount ? 0.08 : 0;

  return roundConfidence(clamp(baseConfidence - merchantPenalty - largeAmountPenalty, 0.25, 0.99));
}

function buildReason(
  reason: string,
  context: {
    amount: number;
    categoryName: string;
    intent: TransactionIntent;
  }
) {
  const absoluteAmount = Math.abs(context.amount);
  const largeReviewableAmount = absoluteAmount >= 500
    && context.intent !== "transfer"
    && context.categoryName !== "Income"
    && context.categoryName !== "Housing";

  return largeReviewableAmount
    ? `${reason} Large amount lowers confidence until reviewed.`
    : reason;
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (["AI", "ACH", "NYC", "CVS", "PBC", "SF"].includes(upper)) return upper;
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundConfidence(value: number) {
  return Math.round(value * 100) / 100;
}
