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

export interface TransactionSuggestionRequest {
  rawTransaction: RawTransactionSuggestionFields;
  categories?: readonly CategoryRecord[];
  merchantRules?: readonly MerchantRuleRow[];
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
 * Providers return suggestion records only. Persisting these values to
 * enriched_transactions should happen only after an explicit user action.
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

export interface AiSuggestionAdapter {
  readonly descriptor: AiSuggestionProviderDescriptor;
  suggestTransaction(request: TransactionSuggestionRequest): Promise<TransactionAiSuggestion>;
  suggestTransactions?(requests: readonly TransactionSuggestionRequest[]): Promise<TransactionAiSuggestion[]>;
}
