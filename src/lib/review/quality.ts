import type { Json, MerchantRuleRow, ReviewItemRecord, ReviewReason, ReviewResolutionKind } from "@/lib/db";

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

export type ReviewQualityBucket = "accepted" | "dismissed" | "edited";

type ResolvedReview = Pick<ReviewItemRecord, "status" | "resolutionKind" | "resolutionNote">;

const RESOLUTION_KIND_BUCKETS: Record<ReviewResolutionKind, ReviewQualityBucket> = {
  accepted_ai: "accepted",
  accepted_manual: "accepted",
  auto_resolved: "accepted",
  edited: "edited",
  dismissed: "dismissed"
};

// Legacy rows resolved before `resolution_kind` existed only carry note copy.
// The backfill migration covers stored rows, so this is a defensive fallback
// for in-memory records that have not been re-read from the database.
function legacyBucket(review: ResolvedReview): ReviewQualityBucket {
  if (review.status === "dismissed") return "dismissed";
  const note = (review.resolutionNote ?? "").toLowerCase();
  if (note.includes("edit")) return "edited";
  return "accepted";
}

export function reviewResolutionBucket(review: ResolvedReview): ReviewQualityBucket | null {
  if (review.status !== "resolved" && review.status !== "dismissed") return null;
  if (review.resolutionKind) return RESOLUTION_KIND_BUCKETS[review.resolutionKind];
  return legacyBucket(review);
}

export function isResolvedAccept(review: ResolvedReview): boolean {
  return reviewResolutionBucket(review) === "accepted";
}

export function isResolvedEdit(review: ResolvedReview): boolean {
  return reviewResolutionBucket(review) === "edited";
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

    if (review.status === "open") {
      openCount += 1;
      continue;
    }

    const bucket = reviewResolutionBucket(review);
    if (!bucket) continue;

    if (bucket === "dismissed") dismissedCount += 1;
    else if (bucket === "edited") editedCount += 1;
    else acceptedCount += 1;

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
