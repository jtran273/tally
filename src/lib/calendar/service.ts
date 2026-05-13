import type {
  FinanceSupabaseClient,
  GoogleCalendarConnectionRow,
  GoogleCalendarConnectionStatus
} from "@/lib/db";
import {
  buildUpcomingCalendarContext,
  emptyUpcomingCalendarContext,
  type CalendarEventInput,
  type UpcomingCalendarContext
} from "./context";
import {
  getGoogleCalendarConfig,
  GOOGLE_CALENDAR_READONLY_SCOPE
} from "./config";
import {
  decryptGoogleCalendarToken,
  encryptGoogleCalendarToken
} from "./token-vault";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3";
const DEFAULT_EVENT_LIMIT = 25;
const REFRESH_SKEW_MS = 120_000;
const CONNECTION_COLUMNS = [
  "id",
  "google_calendar_id",
  "calendar_summary",
  "status",
  "error_code",
  "error_message",
  "last_successful_sync_at",
  "created_at",
  "updated_at"
].join(",");

type CalendarFetch = typeof fetch;

export class GoogleCalendarApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GoogleCalendarApiError";
    this.status = status;
  }
}

export class GoogleCalendarScopeError extends Error {
  constructor() {
    super("Google Calendar OAuth response did not include the readonly calendar scope.");
    this.name = "GoogleCalendarScopeError";
  }
}

export interface GoogleCalendarTokenSet {
  accessToken: string;
  expiresAt: string;
  refreshToken: string | null;
  scope: string;
  tokenType: string;
}

export interface GoogleCalendarConnectionSummary {
  calendarSummary: string | null;
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  lastSuccessfulSyncAt: string | null;
  status: GoogleCalendarConnectionStatus;
  updatedAt: string;
}

interface GoogleCalendarServiceOptions {
  fetcher?: CalendarFetch;
  now?: Date;
}

interface GoogleEventDate {
  date?: string;
  dateTime?: string;
}

interface GoogleCalendarEvent {
  end?: GoogleEventDate;
  location?: string;
  start?: GoogleEventDate;
  status?: string;
  summary?: string;
}

interface GoogleCalendarEventsResponse {
  items?: GoogleCalendarEvent[];
}

function toConnectionSummary(row: Pick<
  GoogleCalendarConnectionRow,
  | "calendar_summary"
  | "created_at"
  | "error_code"
  | "error_message"
  | "id"
  | "last_successful_sync_at"
  | "status"
  | "updated_at"
>): GoogleCalendarConnectionSummary {
  return {
    calendarSummary: row.calendar_summary,
    createdAt: row.created_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    id: row.id,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    status: row.status,
    updatedAt: row.updated_at
  };
}

function expectData<T>(
  result: { data: T | null; error: { message: string } | null },
  context: string
): T {
  if (result.error || result.data === null) {
    throw new Error(`${context}: ${result.error?.message ?? "No data returned."}`);
  }

  return result.data;
}

function tokenExpiresAt(expiresIn: unknown, now: Date) {
  const seconds = typeof expiresIn === "number" && Number.isFinite(expiresIn) ? expiresIn : 3600;
  return new Date(now.getTime() + Math.max(0, seconds) * 1000).toISOString();
}

function hasReadonlyScope(scope: string) {
  return scope.split(/\s+/).includes(GOOGLE_CALENDAR_READONLY_SCOPE);
}

