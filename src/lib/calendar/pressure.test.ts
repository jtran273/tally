import assert from "node:assert/strict";
import test from "node:test";
import { buildUpcomingCalendarContext, emptyUpcomingCalendarContext, type CalendarEventInput } from "./context";
import {
  calendarPressureCategoryPhrase,
  calendarPressureLevel,
  summarizeCalendarPressure
} from "./pressure";

const now = new Date("2026-05-13T12:00:00.000Z");

function context(events: CalendarEventInput[]) {
  return buildUpcomingCalendarContext(events, { generatedAt: now.toISOString(), now });
}

function event(title: string, location: string | null = null, startDay = "2026-05-14"): CalendarEventInput {
  return {
    allDay: false,
    end: `${startDay}T03:00:00.000Z`,
    location,
    start: `${startDay}T01:00:00.000Z`,
    title
  };
}

test("calendar pressure level scales with event volume and travel weight", () => {
  assert.equal(calendarPressureLevel(context([])), "none");
  assert.equal(calendarPressureLevel(context([event("Coffee catch-up")])), "light");
  assert.equal(calendarPressureLevel(context([event("Dinner reservation"), event("Flight to Phoenix")])), "moderate");
  assert.equal(
    calendarPressureLevel(context([event("Flight to NYC"), event("Hotel check-in")])),
    "high"
  );
  assert.equal(
    calendarPressureLevel(
      context(Array.from({ length: 8 }, (_, index) => event(`Meeting ${index}`)))
    ),
    "high"
  );
});

test("disconnected, not_configured, and error calendars carry no pressure", () => {
  assert.equal(calendarPressureLevel(emptyUpcomingCalendarContext({ now })), "none");
  assert.equal(calendarPressureLevel(emptyUpcomingCalendarContext({ now, status: "error" })), "none");

  const summary = summarizeCalendarPressure(emptyUpcomingCalendarContext({ now, status: "error" }));
  assert.equal(summary.level, "none");
  assert.equal(summary.eventCount, 0);
  assert.equal(summary.plannedSpendEventCount, 0);
  assert.deepEqual(summary.topPlannedSpendCategories, []);
});

test("pressure summary counts only planned-spend categories and excludes other", () => {
  const summary = summarizeCalendarPressure(
    context([
      event("Flight to Phoenix"),
      event("Dinner reservation"),
      event("Team standup"),
      event("Buy graduation gift")
    ])
  );

  assert.equal(summary.eventCount, 4);
  assert.equal(summary.plannedSpendEventCount, 3);
  assert.deepEqual(
    summary.topPlannedSpendCategories.map((entry) => entry.category).sort(),
    ["dining", "gift", "travel"]
  );
});

test("pressure summary never leaks event titles or locations", () => {
  const summary = summarizeCalendarPressure(
    context([event("Flight to Phoenix with secret-codename project", "123 Market St, San Francisco")])
  );
  const serialized = JSON.stringify(summary);

  assert.doesNotMatch(serialized, /secret-codename|Phoenix|Market St|San Francisco/);
});

test("category phrase renders a bounded human list", () => {
  assert.equal(calendarPressureCategoryPhrase([]), null);
  assert.equal(calendarPressureCategoryPhrase([{ category: "travel", count: 2 }]), "travel");
  assert.equal(
    calendarPressureCategoryPhrase([
      { category: "travel", count: 2 },
      { category: "dining", count: 1 }
    ]),
    "travel and dining"
  );
  assert.equal(
    calendarPressureCategoryPhrase([
      { category: "travel", count: 2 },
      { category: "dining", count: 1 },
      { category: "gift", count: 1 },
      { category: "wedding", count: 1 }
    ]),
    "travel, dining, and gifts"
  );
});
