import { assertAssistantContextSafe } from "@/lib/agents/assistant-contract";

const DAY_MS = 86_400_000;
const TITLE_LIMIT = 80;
const LOCATION_LIMIT = 48;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET_VALUE_PATTERN =
  /\bBearer\s+\S{12,}|\b(?:postgres|postgresql|mysql):\/\/[^ \n]+|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\b(?:access|public)-(?:sandbox|development|production)-[A-Za-z0-9_-]{12,}\b|\bservice[_-]?role[_-]?key\s*[:=]\s*\S{12,}/gi;
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)\S+|\b(?:meet\.google\.com|(?:[a-z0-9-]+\.)?zoom\.us|teams\.microsoft\.com)\/\S+/gi;
const REGION_NAMES = new Set([
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "district of columbia",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming",
  "usa",
  "united states",
  "united states of america"
]);
const REGION_ABBREVIATIONS = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY"
]);
const STREET_OR_UNIT_PATTERN =
  /\b(?:apt|apartment|ave|avenue|blvd|boulevard|building|bldg|court|ct|drive|dr|floor|fl|highway|hwy|lane|ln|parkway|pkwy|place|pl|road|rd|room|rm|square|sq|street|st|suite|ste|unit|way)\b/i;
const KNOWN_CITY_NAMES = new Set([
  "berkeley",
  "chandler",
  "chicago",
  "gilbert",
  "glendale",
  "honolulu",
  "las vegas",
  "los angeles",
  "mesa",
  "miami",
  "new york",
  "oakland",
  "palo alto",
  "peoria",
  "phoenix",
  "portland",
  "san diego",
  "san francisco",
  "san jose",
  "santa monica",
  "scottsdale",
  "seattle",
  "tempe",
  "washington"
]);

export type UpcomingCalendarStatus = "ready" | "not_configured" | "error";

export type UpcomingCalendarSuspectedCategory =
  | "birthday"
  | "delivery"
  | "dining"
  | "lodging"
  | "other"
  | "rideshare"
  | "travel"
  | "wedding";

export interface CalendarEventInput {
  allDay: boolean;
  end: string | null;
  location: string | null;
  start: string;
  title: string | null;
}

export interface UpcomingCalendarEventContext {
  all_day: boolean;
  end: string | null;
  locationCity: string | null;
  start: string;
  suspected_category: UpcomingCalendarSuspectedCategory;
  title: string;
}

