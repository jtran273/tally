import assert from "node:assert/strict";
import { buildUpcomingCalendarContext, type UpcomingCalendarContext } from "../src/lib/calendar";
import { assertAssistantContextSafe } from "../src/lib/agents";

const REQUIRED_PRODUCTION_ENV = [
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REDIRECT_URI",
  "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"
] as const;

const ALLOWED_CALENDAR_EVENT_FIELDS = new Set([
  "all_day",
  "end",
  "locationCity",
  "start",
  "suspected_category",
  "title"
]);

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function assertProductionCalendarEnv() {
  const missing = REQUIRED_PRODUCTION_ENV.filter((name) => !configured(name));
  if (missing.length > 0) {
    throw new Error(`Missing production Calendar env vars: ${missing.join(", ")}`);
  }

  const redirect = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  assert.ok(redirect, "GOOGLE_CALENDAR_REDIRECT_URI is required.");
  const parsed = new URL(redirect);
  assert.equal(parsed.protocol, "https:", "Production Google Calendar redirect URI must be HTTPS.");
  assert.equal(parsed.pathname, "/api/calendar/callback", "Google Calendar redirect URI must point to /api/calendar/callback.");
}

function assertOfflineCategorySmoke() {
  const now = new Date("2026-05-17T12:00:00.000Z");
  const context = buildUpcomingCalendarContext([
    {
      allDay: false,
      end: "2026-05-18T20:00:00.000Z",
      location: "LAX Terminal 5, Los Angeles, CA",
      start: "2026-05-18T18:00:00.000Z",
      title: "Flight to Seattle"
    },
    {
      allDay: false,
      end: "2026-05-19T03:00:00.000Z",
      location: "Bestia, Los Angeles, CA",
      start: "2026-05-19T01:30:00.000Z",
      title: "Dinner reservation"
    },
    {
      allDay: false,
      end: "2026-05-20T19:00:00.000Z",
      location: "South Coast Plaza, Costa Mesa, CA",
      start: "2026-05-20T18:00:00.000Z",
      title: "Buy graduation gift"
    },
    {
      allDay: true,
      end: "2026-05-24",
      location: "Venue, San Diego, CA",
      start: "2026-05-23",
      title: "Wedding"
    }
  ], { generatedAt: now.toISOString(), now });

  assert.equal(context.categories.travel, 1, "Expected travel category inference.");
  assert.equal(context.categories.dining, 1, "Expected dining category inference.");
  assert.equal(context.categories.gift, 1, "Expected gift category inference.");
  assert.equal(context.categories.wedding, 1, "Expected wedding category inference.");
  assertAssistantContextSafe(context);
}

function assertCalendarContextShape(calendarContext: UpcomingCalendarContext) {
  assertAssistantContextSafe(calendarContext);
  assert.ok(["ready", "not_configured", "error"].includes(calendarContext.status), "Unexpected calendarContext.status.");

  if (calendarContext.status !== "ready") {
    assert.equal(calendarContext.eventCount, 0, "Non-ready calendarContext must not include events.");
    assert.equal(calendarContext.events.length, 0, "Non-ready calendarContext must not include events.");
  }

  for (const event of calendarContext.events) {
    const fields = Object.keys(event).sort();
    assert.deepEqual(
      fields,
      [...ALLOWED_CALENDAR_EVENT_FIELDS].sort(),
      "Calendar event context contains fields outside the bounded assistant contract."
    );
  }
}

async function assertLiveSignalsIfConfigured() {
  const signalsUrl = process.env.OPENCLAW_SIGNALS_URL?.trim();
  const token = process.env.OPENCLAW_TOKEN?.trim();

  if (!signalsUrl || !token) {
    console.log("Live /api/openclaw/signals check skipped (set OPENCLAW_SIGNALS_URL and OPENCLAW_TOKEN to enable). No token value was printed.");
    return;
  }

  // Refuse to send the OpenClaw bearer over plaintext HTTP. Only allow
  // localhost over http for developer-local smoke runs.
  const parsedSignalsUrl = new URL(signalsUrl);
  const isLocalhost = parsedSignalsUrl.hostname === "localhost" || parsedSignalsUrl.hostname === "127.0.0.1";
  if (parsedSignalsUrl.protocol !== "https:" && !isLocalhost) {
    throw new Error("OPENCLAW_SIGNALS_URL must use https:// (or be a localhost URL) so the bearer token is not sent in plaintext.");
  }

  const response = await fetch(signalsUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });

  assert.equal(response.ok, true, `OpenClaw signals request failed with HTTP ${response.status}.`);
  const body = await response.json() as { calendarContext?: UpcomingCalendarContext };
  assert.ok(body.calendarContext, "OpenClaw signals response is missing calendarContext.");
  assertCalendarContextShape(body.calendarContext);
  console.log(`Live /api/openclaw/signals check passed: calendarContext.status=${body.calendarContext.status}, eventCount=${body.calendarContext.eventCount}.`);
}

async function main() {
  assertProductionCalendarEnv();
  assertOfflineCategorySmoke();
  await assertLiveSignalsIfConfigured();
  console.log("Google Calendar production smoke checks passed without printing secrets, raw events, attendee data, or descriptions.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
