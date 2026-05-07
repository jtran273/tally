import { TransactionSuggestionService } from "./suggestion-service";
import {
  createConfiguredSuggestionAdapter,
  getOpenAiSuggestionModel,
  isOpenAiSuggestionConfigured
} from "./openai-provider";
import type { AiSuggestionProviderKind } from "./types";

export interface AiProviderStatus {
  activeKind: AiSuggestionProviderKind;
  configured: boolean;
  label: string;
  model: string | null;
  summary: string;
}

export function getAiProviderStatus(): AiProviderStatus {
  const configured = isOpenAiSuggestionConfigured();
  const model = configured ? getOpenAiSuggestionModel() : null;

  return configured
    ? {
      activeKind: "openai",
      configured,
      label: "OpenAI optional provider",
      model,
      summary: "OPENAI_API_KEY is present on the server. AI suggestions can review enriched Plaid records, with deterministic fallback on errors."
    }
    : {
      activeKind: "mock",
      configured,
      label: "Deterministic Plaid-only fallback",
      model,
      summary: "OPENAI_API_KEY is not present. Suggestions and insights stay local and deterministic."
    };
}

export function createConfiguredTransactionSuggestionService() {
  return new TransactionSuggestionService(createConfiguredSuggestionAdapter());
}
