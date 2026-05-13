import type {
  CategoryRecord,
  MerchantRuleRow,
  RawTransactionRow,
  TransactionIntent
} from "../db/types";

export type AiSuggestionProviderKind = "mock" | "openai" | "openclaw";

export type AiSuggestionSource =
  | "merchant-rule"
  | "merchant-cue"
  | "plaid-category"
  | "openai"
  | "amount-cue"
  | "fallback";

export type RawTransactionSuggestionFields = Pick<
  RawTransactionRow,
  | "id"
  | "name"
  | "merchant_name"
  | "amount"
  | "iso_currency_code"
  | "payment_channel"
  | "plaid_category"
  | "transaction_type"
>;

export interface AiSuggestionProviderDescriptor {
  id: string;
  kind: AiSuggestionProviderKind;
  label: string;
  version: string;
}

export interface UserCorrectionExample {
  merchant: string;
  categoryName: string;
  intent: TransactionIntent;
  recurring?: boolean | null;
}

export interface TransactionSuggestionRequest {
  rawTransaction: RawTransactionSuggestionFields;
  categories?: readonly CategoryRecord[];
  merchantRules?: readonly MerchantRuleRow[];
  userCorrections?: readonly UserCorrectionExample[];
  cacheKey?: string;
}

export interface ReimbursementCandidateSafeTransaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  intent: TransactionIntent;
}

export interface ReimbursementCandidateSafeInflow {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
}

export interface ReimbursementCandidateHistoricalPattern {
  category?: string;
  confidence?: number;
  counterparty?: string;
  merchant?: string;
  reason?: string;
  suggestedIntent?: Extract<TransactionIntent, "reimbursable" | "shared">;
}

export interface ReimbursementCandidateAiRequest {
  cacheKey?: string;
  candidateInflows: readonly ReimbursementCandidateSafeInflow[];
  heuristicConfidence: number;
  heuristicReasons: readonly string[];
  historicalPatterns?: readonly ReimbursementCandidateHistoricalPattern[];
  transaction: ReimbursementCandidateSafeTransaction;
}

export interface SuggestionField<TValue> {
  value: TValue;
  confidence: number;
  source: AiSuggestionSource;
  reason: string;
}

export interface MerchantCleanupSuggestion {
  original: string;
  normalized: string;
}

export interface CategorySuggestion {
  id: string | null;
  name: string;
}

/**
 * Providers return suggestion records only. Persistence is owned by app-level
 * policies, which may auto-apply only conservative import-time cleanup.
 */
export interface TransactionAiSuggestion {
  suggestionId: string;
  provider: AiSuggestionProviderDescriptor;
  rawTransactionId: string | null;
  merchantCleanup: SuggestionField<MerchantCleanupSuggestion>;
  category: SuggestionField<CategorySuggestion>;
  intent: SuggestionField<TransactionIntent>;
  recurring?: SuggestionField<boolean>;
  confidence: number;
  reason: string;
  signals: string[];
}

export interface ReimbursementCandidateAiSuggestion {
  suggestionId: string;
  provider: AiSuggestionProviderDescriptor;
  targetTransactionId: string;
  suggestedIntent: Extract<TransactionIntent, "reimbursable" | "shared">;
  suggestedInflowIds: string[];
  confidence: number;
  question: string;
  reason: string;
  signals: string[];
}

export interface AiSuggestionAdapter {
  readonly descriptor: AiSuggestionProviderDescriptor;
  suggestTransaction(request: TransactionSuggestionRequest): Promise<TransactionAiSuggestion>;
  suggestTransactions?(requests: readonly TransactionSuggestionRequest[]): Promise<TransactionAiSuggestion[]>;
  suggestReimbursementCandidate?(request: ReimbursementCandidateAiRequest): Promise<ReimbursementCandidateAiSuggestion>;
}