export interface UpcomingCalendarContext {
  action: "read.upcoming_calendar_context";
  categories: Partial<Record<UpcomingCalendarSuspectedCategory, number>>;
  eventCount: number;
  events: UpcomingCalendarEventContext[];
  generatedAt: string;
  status: UpcomingCalendarStatus;
  window: {
    fromDate: string;
    toDate: string;
  };
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...` : value;
}

function cleanText(value: string) {
  return value
    .replace(URL_PATTERN, "")
    .replace(EMAIL_PATTERN, "[redacted]")
    .replace(SECRET_VALUE_PATTERN, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

export function safeCalendarTitle(value: string | null | undefined) {
  const cleaned = cleanText(value || "Busy");
  return truncate(cleaned && cleaned !== "[redacted]" ? cleaned : "Busy", TITLE_LIMIT);
}

function looksLikeRegion(value: string) {
  const cleaned = value.trim().replace(/\.$/, "");
  const withoutPostalCode = cleaned.replace(/\s+\d{5}(?:-\d{4})?$/, "");
  const normalized = cleaned.toLowerCase();
  return REGION_ABBREVIATIONS.has(withoutPostalCode.toUpperCase())
    || REGION_NAMES.has(normalized)
    || REGION_NAMES.has(withoutPostalCode.toLowerCase())
    || /^\d{5}(?:-\d{4})?$/.test(cleaned);
}

function safeCityCandidate(value: string | undefined) {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate) return null;
  if (candidate.includes("[redacted]")) return null;
  if (looksLikeRegion(candidate)) return null;
  if (/\d/.test(candidate)) return null;
  if (STREET_OR_UNIT_PATTERN.test(candidate)) return null;
  return truncate(candidate, LOCATION_LIMIT);
}

function isKnownCity(value: string | undefined) {
  return Boolean(value && KNOWN_CITY_NAMES.has(value.trim().toLowerCase()));
}

export function calendarLocationCity(value: string | null | undefined) {
  const cleaned = cleanText(value || "");
  if (!cleaned) return null;
  if (/\b(?:zoom|google meet|microsoft teams|facetime|online)\b/i.test(cleaned)) return null;

  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 1) return null;
  if (
    parts.length === 2
    && !looksLikeRegion(parts[1])
    && !/\d/.test(parts[0])
    && !STREET_OR_UNIT_PATTERN.test(parts[0])
  ) {
    return null;
  }

  let candidateIndex = parts.length - 1;
  while (candidateIndex > 0 && looksLikeRegion(parts[candidateIndex])) {
    candidateIndex -= 1;
  }

  if (candidateIndex === 0 && /\d/.test(parts[0])) return null;
  if (candidateIndex === 0 && parts.length > 1 && parts.slice(1).every(looksLikeRegion) && !isKnownCity(parts[0])) {
    return null;
  }
  return safeCityCandidate(parts[candidateIndex]);
}

export function categorizeCalendarEvent(
  title: string | null | undefined,
  location: string | null | undefined = null
): UpcomingCalendarSuspectedCategory {
  const haystack = `${title ?? ""} ${location ?? ""}`;

  if (/\bwedding|rehearsal dinner|bridal|groomsmen|bridesmaid\b/i.test(haystack)) return "wedding";
  if (/\bbirthday|bday\b/i.test(haystack)) return "birthday";
  if (/\bflight|airport|airline|tsa|trip|travel\b/i.test(haystack)) return "travel";
  if (/\bhotel|airbnb|lodging|check[- ]?in|checkout\b/i.test(haystack)) return "lodging";
  if (/\buber eats|doordash|reservation|dinner|lunch|brunch|restaurant|drinks\b/i.test(haystack)) return "dining";
  if (/\buber|lyft|rideshare|taxi\b/i.test(haystack)) return "rideshare";
  if (/\bdelivery|pickup order\b/i.test(haystack)) return "delivery";

  return "other";
}

function eventContext(event: CalendarEventInput): UpcomingCalendarEventContext {
  const title = safeCalendarTitle(event.title);
  const location = calendarLocationCity(event.location);

  return {
    all_day: event.allDay,
    end: event.end,
    locationCity: location,
    start: event.start,
    suspected_category: categorizeCalendarEvent(title, location),
    title
  };
}

function categoryCounts(events: readonly UpcomingCalendarEventContext[]) {
  return events.reduce<Partial<Record<UpcomingCalendarSuspectedCategory, number>>>((counts, event) => {
    counts[event.suspected_category] = (counts[event.suspected_category] ?? 0) + 1;
    return counts;
  }, {});
}

export function buildUpcomingCalendarContext(
  events: readonly CalendarEventInput[],
  options: {
    generatedAt?: string;
    now?: Date;
    status?: UpcomingCalendarStatus;
    windowDays?: number;
  } = {}
): UpcomingCalendarContext {
  const now = options.now ?? new Date();
  const generatedAt = options.generatedAt ?? now.toISOString();
  const fromDate = isoDate(now);
  const toDate = addDays(fromDate, options.windowDays ?? 14);
  const safeEvents = events
    .map(eventContext)
    .sort((left, right) => left.start.localeCompare(right.start));
  const context: UpcomingCalendarContext = {
    action: "read.upcoming_calendar_context",
    categories: categoryCounts(safeEvents),
    eventCount: safeEvents.length,
    events: safeEvents,
    generatedAt,
    status: options.status ?? "ready",
    window: { fromDate, toDate }
  };

  assertAssistantContextSafe(context);
  return context;
}

export function emptyUpcomingCalendarContext(
  options: {
    generatedAt?: string;
    now?: Date;
    status?: Exclude<UpcomingCalendarStatus, "ready">;
    windowDays?: number;
  } = {}
) {
  return buildUpcomingCalendarContext([], {
    ...options,
    status: options.status ?? "not_configured"
  });
}
