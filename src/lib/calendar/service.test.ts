import assert from "node:assert/strict";
import test from "node:test";
import type { FinanceSupabaseClient, GoogleCalendarConnectionRow } from "@/lib/db";
import {
  buildGoogleCalendarAuthUrl,
  exchangeGoogleCalendarCode,
  GoogleCalendarScopeError,
  loadGoogleCalendarAccessToken,
  loadUpcomingCalendarContext,
  listGoogleCalendarEvents,
  parseGoogleCalendarEvents,
  refreshGoogleCalendarAccessToken
} from "./service";
import { getGoogleCalendarConfig, GOOGLE_CALENDAR_READONLY_SCOPE } from "./config";
import { encryptGoogleCalendarToken } from "./token-vault";

async function withCalendarEnv<T>(env: Record<string, string | undefined>, run: () => T | Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();

  Object.entries(env).forEach(([key, value]) => {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  try {
    return await run();
  } finally {
    previous.forEach((value, key) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

function responseJson(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  }));
}

interface CalendarUpdateCall {
  inFilters: Array<{ column: string; values: readonly unknown[] }>;
  payload: Record<string, unknown>;
}

function createCalendarConnectionClient(
  connection: GoogleCalendarConnectionRow,
  updates: CalendarUpdateCall[]
): FinanceSupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, "google_calendar_connections");

      const inFilters: CalendarUpdateCall["inFilters"] = [];
      let payload: Record<string, unknown> | null = null;
      let single = false;

      const builder = {
        eq() {
          return builder;
        },
        in(column: string, values: readonly unknown[]) {
          inFilters.push({ column, values });
          return builder;
        },
        limit() {
          return builder;
        },
        order() {
          return builder;
        },
        select() {
          return builder;
        },
        single() {
          single = true;
          return builder;
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          const data = payload
            ? (single ? { ...connection, ...payload } : [])
            : (single ? connection : [connection]);

          if (payload) updates.push({ inFilters, payload });
          return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
        },
        update(value: Record<string, unknown>) {
          payload = value;
          return builder;
        }
      };

      return builder;
    }
  } as unknown as FinanceSupabaseClient;
}

const calendarEnv = {
  GOOGLE_CALENDAR_CLIENT_ID: "calendar-client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-secret",
  GOOGLE_CALENDAR_REDIRECT_URI: undefined,
  GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: "calendar-token-key",
  NEXT_PUBLIC_APP_URL: "https://ledger.example.test",
  VERCEL_URL: undefined
};

function calendarConnection(input: Partial<GoogleCalendarConnectionRow> = {}): GoogleCalendarConnectionRow {
  return {
    access_token_ciphertext: encryptGoogleCalendarToken("access-current"),
    calendar_summary: "Primary calendar",
    created_at: "2026-05-13T11:00:00.000Z",
    error_code: null,
    error_message: null,
    expires_at: "2026-05-13T12:30:00.000Z",
    google_calendar_id: "primary",
    id: "calendar-connection-1",
    last_successful_sync_at: null,
    refresh_token_ciphertext: encryptGoogleCalendarToken("refresh-current"),
    scope: GOOGLE_CALENDAR_READONLY_SCOPE,
    status: "active",
    token_type: "Bearer",
    updated_at: "2026-05-13T11:00:00.000Z",
    user_id: "user-1",
    ...input
  };
}

test("Google Calendar config does not fall back to ephemeral Vercel URLs", async () => {
  await withCalendarEnv({
    GOOGLE_CALENDAR_CLIENT_ID: "calendar-client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-secret",
    GOOGLE_CALENDAR_REDIRECT_URI: undefined,
    NEXT_PUBLIC_APP_URL: undefined,
    VERCEL_URL: "preview-random.vercel.app"
  }, () => {
    assert.throws(() => getGoogleCalendarConfig(), /NEXT_PUBLIC_APP_URL/);
  });
});

test("Google Calendar auth URL requests readonly offline access only", async () => {
  await withCalendarEnv(calendarEnv, () => {
    const url = new URL(buildGoogleCalendarAuthUrl("state-123"));

    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("scope"), GOOGLE_CALENDAR_READONLY_SCOPE);
    assert.equal(url.searchParams.get("state"), "state-123");
    assert.equal(url.searchParams.get("redirect_uri"), "https://ledger.example.test/api/calendar/callback");
  });
});