function assertReadonlyScope(scope: string) {
  if (!hasReadonlyScope(scope)) throw new GoogleCalendarScopeError();
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function tokenSetFromResponse(value: unknown, options: { now: Date; previousScope?: string }): GoogleCalendarTokenSet {
  if (!value || typeof value !== "object") {
    throw new GoogleCalendarApiError("Google Calendar token response was malformed.");
  }

  const record = value as Record<string, unknown>;
  const accessToken = stringValue(record.access_token);
  const refreshToken = stringValue(record.refresh_token);
  const scope = stringValue(record.scope) ?? options.previousScope;
  const tokenType = stringValue(record.token_type) ?? "Bearer";

  if (!accessToken || !scope) {
    throw new GoogleCalendarApiError("Google Calendar token response was incomplete.");
  }

  assertReadonlyScope(scope);

  return {
    accessToken,
    expiresAt: tokenExpiresAt(record.expires_in, options.now),
    refreshToken,
    scope,
    tokenType
  };
}

async function postTokenRequest(
  params: URLSearchParams,
  options: { fetcher?: CalendarFetch; now?: Date; previousScope?: string } = {}
) {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(GOOGLE_TOKEN_URL, {
    body: params,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST"
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new GoogleCalendarApiError("Google Calendar token request failed.", response.status);
  }

  return tokenSetFromResponse(body, {
    now: options.now ?? new Date(),
    previousScope: options.previousScope
  });
}

export function buildGoogleCalendarAuthUrl(state: string) {
  const config = getGoogleCalendarConfig();
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_READONLY_SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

export function exchangeGoogleCalendarCode(
  code: string,
  options: GoogleCalendarServiceOptions = {}
): Promise<GoogleCalendarTokenSet> {
  const config = getGoogleCalendarConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri
  });

  return postTokenRequest(params, options);
}

export function refreshGoogleCalendarAccessToken(
  refreshToken: string,
  options: GoogleCalendarServiceOptions & { previousScope: string }
): Promise<GoogleCalendarTokenSet> {
  const config = getGoogleCalendarConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  return postTokenRequest(params, options);
}

export async function upsertGoogleCalendarConnection(
  client: FinanceSupabaseClient,
  userId: string,
  tokens: GoogleCalendarTokenSet
) {
  if (!tokens.refreshToken) {
    throw new GoogleCalendarApiError("Google Calendar did not return an offline refresh token.");
  }

  const result = await client
    .from("google_calendar_connections")
    .upsert({
      access_token_ciphertext: encryptGoogleCalendarToken(tokens.accessToken),
      calendar_summary: "Primary calendar",
      error_code: null,
      error_message: null,
      expires_at: tokens.expiresAt,
      google_calendar_id: "primary",
      last_successful_sync_at: null,
      refresh_token_ciphertext: encryptGoogleCalendarToken(tokens.refreshToken),
      scope: tokens.scope,
      status: "active",
      token_type: tokens.tokenType,
      user_id: userId
    }, { onConflict: "user_id,google_calendar_id" })
    .select(CONNECTION_COLUMNS)
    .single();

  return toConnectionSummary(expectData(result, "Upsert Google Calendar connection"));
}

export async function listGoogleCalendarConnections(client: FinanceSupabaseClient, userId: string) {
  const result = await client
    .from("google_calendar_connections")
    .select(CONNECTION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return expectData(result, "List Google Calendar connections").map(toConnectionSummary);
}

export async function disconnectGoogleCalendarConnection(
  client: FinanceSupabaseClient,
  userId: string,
  connectionId: string
) {
  const revokedMarker = `revoked:${new Date().toISOString()}`;
  const result = await client
    .from("google_calendar_connections")
    .update({
      access_token_ciphertext: encryptGoogleCalendarToken(revokedMarker),
      error_code: null,
      error_message: null,
      refresh_token_ciphertext: encryptGoogleCalendarToken(revokedMarker),
      status: "revoked"
    })
    .eq("user_id", userId)
    .eq("id", connectionId)
    .select(CONNECTION_COLUMNS)
    .single();

  return toConnectionSummary(expectData(result, "Disconnect Google Calendar connection"));
}

async function loadActiveGoogleCalendarConnection(client: FinanceSupabaseClient, userId: string) {
  const result = await client
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "error"])
    .order("created_at", { ascending: false })
    .limit(1);

  const [row] = expectData(result, "Load Google Calendar connection");
  return row ?? null;
}

function needsRefresh(connection: GoogleCalendarConnectionRow, now: Date) {
  return Date.parse(connection.expires_at) <= now.getTime() + REFRESH_SKEW_MS;
}

async function updateConnectionToken(
  client: FinanceSupabaseClient,
  userId: string,
  connection: GoogleCalendarConnectionRow,
  tokens: GoogleCalendarTokenSet
) {
  const refreshToken = tokens.refreshToken
    ? encryptGoogleCalendarToken(tokens.refreshToken)
    : connection.refresh_token_ciphertext;

  const result = await client
    .from("google_calendar_connections")
    .update({
      access_token_ciphertext: encryptGoogleCalendarToken(tokens.accessToken),
      error_code: null,
      error_message: null,
      expires_at: tokens.expiresAt,
      refresh_token_ciphertext: refreshToken,
      scope: tokens.scope,
      status: "active",
      token_type: tokens.tokenType
    })
    .eq("user_id", userId)
    .eq("id", connection.id)
    .in("status", ["active", "error"])
    .select("*")
    .single();

  return expectData(result, "Refresh Google Calendar token");
}

