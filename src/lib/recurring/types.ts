import type {
  Database,
  RecurringCadence,
  RecurringExpenseRecord,
  ReviewReason,
  ReviewStatus,
  TransactionRecord
} from "../db/types";

export type DetectedRecurringCadence = Extract<RecurringCadence, "weekly" | "monthly" | "annual">;

export interface RecurringDetectionReview {
  id: string;
  reason: ReviewReason;
  status: ReviewStatus;
}

export interface RecurringDetectionTransaction
  extends Pick<
    TransactionRecord,
    | "id"
    | "userId"
    | "accountId"
    | "categoryId"
    | "category"
    | "date"
    | "merchant"
    | "amount"
    | "status"
    | "intent"
    | "recurring"
  > {
  reviewItems?: readonly RecurringDetectionReview[];
}

export interface KnownRecurringExpense
  extends Pick<
    RecurringExpenseRecord,
    | "id"
    | "merchant"
    | "amount"
    | "cadence"
    | "accountId"
    | "categoryId"
    | "lastChargeDate"
    | "lastAmount"
    | "status"
    | "isNew"
    | "confidence"
  > {}

export interface RecurringDetectionOptions {
  existingRecurring?: readonly KnownRecurringExpense[];
  allowedCadences?: readonly DetectedRecurringCadence[];
  asOfDate?: string;
  minOccurrences?: number;
  minimumConfidence?: number;
  includePending?: boolean;
  includeIncome?: boolean;
  excludeTransferIntent?: boolean;
  amountToleranceRatio?: number;
  amountToleranceAmount?: number;
  priceChangeThresholdRatio?: number;
  priceChangeThresholdAmount?: number;
}

export interface RecurringCandidateReview {
  id: string;
  reason: ReviewReason;
  status: ReviewStatus;
}

export interface RecurringCandidateTransaction {
  id: string;
  date: string;
  amount: number;
  absoluteAmount: number;
  accountId: string;
  categoryId: string | null;
  category: string;
  recurring: boolean;
  reviewItems: RecurringCandidateReview[];
}

export interface RecurringCadenceEvidence {
  intervalDays: number[];
  matchingIntervals: number;
  totalIntervals: number;
  averageIntervalDays: number | null;
  score: number;
}

export interface RecurringAmountEvidence {
  baselineAmount: number;
  minAmount: number;
  maxAmount: number;
  averageAmount: number;
  toleranceAmount: number;
  score: number;
}

export interface RecurringPriceChangeSignal {
  previousAmount: number;
  currentAmount: number;
  deltaAmount: number;
  deltaRatio: number;
  changedAt: string;
  transactionId: string;
  source: "history" | "known-recurring";
}

export type RecurringCandidateFlagKind = "new-recurring" | "price-change";

export interface RecurringCandidateFlag {
  kind: RecurringCandidateFlagKind;
  severity: "info" | "warning";
  transactionIds: string[];
  priceChange?: RecurringPriceChangeSignal;
}

export interface RecurringCandidate {
  id: string;
  userId: string;
  merchant: string;
  normalizedMerchant: string;
  cadence: DetectedRecurringCadence;
  amount: number;
  confidence: number;
  isNew: boolean;
  existingRecurringId: string | null;
  occurrenceCount: number;
  firstChargeDate: string;
  lastChargeDate: string;
  lastTransactionId: string;
  lastAmount: number;
  nextDueDate: string;
  accountId: string;
  categoryId: string | null;
  category: string | null;
  transactions: RecurringCandidateTransaction[];
  cadenceEvidence: RecurringCadenceEvidence;
  amountEvidence: RecurringAmountEvidence;
  priceChange: RecurringPriceChangeSignal | null;
  flags: RecurringCandidateFlag[];
}

export type RecurringExpenseInsertPayload = Database["public"]["Tables"]["recurring_expenses"]["Insert"];
export type RecurringExpenseUpdatePayload = Database["public"]["Tables"]["recurring_expenses"]["Update"];

export interface RecurringTransactionPatchPayload {
  transactionId: string;
  patch: {
    isRecurring: boolean;
    reviewedAt?: string | null;
  };
}

export interface RecurringReviewResolutionPayload {
  reviewItemId: string;
  status: Exclude<ReviewStatus, "open">;
  resolutionNote: string;
}

export interface RecurringExpenseUpsertPayload {
  table: "recurring_expenses";
  conflictColumns: readonly ["user_id", "merchant_name", "cadence"];
  values: RecurringExpenseInsertPayload;
}

export interface ConfirmRecurringCandidatePayload {
  action: "confirm-recurring";
  candidateId: string;
  recurringExpense: RecurringExpenseUpsertPayload;
  transactionUpdates: RecurringTransactionPatchPayload[];
  reviewResolutions: RecurringReviewResolutionPayload[];
}

export interface DismissRecurringCandidatePayload {
  action: "dismiss-recurring";
  candidateId: string;
  recurringExpense?: RecurringExpenseUpsertPayload;
  transactionUpdates: RecurringTransactionPatchPayload[];
  reviewResolutions: RecurringReviewResolutionPayload[];
  recurringExpenseUpdate?: {
    table: "recurring_expenses";
    id: string;
    values: RecurringExpenseUpdatePayload;
  };
}

export interface BuildConfirmRecurringActionOptions {
  reviewedAt?: string | null;
  resolutionNote?: string;
  status?: Extract<RecurringExpenseRecord["status"], "active" | "pending">;
}

export interface BuildDismissRecurringActionOptions {
  reviewedAt?: string | null;
  resolutionNote?: string;
  markTransactionsNonRecurring?: boolean;
}
