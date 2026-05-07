import { createMockSuggestionAdapter, suggestTransactionWithMockProvider } from "./mock-provider";
import type {
  AiSuggestionAdapter,
  AiSuggestionProviderDescriptor,
  CategorySuggestion,
  TransactionAiSuggestion,
  TransactionSuggestionRequest
} from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5-nano";
const OPENAI_PROVIDER_VERSION = "openai-suggestions-v1";

export const OPENAI_AI_SUGGESTION_PROVIDER: AiSuggestionProviderDescriptor = {
  id: "openai-transaction-review",
  kind: "openai",
  label: "OpenAI transaction review",
  version: OPENAI_PROVIDER_VERSION
};

interface OpenAiSuggestionAdapterOptions {
  apiKey?: string;
  model?: string;
  fallback?: AiSuggestionAdapter;
}

interface OpenAiSuggestionPayload {
  merchantName?: unknown;
  categoryName?: unknown;
  intent?: unknown;
  recurring?: unknown;
  confidence?: unknown;
  reason?: unknown;
  signals?: unknown;
}

interface OpenAiResponseBody {
  error?: {
    message?: unknown;
    type?: unknown;
  } | null;
  incomplete_details?: {
    reason?: unknown;
  } | null;
  output?: unknown;
  output_text?: unknown;
  status?: unknown;
}

type SupportedIntent = TransactionAiSuggestion["intent"]["value"];

const SUPPORTED_INTENTS = new Set<SupportedIntent>(["business", "personal", "reimbursable", "shared", "transfer"]);

function assertServerRuntime() {
  if (typeof window !== "undefined") {
    throw new Error("OpenAI suggestion provider can only run on the server.");
  }
}

function configuredApiKey(apiKey?: string) {
  return apiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || null;
}

export function getOpenAiSuggestionModel(model?: string) {
  return model?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function isOpenAiSuggestionConfigured(apiKey?: string) {
  assertServerRuntime();
  return Boolean(configuredApiKey(apiKey));
}

export function createOpenAiSuggestionAdapter(options: OpenAiSuggestionAdapterOptions = {}): AiSuggestionAdapter {
  assertServerRuntime();

  const apiKey = configuredApiKey(options.apiKey);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to create the OpenAI suggestion provider.");
  }

  const model = getOpenAiSuggestionModel(options.model);
  const fallback = options.fallback ?? createMockSuggestionAdapter();
  const suggestWithProvider = async (request: TransactionSuggestionRequest) => {
    const baseline = await fallback.suggestTransaction(request);

    try {
      return await suggestTransactionWithOpenAi({ apiKey, baseline, model, request });
    } catch (error) {
      console.warn("openai_suggestion_failed", {
        error: sanitizeOpenAiError(error),
        model
      });
      return baseline;
    }
  };

  return {
    descriptor: {
      ...OPENAI_AI_SUGGESTION_PROVIDER,
      version: `${OPENAI_PROVIDER_VERSION}:${model}`
    },
    suggestTransaction: suggestWithProvider,
    async suggestTransactions(requests) {
      return Promise.all(requests.map(suggestWithProvider));
    }
  };
}

async function suggestTransactionWithOpenAi({
  apiKey,
  baseline,
  model,
  request
}: {
  apiKey: string;
  baseline: TransactionAiSuggestion;
  model: string;
  request: TransactionSuggestionRequest;
}): Promise<TransactionAiSuggestion> {
  const payload = await callOpenAi({ apiKey, baseline, model, request });
  const category = coerceCategory(payload.categoryName, request, baseline.category.value);
  const intent = coerceIntent(payload.intent, baseline.intent.value);
  const confidence = coerceConfidence(payload.confidence, baseline.confidence);
  const merchantName = coerceString(payload.merchantName) ?? baseline.merchantCleanup.value.normalized;
  const reason = coerceString(payload.reason) ?? baseline.reason;
  const signals = coerceSignals(payload.signals, baseline.signals);
  const recurring = typeof payload.recurring === "boolean" ? payload.recurring : baseline.recurring?.value;

  return {
    ...baseline,
    suggestionId: `openai-${baseline.suggestionId}`,
    provider: {
      ...OPENAI_AI_SUGGESTION_PROVIDER,
      version: `${OPENAI_PROVIDER_VERSION}:${model}`
    },
    merchantCleanup: {
      value: {
        original: baseline.merchantCleanup.value.original,
        normalized: merchantName
      },
      confidence,
      source: "openai",
      reason
    },
    category: {
      value: category,
      confidence,
      source: "openai",
      reason
    },
    intent: {
      value: intent,
      confidence,
      source: "openai",
      reason
    },
    recurring: recurring === undefined
      ? undefined
      : {
        value: recurring,
        confidence,
        source: "openai",
        reason
      },
    confidence,
    reason,
    signals
  };
}

