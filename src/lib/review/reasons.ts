import type { ReviewReason } from "@/lib/db";

export interface ReviewReasonCopy {
  action: string;
  description: string;
  label: string;
  requiresExplanation: boolean;
  shortLabel: string;
}

export const REVIEW_REASON_ORDER: ReviewReason[] = [
  "venmo",
  "missing-category",
  "low-confidence",
  "unclear-transfer",
  "transfer-pair",
  "large",
  "recurring-candidate",
  "new-recurring"
];

export const REVIEW_REASON_COPY: Record<ReviewReason, ReviewReasonCopy> = {
  large: {
    action: "Confirm the label, intent, and whether this is ordinary spend.",
    description: "The amount is larger than the usual pattern for this merchant, account, or category.",
    label: "Large transaction",
    requiresExplanation: false,
    shortLabel: "Large"
  },
  "low-confidence": {
    action: "Accept the suggestion only after the category and intent look right.",
    description: "The AI suggestion has weak signals and should not become trusted automatically.",
    label: "Low confidence",
    requiresExplanation: false,
    shortLabel: "Low confidence"
  },
  "missing-category": {
    action: "Choose a real category before counting this transaction as trusted.",
    description: "The transaction is still uncategorized or has no linked category record.",
    label: "Missing category",
    requiresExplanation: false,
    shortLabel: "Missing category"
  },
  "new-recurring": {
    action: "Confirm or dismiss the recurring pattern.",
    description: "A repeated charge looks like a new fixed cost that should be tracked.",
    label: "New recurring charge",
    requiresExplanation: false,
    shortLabel: "New recurring"
  },
  "recurring-candidate": {
    action: "Confirm whether the detected cadence should be tracked as recurring.",
    description: "The merchant and amount repeat often enough to look like a subscription or fixed cost.",
    label: "Recurring candidate",
    requiresExplanation: false,
    shortLabel: "Recurring"
  },
  "transfer-pair": {
    action: "Accept only if this is movement between your own accounts.",
    description: "A debit and credit look like a matching transfer pair, so this may not be spending.",
    label: "Possible transfer pair",
    requiresExplanation: false,
    shortLabel: "Transfer pair"
  },
  "unclear-transfer": {
    action: "Review the merchant and account context before excluding it from spending.",
    description: "Transfer-like wording is present, but the counterparty or matching transaction is unclear.",
    label: "Unclear transfer",
    requiresExplanation: false,
    shortLabel: "Unclear transfer"
  },
  venmo: {
    action: "Explain the real purpose before this leaves the open queue.",
    description: "Peer-to-peer payments hide the actual merchant, category, and split details.",
    label: "Peer-to-peer payment",
    requiresExplanation: true,
    shortLabel: "Peer-to-peer"
  }
};

export function getReviewReasonCopy(reason: ReviewReason) {
  return REVIEW_REASON_COPY[reason];
}

export function isPeerToPeerReview(reason: ReviewReason) {
  return REVIEW_REASON_COPY[reason].requiresExplanation;
}
