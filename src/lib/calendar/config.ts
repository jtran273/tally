export const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly" as const;

export class GoogleCalendarConfigurationError extends Error {
  constructor(message = "Google Calendar is not configured.") {
    super(message);
    this.name = "GoogleCalendarConfigurationError";
  }
}

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function buildRedirectUriFromAppUrl(appUrl: string) {
  try {
    return new URL("/api/calendar/callback", appUrl).toString();
  } catch {
    throw new GoogleCalendarConfigurationError("Google Calendar app URL is invalid.");
  }
}

function defaultRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) {
    throw new GoogleCalendarConfigurationError("NEXT_PUBLIC_APP_URL is required for Google Calendar OAuth.");
  }

  return buildRedirectUriFromAppUrl(appUrl);
}

function assertRedirectUriAllowed(value: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new GoogleCalendarConfigurationError("Google Calendar redirect URI is invalid.");
  }

  if (parsed.protocol === "https:") return;
  if (!isProductionRuntime() && parsed.protocol === "http:" && LOCALHOST_NAMES.has(parsed.hostname)) return;

  throw new GoogleCalendarConfigurationError("Google Calendar redirect URI must use HTTPS in production.");
}

export function getGoogleCalendarConfig(): GoogleCalendarConfig {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() || defaultRedirectUri();

  if (!clientId || !clientSecret) {
    throw new GoogleCalendarConfigurationError("Missing Google Calendar OAuth environment variables.");
  }

  assertRedirectUriAllowed(redirectUri);
  return { clientId, clientSecret, redirectUri };
}
