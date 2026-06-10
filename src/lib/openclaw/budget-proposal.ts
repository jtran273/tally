import { PLANNED_SPEND_CALENDAR_CATEGORIES } from "@/lib/calendar";
import type { UpcomingCalendarSuspectedCategory } from "@/lib/calendar/context";
import type { Json } from "@/lib/db";

/**
 * Parses a pending `monthly_budget_proposal` agent proposal into bounded,
 * outbox-safe copy inputs. The proposal generator does not exist yet, so this
 * parser is intentionally tolerant of missing fields and defensive about
 * anything string-shaped: only sanitized category labels, rounded amounts,
 * capped uncertainty notes, and allowlisted calendar pressure summaries
 * survive. Raw events, descriptions, attendees, and provider payloads never do.
 */

export const MAX_BUDGET_PROPOSAL_CATEGORIES = 6;
export const MAX_BUDGET_PROPOSAL_NOTES = 2;

const MAX_CATEGORY_LABEL_LENGTH = 32;
const MAX_NOTE_LENGTH = 120;
const MAX_CATEGORY_AMOUNT = 1_000_000;

const PLANNED_SPEND_CATEGORY_SET = new Set<string>(PLANNED_SPEND_CALENDAR_CATEGORIES);

export interface SanitizedBudgetProposalCategory {
  amount: number;
  label: string;
}

export interface SanitizedBudgetProposalCalendarPressure {
  categories: UpcomingCalendarSuspectedCategory[];
  level: "moderate" | "high";
}

export interface SanitizedMonthlyBudgetProposal {
  calendarPressure: SanitizedBudgetProposalCalendarPressure | null;
  categories: SanitizedBudgetProposalCategory[];
  categoryCount: number;
  monthKey: string | null;
  monthLabel: string | null;
  totalAmount: number;
  uncertaintyNotes: string[];
}

function jsonObject(value: Json | undefined): Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function jsonArray(value: Json | undefined): readonly Json[] {
  return Array.isArray(value) ? value : [];
}

// Token-, key-, and identifier-shaped strings never belong in outbox copy,
// even if a buggy generator put them in evidence.
function looksSensitive(value: string) {
  return /\bsk-|\b(?:access|public)-(?:sandbox|development|production)-|\bbearer\s|\b(?:postgres|postgresql|mysql):\/\/|service[_-]?role|\d{3}-\d{2}-\d{4}|@|https?:\/\/|[A-Za-z0-9_-]{24,}/i.test(value);
}

function compactText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function sanitizeCategoryLabel(value: Json | undefined): string | null {
  if (typeof value !== "string") return null;
  if (looksSensitive(value)) return null;
  const cleaned = value.replace(/[^A-Za-z0-9 &'/-]/g, " ").trim().replace(/\s+/g, " ");
  if (!/[A-Za-z]/.test(cleaned)) return null;
  return compactText(cleaned, MAX_CATEGORY_LABEL_LENGTH);
}

function sanitizeAmount(value: Json | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(Math.abs(value));
  if (rounded <= 0 || rounded > MAX_CATEGORY_AMOUNT) return null;
  return rounded;
}

function sanitizeMonthKey(value: Json | undefined): string | null {
  if (typeof value !== "string") return null;
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.trim()) ? value.trim() : null;
}

function monthLabelFromKey(monthKey: string | null): string | null {
  if (!monthKey) return null;
  return new Date(`${monthKey}-15T12:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  });
}

function sanitizeCategories(value: Json | undefined): SanitizedBudgetProposalCategory[] {
  const seen = new Set<string>();
  const categories: SanitizedBudgetProposalCategory[] = [];

  for (const entry of jsonArray(value)) {
    const record = jsonObject(entry);
    const label = sanitizeCategoryLabel(record.label ?? record.category);
    const amount = sanitizeAmount(record.amount);
    if (!label || amount === null) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push({ amount, label });
  }

  return categories.sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label));
}

function sanitizeUncertaintyNotes(value: Json | undefined): string[] {
  return jsonArray(value)
    .filter((note): note is string => typeof note === "string" && note.trim().length > 0)
    .filter((note) => !looksSensitive(note))
    .slice(0, MAX_BUDGET_PROPOSAL_NOTES)
    .map((note) => compactText(note, MAX_NOTE_LENGTH));
}

function sanitizeCalendarPressure(value: Json | undefined): SanitizedBudgetProposalCalendarPressure | null {
  const record = jsonObject(value);
  const level = record.level;
  if (level !== "moderate" && level !== "high") return null;

  const categories = jsonArray(record.categories)
    .filter((category): category is UpcomingCalendarSuspectedCategory =>
      typeof category === "string" && PLANNED_SPEND_CATEGORY_SET.has(category)
    )
    .slice(0, 2);
  if (categories.length === 0) return null;

  return { categories, level };
}

export function parseMonthlyBudgetProposal(
  evidence: Json,
  proposedPatch: Json
): SanitizedMonthlyBudgetProposal | null {
  const patch = jsonObject(proposedPatch);
  const evidenceRecord = jsonObject(evidence);

  const categories = sanitizeCategories(patch.categories);
  const summedTotal = categories.reduce((sum, category) => sum + category.amount, 0);
  const totalAmount = sanitizeAmount(patch.totalAmount) ?? summedTotal;
  if (categories.length === 0 || totalAmount <= 0) return null;

  const monthKey = sanitizeMonthKey(patch.month ?? patch.monthKey);

  return {
    calendarPressure: sanitizeCalendarPressure(evidenceRecord.calendarPressure),
    categories: categories.slice(0, MAX_BUDGET_PROPOSAL_CATEGORIES),
    categoryCount: categories.length,
    monthKey,
    monthLabel: monthLabelFromKey(monthKey),
    totalAmount,
    uncertaintyNotes: sanitizeUncertaintyNotes(evidenceRecord.uncertaintyNotes)
  };
}
