import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantContextSafe, buildWeeklyPlanningContext } from "@/lib/agents";
import { openClawSignalsFixture } from "@/lib/agents/openclaw-fixtures";
import { buildUpcomingCalendarContext, type CalendarEventInput } from "@/lib/calendar";
import type { OpenClawSignalsResponse } from "./types";
import { buildOpenClawOutboxResponse } from "./outbox";
import { buildOpenClawSignalsResponse } from "./signals";

const OUTBOX_GENERATED_AT = "2026-05-13T12:00:00.000Z";

function signalsWithCalendar(events: CalendarEventInput[]) {
  const now = new Date(OUTBOX_GENERATED_AT);
  return buildOpenClawSignalsResponse({
    generatedAt: OUTBOX_GENERATED_AT,
    calendarContext: buildUpcomingCalendarContext(events, { generatedAt: OUTBOX_GENERATED_AT, now }),
    openClarificationProposals: [],
    pendingProposals: [],
    since: "2026-05-12T12:00:00.000Z",
    weeklyPlanningContext: buildWeeklyPlanningContext({
      generatedAt: OUTBOX_GENERATED_AT,
      now,
      transactions: []
    })
  });
}

function budgetBriefingBody(signals: OpenClawSignalsResponse) {
  return buildOpenClawOutboxResponse(signals).messages.find((message) => message.kind === "budget_briefing")?.body ?? "";
}

test("OpenClaw outbox creates text-ready reimbursement and budget messages", () => {
  const outbox = buildOpenClawOutboxResponse(openClawSignalsFixture);

  assert.equal(outbox.object, "ledger.openclaw.outbox");
  assert.equal(outbox.messages.length, 2);
  assert.equal(outbox.messages[0]?.kind, "reimbursement_clarification");
  assert.equal(outbox.messages[0]?.priority, "high");
  assert.equal(outbox.messages[0]?.replyAction?.endpoint, "/api/openclaw/replies");
  assert.match(outbox.messages[0]?.body ?? "", /Reply yes\/no or a name/);
  assert.equal(outbox.messages[1]?.kind, "budget_briefing");
  assert.match(outbox.messages[1]?.body ?? "", /Tally budget/);
  assertAssistantContextSafe(outbox);
});

test("OpenClaw outbox does not include delivery addresses or direct write authority", () => {
  const outbox = buildOpenClawOutboxResponse(openClawSignalsFixture, {
    includeBudgetBriefing: false,
    messageLimit: 1
  });
  const serializedMessages = JSON.stringify(outbox.messages);

  assert.equal(outbox.messages.length, 1);
  assert.equal(outbox.safety.deliveryContainsPhoneNumber, false);
  assert.equal(outbox.safety.directFinanceWritesAllowed, false);
  assert.doesNotMatch(serializedMessages, /phone|twilio|service_role|access_token|plaid/i);
  assertAssistantContextSafe(outbox);
});

test("OpenClaw outbox can filter to high-priority messages only", () => {
  const outbox = buildOpenClawOutboxResponse(openClawSignalsFixture, {
    minPriority: "high"
  });

  assert.equal(outbox.messages.length, 1);
  assert.equal(outbox.messages[0]?.kind, "reimbursement_clarification");
  assert.equal(outbox.messages[0]?.priority, "high");
  assertAssistantContextSafe(outbox);
});

test("OpenClaw outbox applies priority filtering before message limits", () => {
  const outbox = buildOpenClawOutboxResponse(openClawSignalsFixture, {
    messageLimit: 1,
    minPriority: "normal"
  });

  assert.equal(outbox.messages.length, 1);
  assert.equal(outbox.messages[0]?.kind, "reimbursement_clarification");
});

test("OpenClaw outbox creates specific high-priority review and reimbursement alerts", () => {
  const signals = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  signals.openClarificationQuestions = [];
  signals.weeklyPlanningContext.spending.currentWeek.reimbursementOutstanding = 125;
  signals.weeklyPlanningContext.review = {
    action: "read.review_queue_summary",
    examples: [{
      amount: -72,
      category: "Food",
      confidence: 0.42,
      date: "2026-05-13",
      intent: "personal",
      merchant: "Dinner",
      reason: "low-confidence",
      reviewItemId: "review-1",
      transactionId: "tx-1"
    }],
    generatedAt: signals.generatedAt,
    openCount: 2,
    reasonCounts: { "low-confidence": 2 },
    totalAbsoluteAmount: 144
  };

  const outbox = buildOpenClawOutboxResponse(signals, { minPriority: "high" });

  assert.deepEqual(
    outbox.messages.map((message) => message.kind),
    ["reimbursement_alert", "review_queue_alert"]
  );
  assert.match(outbox.messages[0]?.body ?? "", /\$125/);
  assert.match(outbox.messages[1]?.body ?? "", /2 open items/);
  assertAssistantContextSafe(outbox);
});

