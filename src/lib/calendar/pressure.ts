import type { UpcomingCalendarContext, UpcomingCalendarSuspectedCategory } from "./context";

export type CalendarPressureLevel = "high" | "light" | "moderate" | "none";

/**
 * Suspected calendar categories that imply likely planned or upcoming spend.
 * "other" is intentionally excluded so generic meetings never create finance pressure.
 */
export const PLANNED_SPEND_CALENDAR_CATEGORIES = [
  "travel",
  "lodging",
  "dining",
  "gift",
  "birthday",
  "wedding",
  "rideshare",
  "delivery"
] as const satisfies readonly UpcomingCalendarSuspectedCategory[];

export interface CalendarPressureCategoryCount {
  category: UpcomingCalendarSuspectedCategory;
  count: number;
}

export interface CalendarPressureSummary {
  busyDayCount: number;
  eventCount: number;
  level: CalendarPressureLevel;
  plannedSpendEventCount: number;
  topPlannedSpendCategories: CalendarPressureCategoryCount[];
}

const CATEGORY_PHRASE: Record<UpcomingCalendarSuspectedCategory, string> = {
  birthday: "birthdays",
  delivery: "deliveries",
  dining: "dining",
  gift: "gifts",
  lodging: "lodging",
  other: "other plans",
  rideshare: "rideshares",
  travel: "travel",
  wedding: "weddings"
};

/**
 * Bounded pressure level derived only from event counts and suspected categories.
 * Returns "none" for any non-ready calendar so disconnected/error states never warn.
 */
export function calendarPressureLevel(calendar: UpcomingCalendarContext): CalendarPressureLevel {
  const eventCount = calendar.eventCount;
  if (calendar.status !== "ready" || eventCount === 0) return "none";

  const travelPressure = (calendar.categories.travel ?? 0) + (calendar.categories.lodging ?? 0);
  if (eventCount >= 8 || travelPressure >= 2) return "high";
  if (eventCount >= 4 || travelPressure >= 1) return "moderate";
  return "light";
}

/**
 * Summarize calendar pressure using only category counts and bounded day/event totals.
 * Never includes event titles, locations, or timing details, so the summary is safe to
 * fold into finance-facing copy.
 */
export function summarizeCalendarPressure(calendar: UpcomingCalendarContext): CalendarPressureSummary {
  const ready = calendar.status === "ready";
  const busyDays = ready ? new Set(calendar.events.map((event) => event.start.slice(0, 10))) : new Set<string>();
  const topPlannedSpendCategories = ready
    ? PLANNED_SPEND_CALENDAR_CATEGORIES
        .map((category) => ({ category, count: calendar.categories[category] ?? 0 }))
        .filter((entry) => entry.count > 0)
        .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category))
    : [];
  const plannedSpendEventCount = topPlannedSpendCategories.reduce((total, entry) => total + entry.count, 0);

  return {
    busyDayCount: busyDays.size,
    eventCount: ready ? calendar.eventCount : 0,
    level: calendarPressureLevel(calendar),
    plannedSpendEventCount,
    topPlannedSpendCategories
  };
}

/**
 * Human phrase for the top planned-spend categories, e.g. "travel and dining" or
 * "travel, dining, and gifts". Uses category labels only, never event details.
 */
export function calendarPressureCategoryPhrase(
  categories: readonly CalendarPressureCategoryCount[],
  limit = 3
): string | null {
  const words = categories.slice(0, limit).map((entry) => CATEGORY_PHRASE[entry.category]);
  if (words.length === 0) return null;
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}
