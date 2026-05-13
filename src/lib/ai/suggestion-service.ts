import type { TransactionEnrichmentPatch } from "../db/queries";
import { createMockSuggestionAdapter } from "./mock-provider";
import type {
  AiSuggestionAdapter,
  ReimbursementCandidateAiRequest,
  ReimbursementCandidateAiSuggestion,
  TransactionAiSuggestion,
  TransactionSuggestionRequest
} from "./types";

export type AcceptedSuggestionField = "merchantName" | "category" | "intent" | "recurring" | "confidence";

export interface AcceptedSuggestionPatchOptions {
  include?: readonly AcceptedSuggestionField[];
  note?: string;
  reviewedAt?: string | null;
}

const DEFAULT_ACCEPTED_FIELDS: readonly AcceptedSuggestionField[] = [
  "merchantName",
  "category",
  "intent",
  "recurring",
  "confidence"
];

export class TransactionSuggestionService {
  constructor(readonly adapter: AiSuggestionAdapter = createMockSuggestionAdapter()) {}

  suggestTransaction(request: TransactionSuggestionRequest): Promise<TransactionAiSuggestion> {
    return this.adapter.suggestTransaction(request);
  }

  suggestTransactions(requests: readonly TransactionSuggestionRequest[]): Promise<TransactionAiSuggestion[]> {
    if (this.adapter.suggestTransactions) {
      return this.adapter.suggestTransactions(requests);
    }

    return Promise.all(requests.map((request) => this.adapter.suggestTransaction(request)));
  }

  suggestReimbursementCandidate(request: ReimbursementCandidateAiRequest): Promise<ReimbursementCandidateAiSuggestion> {
    if (this.adapter.suggestReimbursementCandidate) {
      return this.adapter.suggestReimbursementCandidate(request);
    }

    return createMockSuggestionAdapter().suggestReimbursementCandidate!(request);
  }
}

export function createTransactionSuggestionService(adapter?: AiSuggestionAdapter) {
  return new TransactionSuggestionService(adapter);
}

export function buildUserAcceptedEnrichmentPatch(
  suggestion: TransactionAiSuggestion,
  options: AcceptedSuggestionPatchOptions = {}
): TransactionEnrichmentPatch {
  const include = new Set<AcceptedSuggestionField>(options.include ?? DEFAULT_ACCEPTED_FIELDS);
  const patch: TransactionEnrichmentPatch = {};

  if (include.has("merchantName")) {
    patch.merchantName = suggestion.merchantCleanup.value.normalized;
  }
  if (include.has("category")) {
    patch.categoryId = suggestion.category.value.id;
    patch.categoryName = suggestion.category.value.name;
  }
  if (include.has("intent")) {
    patch.intent = suggestion.intent.value;
  }
  if (include.has("recurring") && suggestion.recurring) {
    patch.isRecurring = suggestion.recurring.value;
  }
  if (include.has("confidence")) {
    patch.confidence = suggestion.confidence;
  }
  if (options.note !== undefined) {
    patch.note = options.note;
  }
  if (options.reviewedAt !== undefined) {
    patch.reviewedAt = options.reviewedAt;
  }

  return patch;
}