test("OpenClaw outbox includes at most one lifecycle hint per response", () => {
  const outbox = buildOpenClawOutboxResponse(openClawSignalsFixture, {
    includeBudgetBriefing: false,
    lifecycleHints: [
      {
        id: "account-lifecycle:inactivity:acct-A:2025-09-01",
        accountId: "acct-A",
        accountDisplayName: "Card A (…1111)",
        kind: "inactivity_check",
        priority: "low",
        rationale: "Card A (…1111) has no recent activity (last transaction 2025-09-01, 200 days ago). Tally does not recommend closing this card."
      },
      {
        id: "account-lifecycle:inactivity:acct-B:2025-09-15",
        accountId: "acct-B",
        accountDisplayName: "Card B (…2222)",
        kind: "inactivity_check",
        priority: "low",
        rationale: "Card B (…2222) has no recent activity. Tally does not recommend closing this card."
      }
    ]
  });

  const lifecycleMessages = outbox.messages.filter((message) => message.kind === "lifecycle_guidance");
  assert.equal(lifecycleMessages.length, 1);
  assert.equal(lifecycleMessages[0]?.priority, "normal");
  assert.match(lifecycleMessages[0]?.body ?? "", /Tally heads-up/);
  assertAssistantContextSafe(outbox);
});

test("OpenClaw outbox filters lifecycle hints out when min priority is high", () => {
  const outbox = buildOpenClawOutboxResponse(openClawSignalsFixture, {
    includeBudgetBriefing: false,
    minPriority: "high",
    lifecycleHints: [
      {
        id: "account-lifecycle:inactivity:acct-A:2025-09-01",
        accountId: "acct-A",
        accountDisplayName: "Card A",
        kind: "inactivity_check",
        priority: "low",
        rationale: "Card A has no recent activity. Tally does not recommend closing this card."
      }
    ]
  });

  assert.equal(outbox.messages.find((message) => message.kind === "lifecycle_guidance"), undefined);
});

test("budget briefing folds calendar pressure into the forwarded body", () => {
  const quiet = budgetBriefingBody(signalsWithCalendar([]));
  assert.match(quiet, /Tally budget/);
  assert.doesNotMatch(quiet, /calendar pressure/);

  const busy = budgetBriefingBody(
    signalsWithCalendar([
      {
        allDay: true,
        end: "2026-05-17",
        location: "SFO Airport",
        start: "2026-05-16",
        title: "Flight to Phoenix"
      },
      {
        allDay: false,
        end: "2026-05-17T18:00:00.000Z",
        location: "Phoenix, AZ",
        start: "2026-05-17T15:00:00.000Z",
        title: "Hotel check-in"
      }
    ])
  );

  assert.match(busy, /Tally budget/);
  assert.match(busy, /calendar pressure high \(.*ahead\)/);
  assert.match(busy, /travel/);
});

test("reimbursement clarification appends calendar hint when dining/travel/gift/wedding events present", () => {
  const base = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  const now = new Date(OUTBOX_GENERATED_AT);
  base.calendarContext = buildUpcomingCalendarContext(
    [
      { allDay: true, end: "2026-05-17", location: null, start: "2026-05-16", title: "Flight to Phoenix" },
      { allDay: false, end: "2026-05-18T21:00:00.000Z", location: null, start: "2026-05-18T19:00:00.000Z", title: "Dinner reservation" }
    ],
    { generatedAt: OUTBOX_GENERATED_AT, now }
  );
  const outbox = buildOpenClawOutboxResponse(base);
  const body = outbox.messages.find((m) => m.kind === "reimbursement_clarification")?.body ?? "";

  assert.match(body, /Tally reimbursement check/);
  assert.match(body, /Reply yes\/no or a name/);
  assert.match(body, /Heads-up: upcoming/);
  assert.match(body, /travel/);
  assert.match(body, /dining/);
  assertAssistantContextSafe(outbox);
});

