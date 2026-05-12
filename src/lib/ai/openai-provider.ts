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
const OPENAI_PROVIDER_VERSION = "openai-suggestions-v2";
const OPENAI_REQUEST_TIMEOUT_MS = 25_000;
const MERCHANT_RULE_SHORT_CIRCUIT_CONFIDENCE = 0.85;

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

    // Token-saving short-circuit: if a saved merchant rule already produced a
    // high-confidence answer, the OpenAI call would only echo it. Skip it.
    if (
      baseline.category.source === "merchant-rule" &&
      baseline.confidence >= MERCHANT_RULE_SHORT_CIRCUIT_CONFIDENCE
    ) {
      return baseline;
    }

    try {
      return await suggestTransactionWithOpenAi({ apiKey, baseline, model, request });
    } catch (error) {
      console.warn(`openai_suggestion_failed model=${model}: ${sanitizeOpenAiError(error)}`);
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
  const isReasoningModel = /^(o\d|gpt-5)/i.test(model);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);

  const body: Record<string, unknown> = {
    input: [
      {
        content: [{ text: buildSystemPrompt(request), type: "input_text" }],
        role: "system"
      },
      {
        content: [{ text: buildUserPrompt(request, baseline), type: "input_text" }],
        role: "user"
      }
    ],
    max_output_tokens: isReasoningModel ? 4000 : 600,
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
          required: ["merchantName", "categoryName", "intent", "recurring", "confidence", "reason"],
          properties: {
            merchantName: { type: "string" },
            categoryName: { type: "string" },
            intent: { enum: ["business", "personal", "reimbursable", "shared", "transfer"], type: "string" },
            recurring: { type: "boolean" },
            confidence: { maximum: 1, minimum: 0, type: "number" },
            reason: { type: "string" }
          }
        }
      }
    }
  };

  if (isReasoningModel) {
    body.reasoning = { effort: "minimal" };
  }

  if (request.cacheKey) {
    body.prompt_cache_key = request.cacheKey;
  }

  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI suggestion request failed with ${response.status}: ${errorBody.slice(0, 200)}`);
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

function buildSystemPrompt(request: TransactionSuggestionRequest) {
  const categoryList = (request.categories ?? [])
    .map((category) => category.name)
    .filter((name) => name && name.toLowerCase() !== "uncategorized")
    .slice(0, 60);

  const merchantRules = (request.merchantRules ?? [])
    .filter((rule) => rule.enabled)
    .slice(0, 20)
    .map((rule) => {
      const parts = [
        `${rule.merchant_pattern} → ${rule.normalized_merchant_name ?? "(merchant)"}`,
        rule.intent ?? "(intent)"
      ];
      if (rule.is_recurring !== null) parts.push(rule.is_recurring ? "recurring" : "one-time");
      return `- ${parts.join(", ")}`;
    });

  const examples = (request.userCorrections ?? [])
    .slice(0, 15)
    .map((c) => {
      const recurring = c.recurring === true ? ", recurring" : c.recurring === false ? ", one-time" : "";
      return `- "${c.merchant}" → ${c.categoryName}, ${c.intent}${recurring}`;
    });

  const sections = [
    "You categorize personal bank transactions. Return ONE JSON object matching the schema.",
    "",
    "Rules:",
    "- Pick categoryName from the user's category list verbatim. If nothing fits, return 'Uncategorized'.",
    "- intent ∈ {personal, business, shared, reimbursable, transfer}. Default to personal unless evidence says otherwise.",
    "- merchantName: human-friendly normalization (e.g. 'AMZN MKTP US*ABC' → 'Amazon').",
    "- recurring: true only for clearly repeating subscriptions/bills.",
    "- confidence ∈ [0,1]. ≥0.85 = sure (auto-apply). 0.7–0.85 = likely. <0.7 = user should review.",
    "- reason: ONE short sentence (< 80 chars) citing the evidence you used.",
    "",
    `Available categories: ${categoryList.join(", ") || "Uncategorized"}`
  ];

  if (merchantRules.length > 0) {
    sections.push("", "Saved merchant rules (user's saved automations):", ...merchantRules);
  }

  if (examples.length > 0) {
    sections.push("", "User's recent label corrections (treat as ground truth for similar merchants):", ...examples);
  }

  return sections.join("\n");
}

function buildUserPrompt(request: TransactionSuggestionRequest, baseline: TransactionAiSuggestion) {
  const raw = request.rawTransaction;
  return [
    "Categorize this transaction:",
    `- name: ${raw.name}`,
    `- merchant: ${raw.merchant_name ?? "(none)"}`,
    `- amount: ${raw.amount} ${raw.iso_currency_code}`,
    `- channel: ${raw.payment_channel ?? "(unknown)"}`,
    `- plaid_category: ${raw.plaid_category ?? "(none)"}`,
    "",
    `Heuristic suggestion (use only if you have no better signal): ${baseline.category.value.name}, ${baseline.intent.value}, confidence ${baseline.confidence.toFixed(2)}.`
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
