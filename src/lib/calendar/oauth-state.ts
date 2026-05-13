import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { GoogleCalendarConfigurationError } from "./config";

export const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = "ledger_google_calendar_oauth_state";
export const GOOGLE_CALENDAR_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

export interface GoogleCalendarOAuthState {
  cookieValue: string;
  state: string;
  userId: string;
}

function getStateSigningSecret() {
  const secret = process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY?.trim()
    || process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();

  if (!secret) {
    throw new GoogleCalendarConfigurationError("Missing Google Calendar OAuth state signing secret.");
  }

  return secret;
}

function signStatePayload(payload: string) {
  return createHmac("sha256", getStateSigningSecret()).update(payload).digest("base64url");
}

function encodeStatePayload(payload: { state: string; userId: string }) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeStatePayload(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const state = (parsed as { state?: unknown }).state;
    const userId = (parsed as { userId?: unknown }).userId;
    if (typeof state !== "string" || typeof userId !== "string") return null;
    if (!state || !userId) return null;

    return { state, userId };
  } catch {
    return null;
  }
}

export function createGoogleCalendarOAuthState(userId: string): GoogleCalendarOAuthState {
  const state = randomBytes(24).toString("base64url");
  const payload = encodeStatePayload({ state, userId });
  const signature = signStatePayload(payload);

  return {
    cookieValue: `${payload}.${signature}`,
    state,
    userId
  };
}

export function timingSafeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyGoogleCalendarOAuthState(state: string, cookieValue: string) {
  const [payload, signature, extra] = cookieValue.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!timingSafeEqualText(signature, signStatePayload(payload))) return null;

  const parsed = decodeStatePayload(payload);
  if (!parsed) return null;
  if (!timingSafeEqualText(state, parsed.state)) return null;

  return parsed;
}