test("Google Calendar token exchange and refresh enforce readonly scope", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const exchangeCalls: URLSearchParams[] = [];
    const exchangeFetcher: typeof fetch = async (_input, init) => {
      exchangeCalls.push(init?.body as URLSearchParams);
      return responseJson({
        access_token: "access-123",
        expires_in: 1800,
        refresh_token: "refresh-123",
        scope: GOOGLE_CALENDAR_READONLY_SCOPE,
        token_type: "Bearer"
      });
    };

    const exchanged = await exchangeGoogleCalendarCode("auth-code", {
      fetcher: exchangeFetcher,
      now: new Date("2026-05-13T12:00:00.000Z")
    });
    assert.equal(exchanged.refreshToken, "refresh-123");
    assert.equal(exchanged.expiresAt, "2026-05-13T12:30:00.000Z");
    assert.equal(exchangeCalls[0].get("grant_type"), "authorization_code");

    const refreshFetcher: typeof fetch = async (_input, init) => {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "refresh-123");
      return responseJson({
        access_token: "access-456",
        expires_in: 900,
        token_type: "Bearer"
      });
    };

    const refreshed = await refreshGoogleCalendarAccessToken("refresh-123", {
      fetcher: refreshFetcher,
      now: new Date("2026-05-13T12:00:00.000Z"),
      previousScope: GOOGLE_CALENDAR_READONLY_SCOPE
    });
    assert.equal(refreshed.accessToken, "access-456");
    assert.equal(refreshed.scope, GOOGLE_CALENDAR_READONLY_SCOPE);

    await assert.rejects(
      () => exchangeGoogleCalendarCode("auth-code", {
        fetcher: async () => responseJson({
          access_token: "access-789",
          expires_in: 1800,
          refresh_token: "refresh-789",
          scope: "https://www.googleapis.com/auth/calendar",
          token_type: "Bearer"
        }),
        now: new Date("2026-05-13T12:00:00.000Z")
      }),
      GoogleCalendarScopeError
    );
  });
});

test("Google Calendar read and refresh updates keep status guards", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const refreshUpdates: CalendarUpdateCall[] = [];
    const expiredConnection = calendarConnection({ expires_at: "2026-05-13T11:30:00.000Z" });
    const refreshedToken = await loadGoogleCalendarAccessToken(
      createCalendarConnectionClient(expiredConnection, refreshUpdates),
      "user-1",
      expiredConnection,
      {
        fetcher: async () => responseJson({
          access_token: "access-refreshed",
          expires_in: 1800,
          scope: GOOGLE_CALENDAR_READONLY_SCOPE,
          token_type: "Bearer"
        }),
        now: new Date("2026-05-13T12:00:00.000Z")
      }
    );

    assert.equal(refreshedToken, "access-refreshed");
    assert.deepEqual(refreshUpdates[0].inFilters, [{ column: "status", values: ["active", "error"] }]);

    const readUpdates: CalendarUpdateCall[] = [];
    const context = await loadUpcomingCalendarContext(
      createCalendarConnectionClient(calendarConnection(), readUpdates),
      "user-1",
      {
        fetcher: async () => responseJson({ items: [] }),
        generatedAt: "2026-05-13T12:00:00.000Z",
        now: new Date("2026-05-13T12:00:00.000Z")
      }
    );

    assert.equal(context.status, "ready");
    assert.deepEqual(readUpdates[0].inFilters, [{ column: "status", values: ["active", "error"] }]);
  });
});

test("Google Calendar events parser ignores raw descriptions and attendees", () => {
  const events = parseGoogleCalendarEvents({
    items: [
      {
        attendees: [{ email: "guest@example.com" }],
        description: "private notes",
        end: { dateTime: "2026-05-14T03:00:00.000Z" },
        location: "Oakland, CA",
        start: { dateTime: "2026-05-14T01:00:00.000Z" },
        summary: "Dinner"
      },
      {
        start: { date: "2026-05-15" },
        status: "cancelled",
        summary: "Cancelled"
      }
    ]
  });

  assert.deepEqual(events, [
    {
      allDay: false,
      end: "2026-05-14T03:00:00.000Z",
      location: "Oakland, CA",
      start: "2026-05-14T01:00:00.000Z",
      title: "Dinner"
    }
  ]);
  assert.doesNotMatch(JSON.stringify(events), /guest@example\.com|private notes/);
});

function createEmptyCalendarClient(): FinanceSupabaseClient {
  return {
    from(_table: string) {
      const builder = {
        eq() { return builder; },
        in() { return builder; },
        limit() { return builder; },
        order() { return builder; },
        select() { return builder; },
        single() { return builder; },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
        },
        update(_value: Record<string, unknown>) { return builder; }
      };
      return builder;
    }
  } as unknown as FinanceSupabaseClient;
}