test("reimbursement clarification omits calendar hint when only non-prompt categories present", () => {
  const base = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  const now = new Date(OUTBOX_GENERATED_AT);
  base.calendarContext = buildUpcomingCalendarContext(
    [
      { allDay: false, end: "2026-05-17T18:00:00.000Z", location: null, start: "2026-05-17T15:00:00.000Z", title: "Hotel checkout" },
      { allDay: false, end: "2026-05-18T18:00:00.000Z", location: null, start: "2026-05-18T16:00:00.000Z", title: "Birthday party" }
    ],
    { generatedAt: OUTBOX_GENERATED_AT, now }
  );
  const outbox = buildOpenClawOutboxResponse(base);
  const body = outbox.messages.find((m) => m.kind === "reimbursement_clarification")?.body ?? "";

  assert.match(body, /Reply yes\/no or a name/);
  assert.doesNotMatch(body, /Heads-up/);
});

test("review queue alert appends calendar hint when dining/travel/gift/wedding events present", () => {
  const base = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  const now = new Date(OUTBOX_GENERATED_AT);
  base.calendarContext = buildUpcomingCalendarContext(
    [{ allDay: false, end: "2026-05-17T21:00:00.000Z", location: null, start: "2026-05-17T19:00:00.000Z", title: "Wedding reception" }],
    { generatedAt: OUTBOX_GENERATED_AT, now }
  );
  base.openClarificationQuestions = [];
  base.weeklyPlanningContext.review = {
    action: "read.review_queue_summary",
    examples: [{
      amount: -90,
      category: "Entertainment",
      confidence: 0.45,
      date: "2026-05-13",
      intent: "personal",
      merchant: "Grand Venue",
      reason: "low-confidence",
      reviewItemId: "review-2",
      transactionId: "tx-2"
    }],
    generatedAt: OUTBOX_GENERATED_AT,
    openCount: 1,
    reasonCounts: { "low-confidence": 1 },
    totalAbsoluteAmount: 90
  };
  const outbox = buildOpenClawOutboxResponse(base);
  const body = outbox.messages.find((m) => m.kind === "review_queue_alert")?.body ?? "";

  assert.match(body, /Tally review/);
  assert.match(body, /Heads-up: upcoming/);
  assert.match(body, /weddings/);
  assertAssistantContextSafe(outbox);
});

test("reimbursement and review prompt copy never leaks event titles, locations, or timing", () => {
  const base = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  const now = new Date(OUTBOX_GENERATED_AT);
  base.calendarContext = buildUpcomingCalendarContext(
    [
      {
        allDay: false,
        end: "2026-05-15T03:00:00.000Z",
        location: "456 Secret Blvd, hidden-city",
        start: "2026-05-15T01:00:00.000Z",
        title: "Dinner with confidential-guest at top-secret-restaurant"
      },
      {
        allDay: true,
        end: "2026-05-17",
        location: "SFO Airport",
        start: "2026-05-16",
        title: "Flight to classified-destination"
      }
    ],
    { generatedAt: OUTBOX_GENERATED_AT, now }
  );
  base.weeklyPlanningContext.review = {
    action: "read.review_queue_summary",
    examples: [],
    generatedAt: OUTBOX_GENERATED_AT,
    openCount: 1,
    reasonCounts: { "low-confidence": 1 },
    totalAbsoluteAmount: 50
  };
  const outbox = buildOpenClawOutboxResponse(base);
  const allBodies = outbox.messages.map((m) => m.body).join(" ");

  assert.doesNotMatch(allBodies, /confidential-guest|top-secret-restaurant|classified-destination|hidden-city|Secret Blvd|SFO Airport/i);
  assertAssistantContextSafe(outbox);
});

test("budget briefing calendar phrase never leaks event details", () => {
  const body = budgetBriefingBody(
    signalsWithCalendar([
      {
        allDay: false,
        end: "2026-05-15T03:00:00.000Z",
        location: "123 Market St, San Francisco https://meet.google.com/abc-defg-hij",
        start: "2026-05-15T01:00:00.000Z",
        title: "Dinner with alex@example.com about secret-project-orion"
      },
      {
        allDay: true,
        end: "2026-05-17",
        location: "SFO Airport",
        start: "2026-05-16",
        title: "Flight to Phoenix"
      }
    ])
  );

  assert.match(body, /calendar pressure/);
  assert.doesNotMatch(body, /alex@example\.com|Market St|meet\.google\.com|secret-project-orion|Dinner with|Phoenix/);
});
