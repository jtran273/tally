import type { Json, MerchantRuleRow, ReviewItemRecord, ReviewReason } from "@/lib/db";

export interface AiQualityGroupCount {
  label: string;
  accepted: number;
  dismissed: number;
  edited: number;
  total: number;
}

export interface AiSuggestionQualitySummary {
  totalReviewedWithSuggestion: number;
  acceptedCount: number;
  dismissedCount: number;
  editedCount: number;
  openCount: number;
  acceptanceRate: number;
  byReason: AiQualityGroupCount[];
  byCategory: AiQualityGroupCount[];
  byMerchant: AiQualityGroupCount[];
  estimatedReviewsAvoided: number;
  aiDerivedRuleCount: number;
}

interface ReviewItemContext {
  review: ReviewItemRecord;
  merchant?: string | null;
  category?: string | null;
}

function isJsonObject(value: Json | null | undefined): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasAiSuggestion(value: Json | null | undefined): boolean {
  if (!isJsonObject(value)) return false;
  return Object.values(value).some((field) => field !== null && field !== undefined && field !== "");
}

export function isResolvedAccept(review: Pick<ReviewItemRecord, "status" | "resolutionNote">): boolean {
  if (review.status !== "resolved") return false;
  const note = (review.resolutionNote ?? "").toLowerCase();
  if (!note) return true;
  if (note.includes("edit")) return false;
  return true;
}

export function isResolvedEdit(review: Pick<ReviewItemRecord, "status" | "resolutionNote">): boolean {
  if (review.status !== "resolved") return false;
  const note = (review.resolutionNote ?? "").toLowerCase();
  return note.includes("edit");
}

const REASON_LABELS: Record<ReviewReason, string> = {
  "low-confidence": "Low confidence",
  "missing-category": "Missing category",
  "recurring-candidate": "Recurring candidate",
  large: "Large amount",
  "new-recurring": "New recurring",
  venmo: "Peer-to-peer",
  "transfer-pair": "Transfer pair",
  "unclear-transfer": "Unclear transfer"
};

function reasonLabel(reason: ReviewReason): string {
  return REASON_LABELS[reason] ?? reason;
}

function bumpGroup(map: Map<string, AiQualityGroupCount>, label: string, bucket: "accepted" | "dismissed" | "edited") {
  const current = map.get(label) ?? { label, accepted: 0, dismissed: 0, edited: 0, total: 0 };
  current[bucket] += 1;
  current.total += 1;
  map.set(label, current);
}

function topGroups(map: Map<string, AiQualityGroupCount>, limit: number): AiQualityGroupCount[] {
  return [...map.values()].sort((left, right) => right.total - left.total).slice(0, limit);
}

function isAiDerivedRule(rule: MerchantRuleRow): boolean {
  const notes = (rule.notes ?? "").toLowerCase();
  if (!notes) return false;
  return notes.includes("ai") || notes.includes("suggestion") || notes.includes("auto");
}

function normalizeMerchant(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function summarizeAiReviewQuality(input: {
  reviews: readonly ReviewItemContext[];
  merchantRules: readonly MerchantRuleRow[];
  enrichedMerchantCounts: ReadonlyMap<string, number>;
}): AiSuggestionQualitySummary {
  const byReason = new Map<string, AiQualityGroupCount>();
  const byCategory = new Map<string, AiQualityGroupCount>();
  const byMerchant = new Map<string, AiQualityGroupCount>();

  let acceptedCount = 0;
  let dismissedCount = 0;
  let editedCount = 0;
  let openCount = 0;
  let total = 0;

  for (const { review, merchant, category } of input.reviews) {
    if (!hasAiSuggestion(review.aiSuggestion)) continue;

    let bucket: "accepted" | "dismissed" | "edited" | null = null;
    if (review.status === "dismissed") {
      bucket = "dismissed";
      dismissedCount += 1;
    } else if (isResolvedEdit(review)) {
      bucket = "edited";
      editedCount += 1;
    } else if (isResolvedAccept(review)) {
      bucket = "accepted";
      acceptedCount += 1;
    } else if (review.status === "open") {
      openCount += 1;
      continue;
    } else {
      continue;
    }

    total += 1;
    bumpGroup(byReason, reasonLabel(review.reason), bucket);
    if (category) bumpGroup(byCategory, category, bucket);
    if (merchant) bumpGroup(byMerchant, merchant, bucket);
  }

  const aiDerivedRules = input.merchantRules.filter(isAiDerivedRule);
  let estimatedReviewsAvoided = 0;
  for (const rule of aiDerivedRules) {
    const key = normalizeMerchant(rule.normalized_merchant_name ?? rule.merchant_pattern);
    const matches = input.enrichedMerchantCounts.get(key) ?? 0;
    if (matches > 1) estimatedReviewsAvoided += matches - 1;
  }

  return {
    totalReviewedWithSuggestion: total,
    acceptedCount,
    dismissedCount,
    editedCount,
    openCount,
    acceptanceRate: total === 0 ? 0 : acceptedCount / total,
    byReason: topGroups(byReason, 5),
    byCategory: topGroups(byCategory, 5),
    byMerchant: topGroups(byMerchant, 5),
    estimatedReviewsAvoided,
    aiDerivedRuleCount: aiDerivedRules.length
  };
}

export function buildEnrichedMerchantCounts(
  enriched: ReadonlyArray<{ merchant_name: string | null }>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of enriched) {
    const key = normalizeMerchant(row.merchant_name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
