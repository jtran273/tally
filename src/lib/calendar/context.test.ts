import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantContextSafe, assertFinanceManifestSafe } from "@/lib/agents";
import {
  buildUpcomingCalendarContext,
  calendarLocationCity,
  categorizeCalendarEvent,
  safeCalendarTitle
} from "./context";

const now = new Date("2026-05-13T12:00:00.000Z");

test("calendar context redacts titles and exposes city-only location context", () => {
  const context = buildUpcomingCalendarContext([
    {
      allDay: false,
      end: "2026-05-14T03:00:00.000Z",
      location: "123 Market St, San Francisco",
      start: "2026-05-14T01:00:00.000Z",
      title: "Dinner with alex@example.com https://calendar.example.test/reservation/123"
    }
  ], { generatedAt: now.toISOString(), now });
  const serialized = JSON.stringify(context);

  assert.equal(context.action, "read.upcoming_calendar_context");
  assert.equal(context.window.fromDate, "2026-05-13");
  assert.equal(context.window.toDate, "2026-05-27");
  assert.equal(context.events[0].locationCity, "San Francisco");
  assert.equal("location" in context.events[0], false);
  assert.equal(context.events[0].suspected_category, "dining");
  assert.doesNotMatch(serialized, /123 Market|Market St/);
  assert.doesNotMatch(serialized, /alex@example\.com/);
  assert.doesNotMatch(serialized, /https?:\/\//);
  assertFinanceManifestSafe(context);
});

test("calendar title redaction and truncation stay bounded", () => {
  const title = safeCalendarTitle(`Wedding ${"very ".repeat(30)} person@example.com`);
  const linkOnlyTitle = safeCalendarTitle("meet.google.com/abc-defg-hij");
  const secretOnlyTitle = safeCalendarTitle("Bearer abcdefghijklmnop");
  const secretInTitle = safeCalendarTitle("Dinner Bearer abcdefghijklmnop");

  assert.equal(title.length <= 80, true);
  assert.doesNotMatch(title, /person@example\.com/);
  assert.equal(linkOnlyTitle, "Busy");
  assert.equal(secretOnlyTitle, "Busy");
  assert.equal(secretInTitle, "Dinner [redacted]");
});

test("calendar context redacts secret-shaped text before assistant handoff", () => {
  const context = buildUpcomingCalendarContext([
    {
      allDay: false,
      end: null,
      location: "Venue, sk-proj-abcdefghijklmnopqrstuv, CA",
      start: "2026-05-14T01:00:00.000Z",
      title: "Bearer abcdefghijklmnop"
    },
    {
      allDay: false,
      end: null,
      location: "123 Market St, San Francisco, CA",
      start: "2026-05-14T03:00:00.000Z",
      title: "Dinner public-sandbox-abcdefghijklmnop"
    }
  ], { generatedAt: now.toISOString(), now });
  const serialized = JSON.stringify(context);

  assert.equal(context.events[0].title, "Busy");
  assert.equal(context.events[0].locationCity, null);
  assert.equal(context.events[1].title, "Dinner [redacted]");
  assert.doesNotMatch(serialized, /Bearer|public-sandbox|sk-proj/);
  assertAssistantContextSafe(context);
});

test("calendar location city omits virtual links and street-only locations", () => {
  assert.equal(calendarLocationCity("Google Meet"), null);
  assert.equal(calendarLocationCity("123 Main St"), null);
  assert.equal(calendarLocationCity("Home"), null);
  assert.equal(calendarLocationCity("Home, CA"), null);
  assert.equal(calendarLocationCity("Therapy office, CA"), null);
  assert.equal(calendarLocationCity("Therapy office, CA, USA"), null);
  assert.equal(calendarLocationCity("Home, Mission District"), null);
  assert.equal(calendarLocationCity("Therapy office"), null);
  assert.equal(calendarLocationCity("meet.google.com/abc-defg-hij, San Francisco, CA"), "San Francisco");
  assert.equal(calendarLocationCity("zoom.us/j/123456789"), null);
  assert.equal(calendarLocationCity("123 Market St, San Francisco"), "San Francisco");
  assert.equal(calendarLocationCity("123 Market St, San Francisco, CA 94102"), "San Francisco");
  assert.equal(calendarLocationCity("123 Market St, Suite 400"), null);
  assert.equal(calendarLocationCity("Ferry Building, San Francisco, CA"), "San Francisco");
  assert.equal(calendarLocationCity("San Francisco, CA, USA"), "San Francisco");
  assert.equal(calendarLocationCity("Santa Monica, CA"), "Santa Monica");
});

test("calendar categorizer recognizes planning pressure keywords", () => {
  assert.equal(categorizeCalendarEvent("LAX flight to NYC"), "travel");
  assert.equal(categorizeCalendarEvent("Hotel check-in"), "lodging");
  assert.equal(categorizeCalendarEvent("Ryan birthday"), "birthday");
  assert.equal(categorizeCalendarEvent("Buy graduation gift"), "gift");
  assert.equal(categorizeCalendarEvent("Wedding rehearsal dinner"), "wedding");
  assert.equal(categorizeCalendarEvent("Lyft to dinner reservation"), "dining");
  assert.equal(categorizeCalendarEvent("Team planning"), "other");
});
