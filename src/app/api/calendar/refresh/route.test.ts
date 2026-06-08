import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/security/request";
import { POST, refreshGoogleCalendarRoute } from "./route";

const connection = {
  calendarSummary: "Primary calendar",
  createdAt: "2026-06-08T07:00:00.000Z",
  errorCode: null,
  errorMessage: null,
  id: "calendar-connection-1",
  lastSuccessfulSyncAt: "2026-06-08T07:30:00.000Z",
  status: "active" as const,
  updatedAt: "2026-06-08T07:30:00.000Z"
};

function sameOriginRefreshRequest() {
  return new NextRequest("http://localhost/api/calendar/refresh", {
    headers: { origin: "http://localhost" },
    method: "POST"
  });
}

function crossOriginRefreshRequest() {
  return new NextRequest("http://localhost/api/calendar/refresh", {
    headers: { origin: "https://attacker.example.com" },
    method: "POST"
  });
}

function dependencies(overrides: Partial<Parameters<typeof refreshGoogleCalendarRoute>[1]> = {}) {
  return {
    createWriteClient: () => ({}) as never,
    isDemo: async () => false,
    listConnections: async () => [connection],
    loadContext: async () => ({
      action: "read.upcoming_calendar_context" as const,
      categories: { travel: 1 },
      eventCount: 1,
      events: [],
      generatedAt: "2026-06-08T07:30:00.000Z",
      status: "ready" as const,
      window: {
        fromDate: "2026-06-08",
        toDate: "2026-06-22"
      }
    }),
    requireUser: async () => ({
      supabase: {} as never,
      user: { id: "user-1" }
    }),
    ...overrides
  };
}

test("Calendar refresh rejects cross-origin requests", async () => {
  const response = await POST(crossOriginRefreshRequest());

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Invalid request origin." });
});

test("Calendar refresh rejects unauthenticated users", async () => {
  const response = await refreshGoogleCalendarRoute(
    sameOriginRefreshRequest(),
    dependencies({
      requireUser: async () => ({
        response: jsonNoStore({ error: "Authentication required." }, { status: 401 })
      })
    })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required." });
});

test("Calendar refresh reads upcoming calendar context and returns the refreshed connection summary", async () => {
  let loaded = false;

  const response = await refreshGoogleCalendarRoute(
    sameOriginRefreshRequest(),
    dependencies({
      loadContext: async () => {
        loaded = true;
        return {
          action: "read.upcoming_calendar_context",
          categories: { travel: 2 },
          eventCount: 2,
          events: [],
          generatedAt: "2026-06-08T07:30:00.000Z",
          status: "ready",
          window: {
            fromDate: "2026-06-08",
            toDate: "2026-06-22"
          }
        };
      }
    })
  );

  assert.equal(response.status, 200);
  assert.equal(loaded, true);
  assert.deepEqual(await response.json(), {
    connection,
    connections: [connection],
    eventCount: 2
  });
});

test("Calendar refresh returns a clean success when no calendar is connected", async () => {
  const response = await refreshGoogleCalendarRoute(
    sameOriginRefreshRequest(),
    dependencies({
      listConnections: async () => [],
      loadContext: async () => ({
        action: "read.upcoming_calendar_context",
        categories: {},
        eventCount: 0,
        events: [],
        generatedAt: "2026-06-08T07:30:00.000Z",
        status: "not_configured",
        window: {
          fromDate: "2026-06-08",
          toDate: "2026-06-22"
        }
      })
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    connection: null,
    connections: [],
    eventCount: 0
  });
});
