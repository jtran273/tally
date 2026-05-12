import { TransactionSuggestionService } from "./suggestion-service";
import {
  createConfiguredSuggestionAdapter,
  getOpenAiSuggestionModel,
  isOpenAiSuggestionConfigured
} from "./openai-provider";
import { createMockSuggestionAdapter } from "./mock-provider";
import type { AiSuggestionProviderKind } from "./types";

export interface AiProviderStatus {
  activeKind: AiSuggestionProviderKind;
  autoReviewEnabled: boolean;
  configured: boolean;
  label: string;
  model: string | null;
  summary: string;
}

function enabledEnvFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function isOpenAiAutoReviewEnabled() {
  return enabledEnvFlag(process.env.ENABLE_OPENAI_AUTO_REVIEW);
}

export function getAiProviderStatus(): AiProviderStatus {
  const configured = isOpenAiSuggestionConfigured();
  const model = configured ? getOpenAiSuggestionModel() : null;
  const autoReviewEnabled = configured && isOpenAiAutoReviewEnabled();

  return configured
    ? {
      activeKind: "openai",
      autoReviewEnabled,
      configured,
      label: "OpenAI optional provider",
      model,
      summary: autoReviewEnabled
        ? "OPENAI_API_KEY is present and automatic review cleanup is enabled. AI suggestions remain advisory, with deterministic fallback on errors."
        : "OPENAI_API_KEY is present. Automatic review cleanup is off to save tokens; generate AI suggestions manually from review items when useful."
    }
    : {
      activeKind: "mock",
      autoReviewEnabled: false,
      configured,
      label: "Deterministic Plaid-only fallback",
      model,
      summary: "OPENAI_API_KEY is not present. Suggestions and insights stay local and deterministic."
    };
}

export function createConfiguredTransactionSuggestionService() {
  return new TransactionSuggestionService(createConfiguredSuggestionAdapter());
}

export function createAutoReviewTransactionSuggestionService() {
  return new TransactionSuggestionService(
    isOpenAiAutoReviewEnabled()
      ? createConfiguredSuggestionAdapter()
      : createMockSuggestionAdapter()
  );
}