async function callOpenAi({
  apiKey,
  baseline,
  model,
  request
}: {
  apiKey: string;
  baseline: TransactionAiSuggestion;
  model: string;
  request: TransactionSuggestionRequest;
}): Promise<OpenAiSuggestionPayload> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    body: JSON.stringify({
      input: [
        {
          content: [
            {
              text: buildPrompt(request, baseline),
              type: "input_text"
            }
          ],
          role: "user"
        }
      ],
      max_output_tokens: 1200,
      model,
      text: {
        format: {
          type: "json_schema",
          name: "transaction_suggestion",
          description: "A concise transaction cleanup suggestion for a personal finance ledger.",
          strict: false,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["merchantName", "categoryName", "intent", "recurring", "confidence", "reason", "signals"],
            properties: {
              merchantName: { type: "string" },
              categoryName: { type: "string" },
              intent: { enum: ["business", "personal", "reimbursable", "shared", "transfer"], type: "string" },
              recurring: { type: "boolean" },
              confidence: { maximum: 1, minimum: 0, type: "number" },
              reason: { type: "string" },
              signals: {
                type: "array",
                items: { type: "string" },
                maxItems: 5
              }
            }
          }
        }
      }
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`OpenAI suggestion request failed with ${response.status}.`);
  }

  const data = await response.json() as OpenAiResponseBody;
  if (data.status && data.status !== "completed") {
    const reason = coerceString(data.incomplete_details?.reason) ?? coerceString(data.error?.message);
    throw new Error(`OpenAI suggestion response ended with status ${String(data.status)}${reason ? `: ${reason}` : ""}.`);
  }

  const outputText = typeof data.output_text === "string" ? data.output_text : extractOutputText(data);
  if (!outputText) {
    throw new Error("OpenAI suggestion response had no output text.");
  }

  const parsed = JSON.parse(outputText) as OpenAiSuggestionPayload;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function buildPrompt(request: TransactionSuggestionRequest, baseline: TransactionAiSuggestion) {
  const raw = request.rawTransaction;
  const categories = (request.categories ?? []).map((category) => category.name).slice(0, 80);
  const merchantRules = (request.merchantRules ?? []).filter((rule) => rule.enabled).map((rule) => ({
    merchantPattern: rule.merchant_pattern,
    normalizedMerchantName: rule.normalized_merchant_name,
    categoryId: rule.category_id,
    intent: rule.intent,
    recurring: rule.is_recurring,
    minAmount: rule.min_amount,
    maxAmount: rule.max_amount
  })).slice(0, 30);

  return [
    "Review this already-enriched Plaid transaction and return a concise JSON suggestion.",
    "Use only the transaction fields, category list, merchant rules, and deterministic baseline below.",
    "Do not invent vendors, accounts, or user intent. Prefer the baseline when evidence is weak.",
    "This suggestion is advisory only and will require explicit human acceptance before persistence.",
    JSON.stringify({
      rawTransaction: {
        id: raw.id,
        name: raw.name,
        merchant_name: raw.merchant_name,
        amount: raw.amount,
        iso_currency_code: raw.iso_currency_code,
        payment_channel: raw.payment_channel,
        plaid_category: raw.plaid_category,
        transaction_type: raw.transaction_type
      },
      availableCategories: categories,
      merchantRules,
      deterministicBaseline: {
        merchantName: baseline.merchantCleanup.value.normalized,
        categoryName: baseline.category.value.name,
        intent: baseline.intent.value,
        recurring: baseline.recurring?.value,
        confidence: baseline.confidence,
        reason: baseline.reason,
        signals: baseline.signals
      }
    })
  ].join("\n");
}

function extractOutputText(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const output = (data as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;

  const texts = output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    });
  });

  return texts.join("").trim() || null;
}

function coerceString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coerceCategory(
  value: unknown,
  request: TransactionSuggestionRequest,
  fallback: CategorySuggestion
): CategorySuggestion {
  const categoryName = coerceString(value);
  if (!categoryName) return fallback;

  const category = request.categories?.find((candidate) =>
    candidate.name.toLowerCase() === categoryName.toLowerCase()
  );

  return {
    id: category?.id ?? fallback.id,
    name: category?.name ?? categoryName
  };
}

function coerceIntent(value: unknown, fallback: SupportedIntent): SupportedIntent {
  return typeof value === "string" && SUPPORTED_INTENTS.has(value as SupportedIntent)
    ? value as SupportedIntent
    : fallback;
}

function coerceConfidence(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(0.98, Math.max(0, value))
    : Math.min(0.9, fallback);
}

function coerceSignals(value: unknown, fallback: readonly string[]) {
  if (!Array.isArray(value)) return [...fallback];

  const signals = value
    .filter((signal): signal is string => typeof signal === "string" && signal.trim().length > 0)
    .map((signal) => signal.trim())
    .slice(0, 5);

  return signals.length > 0 ? signals : [...fallback];
}

function sanitizeOpenAiError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 240);
  if (typeof error === "string") return error.slice(0, 240);
  return "Unknown OpenAI suggestion error";
}

export function createConfiguredSuggestionAdapter(): AiSuggestionAdapter {
  assertServerRuntime();
  return isOpenAiSuggestionConfigured()
    ? createOpenAiSuggestionAdapter()
    : createMockSuggestionAdapter();
}

export function suggestTransactionWithConfiguredProvider(request: TransactionSuggestionRequest) {
  assertServerRuntime();
  return isOpenAiSuggestionConfigured()
    ? createOpenAiSuggestionAdapter().suggestTransaction(request)
    : Promise.resolve(suggestTransactionWithMockProvider(request));
}