test("loadUpcomingCalendarContext refreshes an expired token before fetching events", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const now = new Date("2026-05-13T12:00:00.000Z");
    const expiredConnection = calendarConnection({ expires_at: "2026-05-13T11:00:00.000Z" });
    const updates: CalendarUpdateCall[] = [];

    const fetcher: typeof fetch = async (input) => {
      if (new URL(String(input)).hostname === "oauth2.googleapis.com") {
        return responseJson({
          access_token: "access-refreshed",
          expires_in: 3600,
          scope: GOOGLE_CALENDAR_READONLY_SCOPE,
          token_type: "Bearer"
        });
      }
      return responseJson({ items: [] });
    };

    const context = await loadUpcomingCalendarContext(
      createCalendarConnectionClient(expiredConnection, updates),
      "user-1",
      { fetcher, generatedAt: now.toISOString(), now }
    );

    assert.equal(context.status, "ready");
    assert.equal(updates.length, 2);
    assert.ok("access_token_ciphertext" in updates[0].payload, "first update should store new access token");
    assert.equal(updates[1].payload.last_successful_sync_at, now.toISOString());
  });
});

test("loadUpcomingCalendarContext marks connection error and returns error context on read failure", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const now = new Date("2026-05-13T12:00:00.000Z");
    const updates: CalendarUpdateCall[] = [];

    const context = await loadUpcomingCalendarContext(
      createCalendarConnectionClient(calendarConnection(), updates),
      "user-1",
      {
        fetcher: async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        generatedAt: now.toISOString(),
        now
      }
    );

    assert.equal(context.status, "error");
    assert.equal(context.eventCount, 0);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].payload.status, "error");
    assert.equal(updates[0].payload.error_code, "CALENDAR_READ_FAILED");
  });
});

test("loadUpcomingCalendarContext returns not_configured when no active connection exists", async () => {
  const now = new Date("2026-05-13T12:00:00.000Z");

  const context = await loadUpcomingCalendarContext(
    createEmptyCalendarClient(),
    "user-1",
    { generatedAt: now.toISOString(), now }
  );

  assert.equal(context.status, "not_configured");
  assert.equal(context.eventCount, 0);
});

test("parseGoogleCalendarEvents filters out all cancelled events", () => {
  const events = parseGoogleCalendarEvents({
    items: [
      { start: { dateTime: "2026-05-14T10:00:00.000Z" }, status: "cancelled", summary: "Removed" },
      { start: { dateTime: "2026-05-14T11:00:00.000Z" }, summary: "Active" },
      { start: { date: "2026-05-15" }, status: "cancelled", summary: "Also Removed" }
    ]
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Active");
});

test("parseGoogleCalendarEvents marks events with only date as all-day and events with dateTime as timed", () => {
  const events = parseGoogleCalendarEvents({
    items: [
      { start: { date: "2026-05-14" }, end: { date: "2026-05-15" }, summary: "All Day" },
      { start: { dateTime: "2026-05-14T10:00:00.000Z" }, end: { dateTime: "2026-05-14T11:00:00.000Z" }, summary: "Timed" },
      { start: { date: "2026-05-14", dateTime: "2026-05-14T00:00:00.000Z" }, summary: "Has Both" }
    ]
  });

  assert.equal(events.length, 3);
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].start, "2026-05-14");
  assert.equal(events[1].allDay, false);
  assert.equal(events[1].start, "2026-05-14T10:00:00.000Z");
  assert.equal(events[2].allDay, false);
  assert.equal(events[2].start, "2026-05-14T00:00:00.000Z");
});

test("Google Calendar list helper sends bounded readonly request", async () => {
  let requestedUrlText: string | null = null;
  let requestedAuth: string | null = null;
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrlText = String(input);
    requestedAuth = init?.headers instanceof Headers
      ? init.headers.get("Authorization")
      : (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    return responseJson({ items: [] });
  };

  const events = await listGoogleCalendarEvents("access-token", {
    fetcher,
    timeMax: "2026-05-27T12:00:00.000Z",
    timeMin: "2026-05-13T12:00:00.000Z"
  });

  assert.deepEqual(events, []);
  assert.equal(requestedAuth, "Bearer access-token");
  assert.ok(requestedUrlText);
  const requestedUrl = new URL(requestedUrlText);
  assert.equal(requestedUrl.searchParams.get("timeMin"), "2026-05-13T12:00:00.000Z");
  assert.equal(requestedUrl.searchParams.get("timeMax"), "2026-05-27T12:00:00.000Z");
  assert.equal(requestedUrl.searchParams.get("singleEvents"), "true");
  assert.equal(requestedUrl.searchParams.get("maxResults"), "25");
  assert.equal(requestedUrl.searchParams.get("fields"), "items(status,start,end,summary,location)");
});