export async function loadGoogleCalendarAccessToken(
  client: FinanceSupabaseClient,
  userId: string,
  connection: GoogleCalendarConnectionRow,
  options: GoogleCalendarServiceOptions = {}
) {
  const now = options.now ?? new Date();
  if (!needsRefresh(connection, now)) {
    return decryptGoogleCalendarToken(connection.access_token_ciphertext);
  }

  const tokens = await refreshGoogleCalendarAccessToken(
    decryptGoogleCalendarToken(connection.refresh_token_ciphertext),
    {
      fetcher: options.fetcher,
      now,
      previousScope: connection.scope
    }
  );
  const refreshed = await updateConnectionToken(client, userId, connection, tokens);
  return decryptGoogleCalendarToken(refreshed.access_token_ciphertext);
}

function eventDate(value: GoogleEventDate | undefined) {
  return value?.dateTime ?? value?.date ?? null;
}

export function parseGoogleCalendarEvents(value: unknown): CalendarEventInput[] {
  const body = value as GoogleCalendarEventsResponse;
  const items = Array.isArray(body?.items) ? body.items : [];

  return items
    .filter((item) => item?.status !== "cancelled")
    .map((item) => {
      const start = eventDate(item.start);
      if (!start) return null;

      return {
        allDay: Boolean(item.start?.date && !item.start.dateTime),
        end: eventDate(item.end),
        location: typeof item.location === "string" ? item.location : null,
        start,
        title: typeof item.summary === "string" ? item.summary : null
      } satisfies CalendarEventInput;
    })
    .filter((event): event is CalendarEventInput => event !== null);
}

export async function listGoogleCalendarEvents(
  accessToken: string,
  options: {
    fetcher?: CalendarFetch;
    maxResults?: number;
    timeMax: string;
    timeMin: string;
  }
) {
  const url = new URL(`${GOOGLE_CALENDAR_API_URL}/calendars/primary/events`);
  url.searchParams.set("maxResults", String(options.maxResults ?? DEFAULT_EVENT_LIMIT));
  url.searchParams.set("fields", "items(status,start,end,summary,location)");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("showDeleted", "false");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("timeMax", options.timeMax);
  url.searchParams.set("timeMin", options.timeMin);

  const response = await (options.fetcher ?? fetch)(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new GoogleCalendarApiError("Google Calendar events request failed.", response.status);
  }

  return parseGoogleCalendarEvents(body);
}

function calendarWindow(now: Date, days = 14) {
  return {
    timeMax: new Date(now.getTime() + days * 86_400_000).toISOString(),
    timeMin: now.toISOString()
  };
}

async function markCalendarConnectionRead(
  client: FinanceSupabaseClient,
  userId: string,
  connectionId: string,
  timestamp: string
) {
  await client
    .from("google_calendar_connections")
    .update({
      error_code: null,
      error_message: null,
      last_successful_sync_at: timestamp,
      status: "active"
    })
    .eq("user_id", userId)
    .eq("id", connectionId)
    .in("status", ["active", "error"]);
}

async function markCalendarConnectionError(
  client: FinanceSupabaseClient,
  userId: string,
  connectionId: string
) {
  await client
    .from("google_calendar_connections")
    .update({
      error_code: "CALENDAR_READ_FAILED",
      error_message: "Unable to read upcoming calendar events.",
      status: "error"
    })
    .eq("user_id", userId)
    .eq("id", connectionId)
    .in("status", ["active", "error"]);
}

export async function loadUpcomingCalendarContext(
  client: FinanceSupabaseClient,
  userId: string,
  options: GoogleCalendarServiceOptions & { generatedAt?: string } = {}
): Promise<UpcomingCalendarContext> {
  const now = options.now ?? new Date();
  const generatedAt = options.generatedAt ?? now.toISOString();
  let connection: GoogleCalendarConnectionRow | null;

  try {
    connection = await loadActiveGoogleCalendarConnection(client, userId);
  } catch {
    return emptyUpcomingCalendarContext({ generatedAt, now, status: "error" });
  }

  if (!connection) {
    return emptyUpcomingCalendarContext({ generatedAt, now });
  }

  try {
    const accessToken = await loadGoogleCalendarAccessToken(client, userId, connection, options);
    const window = calendarWindow(now);
    const events = await listGoogleCalendarEvents(accessToken, {
      fetcher: options.fetcher,
      timeMax: window.timeMax,
      timeMin: window.timeMin
    });

    await markCalendarConnectionRead(client, userId, connection.id, generatedAt);
    return buildUpcomingCalendarContext(events, { generatedAt, now });
  } catch {
    await markCalendarConnectionError(client, userId, connection.id);
    return emptyUpcomingCalendarContext({ generatedAt, now, status: "error" });
  }
}
