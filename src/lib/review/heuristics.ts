import type {
  Database,
  EnrichedTransactionRow,
  Json,
  ReviewReason
} from "../db";
import type { RecurringCandidate } from "../recurring";

type ReviewItemInsert = Database["public"]["Tables"]["review_items"]["Insert"];

const LOW_CONFIDENCE_THRESHOLD = 0.65;
const VERY_LOW_CONFIDENCE_THRESHOLD = 0.4;
const LARGE_SPENDING_THRESHOLD = 500;
const PEER_TO_PEER_MERCHANT_PATTERN = /\b(apple cash|cash app|cashapp|venmo|zelle)\b/i;

function suggestion(value: Record<string, unknown>): Json {
  return value as Json;
}

function baseReviewItem(
  transaction: Pick<EnrichedTransactionRow, "id" | "user_id">,
  reason: ReviewReason,
  explanation: string,
  aiSuggestion: Json,
  confidence: number | null
): ReviewItemInsert {
  return {
    ai_suggestion: aiSuggestion,
    confidence,
    enriched_transaction_id: transaction.id,
    explanation,
    reason,
    status: "open",
    user_id: transaction.user_id
  };
}

export function buildTransactionReviewItems(transaction: EnrichedTransactionRow): ReviewItemInsert[] {
  const items: ReviewItemInsert[] = [];
  const categoryName = transaction.category_name.trim().toLowerCase();
  const needsCategory = transaction.intent !== "transfer" &&
    categoryName !== "transfer" &&
    (!transaction.category_id || !categoryName || categoryName === "uncategorized");

  if (isPeerToPeerTransaction(transaction)) {
    items.push(baseReviewItem(
      transaction,
      "venmo",
      "This peer-to-peer Plaid transaction needs the real purpose explained before it leaves review.",
      suggestion({
        reason: "Peer-to-peer payments hide the real merchant, category, and split details.",
        signals: ["peer-to-peer-merchant"]
      }),
      transaction.confidence
    ));

    return items;
  }

  if (needsCategory) {
    items.push(baseReviewItem(
      transaction,
      "missing-category",
      "This real Plaid transaction is still uncategorized.",
      suggestion({
        reason: "Choose the right category before trusting this transaction in totals.",
        signals: ["plaid-category-missing"]
      }),
      transaction.confidence
    ));
  }

  // Flag low-confidence when Plaid is genuinely uncertain:
  // - Below VERY_LOW threshold (≈ UNKNOWN Plaid level): flag regardless of category
  // - Below LOW_CONFIDENCE threshold: only flag when the category is also unclear
  const isVeryLowConfidence = transaction.confidence !== null && transaction.confidence < VERY_LOW_CONFIDENCE_THRESHOLD;
  const isModeratelyLowWithNoCategory = transaction.confidence !== null &&
    transaction.confidence < LOW_CONFIDENCE_THRESHOLD &&
    needsCategory;

  if (isVeryLowConfidence || isModeratelyLowWithNoCategory) {
    items.push(baseReviewItem(
      transaction,
      "low-confidence",
      "Plaid's category confidence is low for this imported transaction.",
      suggestion({
        confidence: transaction.confidence,
        reason: "Confirm the merchant, category, and intent before marking this row reviewed.",
        signals: ["plaid-low-confidence"]
      }),
      transaction.confidence
    ));
  }

  if (
    transaction.amount < 0 &&
    Math.abs(transaction.amount) >= LARGE_SPENDING_THRESHOLD &&
    transaction.intent !== "transfer" &&
    !transaction.is_recurring
  ) {
    items.push(baseReviewItem(
      transaction,
      "large",
      "This real Plaid charge is large enough to review before it is treated as ordinary spending.",
      suggestion({
        reason: "Confirm whether this is normal spending, reimbursable, shared, or a transfer.",
        signals: ["large-real-plaid-charge"]
      }),
      transaction.confidence
    ));
  }

  return items;
}

function isPeerToPeerTransaction(
  transaction: Pick<EnrichedTransactionRow, "amount" | "intent" | "merchant_name">
) {
  return transaction.amount < 0
    && transaction.intent !== "transfer"
    && PEER_TO_PEER_MERCHANT_PATTERN.test(transaction.merchant_name);
}

export function buildRecurringCandidateReviewItem(candidate: RecurringCandidate): ReviewItemInsert {
  return {
    ai_suggestion: suggestion({
      confidence: candidate.confidence,
      reason: `${candidate.occurrenceCount} real transactions repeat on a ${candidate.cadence} cadence.`,
      recurring: true,
      signals: [
        "real-plaid-recurring-pattern",
        `cadence:${candidate.cadence}`,
        `occurrences:${candidate.occurrenceCount}`
      ]
    }),
    confidence: candidate.confidence,
    enriched_transaction_id: candidate.lastTransactionId,
    explanation: "Repeated real Plaid transactions look like a recurring expense.",
    reason: candidate.isNew ? "new-recurring" : "recurring-candidate",
    status: "open",
    user_id: candidate.userId
  };
}
