import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantContextSafe, buildWeeklyPlanningContext } from "@/lib/agents";
import { openClawSignalsFixture } from "@/lib/agents/openclaw-fixtures";
import { buildUpcomingCalendarContext, type CalendarEventInput } from "@/lib/calendar";
import type { BudgetGuardrailSummary } from "@/lib/finance/budget-guardrails";
import type { AgentProposalType } from "@/lib/db";
import type { OpenClawProposalSignal, OpenClawSignalsResponse } from "./types";
import { buildOpenClawOutboxResponse } from "./outbox";
import { buildOpenClawSignalsResponse } from "./signals";

const OUTBOX_GENERATED_AT = "2026-05-13T12:00:00.000Z";

function guardrailSummary(items: BudgetGuardrailSummary["items"]): BudgetGuardrailSummary {
  return {
    asOfDate: "2026-05-13",
    baselineMonthCount: 3,
    fromDate: "2026-05-01",
    items,
    monthElapsedDays: 13,
    monthTotalDays: 31,
    nearCount: items.filter((item) => item.status === "near").length,
    overCount: items.filter((item) => item.status === "over").length,
    toDate: "2026-05-13"
  };
}

function pendingProposalSignal(input: Partial<OpenClawProposalSignal> = {}): OpenClawProposalSignal {
  return {
    id: "detected-1",
    clarificationQuestion: null,
    confidence: 0.7,
    createdAt: OUTBOX_GENERATED_AT,
    evidence: { transaction: { amount: -84, date: "2026-05-11", merchant: "Sushi House" } },
    expiresAt: null,
    proposalType: "reimbursement_candidate" as AgentProposalType,
    proposedPatch: { suggestedIntent: "reimbursable" },
    questionFingerprint: null,
    sourceAgent: "test",
    status: "pending",
    targetId: "tx-detected",
    targetKind: "enriched_transaction",
    updatedAt: OUTBOX_GENERATED_AT,
    ...input
  };
}

function monthlyBudgetProposalSignal(input: Partial<OpenClawProposalSignal> = {}): OpenClawProposalSignal {
  return pendingProposalSignal({
    id: "budget-2026-07",
    evidence: {
      baselineMonths: 3,
      uncertaintyNotes: ["2 open reviews could shift dining."]
    },
    proposalType: "monthly_budget_proposal" as AgentProposalType,
    proposedPatch: {
      categories: [
        { amount: 500, label: "Dining" },
        { amount: 450, label: "Groceries" },
        { amount: 200, label: "Rideshare" },
        { amount: 120, label: "Entertainment" }
      ],
      month: "2026-07",
      totalAmount: 1270
    },
    targetId: "budget:2026-07",
    targetKind: "openclaw_briefing",
    ...input
  });
}

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
  signals.pendingProposals = [];
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

test("OpenClaw outbox emits budget-threshold nudges but reserves high priority for over-budget categories", () => {
  const budgetGuardrails = guardrailSummary([
    {
      budgetAmount: 500,
      currentAmount: 436,
      id: "cat-dining",
      label: "Dining",
      openReviewCount: 0,
      percentUsed: 87.2,
      projectedAmount: 1040,
      projectedPercent: 208,
      remainingAmount: 64,
      status: "near",
      transactionCount: 12,
      trustedAmount: 436,
      unresolvedReviewAmount: 0
    },
    {
      budgetAmount: 200,
      currentAmount: 260,
      id: "cat-rideshare",
      label: "Rideshare",
      openReviewCount: 0,
      percentUsed: 130,
      projectedAmount: 620,
      projectedPercent: 310,
      remainingAmount: -60,
      status: "over",
      transactionCount: 9,
      trustedAmount: 260,
      unresolvedReviewAmount: 0
    }
  ]);

  const outbox = buildOpenClawOutboxResponse(openClawSignalsFixture, {
    budgetGuardrails,
    includeBudgetBriefing: false
  });

  const thresholdMessages = outbox.messages.filter((message) => message.kind === "budget_threshold");
  assert.equal(thresholdMessages.length, 2);
  assert.equal(thresholdMessages[0]?.priority, "normal");
  assert.equal(thresholdMessages[0]?.replyAction, null);
  assert.match(thresholdMessages[0]?.body ?? "", /87% through your Dining budget/);
  assert.match(thresholdMessages[0]?.body ?? "", /\$436 of \$500/);
  assert.match(thresholdMessages[0]?.body ?? "", /18 days left this month/);
  assert.equal(thresholdMessages[1]?.priority, "high");
  assert.match(thresholdMessages[1]?.body ?? "", /over your Rideshare budget/);

  const highOnly = buildOpenClawOutboxResponse(openClawSignalsFixture, {
    budgetGuardrails,
    includeBudgetBriefing: false,
    minPriority: "high"
  }).messages.filter((message) => message.kind === "budget_threshold");
  assert.equal(highOnly.length, 1);
  assert.match(highOnly[0]?.body ?? "", /over your Rideshare budget/);
  assertAssistantContextSafe(outbox);
});

test("OpenClaw outbox skips on-track budget categories", () => {
  const outbox = buildOpenClawOutboxResponse(openClawSignalsFixture, {
    includeBudgetBriefing: false,
    budgetGuardrails: guardrailSummary([
      {
        budgetAmount: 500,
        currentAmount: 100,
        id: "cat-groceries",
        label: "Groceries",
        openReviewCount: 0,
        percentUsed: 20,
        projectedAmount: 240,
        projectedPercent: 48,
        remainingAmount: 400,
        status: "on-track",
        transactionCount: 4,
        trustedAmount: 100,
        unresolvedReviewAmount: 0
      }
    ])
  });

  assert.equal(outbox.messages.find((message) => message.kind === "budget_threshold"), undefined);
});

test("OpenClaw outbox surfaces detected reimbursement candidates as approval-gated nudges", () => {
  const signals = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  signals.openClarificationQuestions = [];
  signals.pendingProposals = [
    pendingProposalSignal({ id: "detected-sushi" })
  ];

  const outbox = buildOpenClawOutboxResponse(signals, {
    includeBudgetBriefing: false,
    minPriority: "high"
  });

  const detected = outbox.messages.filter((message) => message.kind === "reimbursement_detected");
  assert.equal(detected.length, 1);
  assert.equal(detected[0]?.priority, "high");
  assert.equal(detected[0]?.replyAction?.endpoint, "/api/openclaw/replies");
  assert.equal(detected[0]?.replyAction?.method, "POST");
  assert.equal(detected[0]?.replyAction?.proposalId, "detected-sushi");
  assert.match(detected[0]?.body ?? "", /Tally spotted a possible reimbursement/);
  assert.match(detected[0]?.body ?? "", /\$84 at Sushi House/);
  assert.match(detected[0]?.body ?? "", /Reply yes\/no or a name/);
  assert.match(detected[0]?.body ?? "", /approval-gated/);
  assert.doesNotMatch(detected[0]?.body ?? "", /Want me to mark it/);
  assert.match(detected[0]?.replyAction?.prompt ?? "", /Treat \$84 at Sushi House as reimbursable/);
  assert.equal(outbox.safety.directFinanceWritesAllowed, false);
  assertAssistantContextSafe(outbox);
});

test("OpenClaw outbox does not double-surface candidates already asked as clarification questions", () => {
  const detectedMessages = buildOpenClawOutboxResponse(openClawSignalsFixture, {
    includeBudgetBriefing: false
  }).messages.filter((message) => message.kind === "reimbursement_detected");

  assert.equal(detectedMessages.length, 0);
});

test("OpenClaw outbox surfaces a pending monthly budget proposal as an approval-gated budget_proposal", () => {
  const signals = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  signals.openClarificationQuestions = [];
  signals.pendingProposals = [monthlyBudgetProposalSignal()];

  const outbox = buildOpenClawOutboxResponse(signals, {
    includeBudgetBriefing: false,
    minPriority: "high"
  });

  const proposals = outbox.messages.filter((message) => message.kind === "budget_proposal");
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.priority, "high");
  assert.match(proposals[0]?.body ?? "", /Tally budget proposal: July 2026 plan \$1,270 across 4 categories/);
  assert.match(proposals[0]?.body ?? "", /Top: Dining \$500, Groceries \$450, Rideshare \$200/);
  assert.doesNotMatch(proposals[0]?.body ?? "", /Entertainment/);
  assert.match(proposals[0]?.body ?? "", /Note: 2 open reviews could shift dining/);
  assert.match(proposals[0]?.body ?? "", /Reply approve to accept, or adjust a line like 'dining 450'/);
  assert.match(proposals[0]?.body ?? "", /Nothing changes until you confirm/);
  assert.equal(proposals[0]?.replyAction?.endpoint, "/api/openclaw/replies");
  assert.equal(proposals[0]?.replyAction?.method, "POST");
  assert.equal(proposals[0]?.replyAction?.proposalId, "budget-2026-07");
  assert.match(proposals[0]?.replyAction?.prompt ?? "", /Approve the July 2026 budget \(\$1,270\) or reply with adjustments/);
  assert.equal(outbox.safety.directFinanceWritesAllowed, false);
  assertAssistantContextSafe(outbox);
});

test("OpenClaw outbox emits at most one budget proposal and skips unparseable ones", () => {
  const signals = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  signals.openClarificationQuestions = [];
  signals.pendingProposals = [
    monthlyBudgetProposalSignal({ id: "budget-empty", proposedPatch: { categories: [], month: "2026-07" } }),
    monthlyBudgetProposalSignal({ id: "budget-first" }),
    monthlyBudgetProposalSignal({ id: "budget-second" })
  ];

  const proposals = buildOpenClawOutboxResponse(signals, {
    includeBudgetBriefing: false,
    messageLimit: 10
  }).messages.filter((message) => message.kind === "budget_proposal");

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.replyAction?.proposalId, "budget-first");
});

test("budget proposal copy is capped and never leaks secret-looking evidence", () => {
  const signals = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  signals.openClarificationQuestions = [];
  signals.pendingProposals = [
    monthlyBudgetProposalSignal({
      evidence: {
        rawProviderPayload: "access-production-0123456789abcdef",
        secretNote: "ssn 123-45-6789 token sk-proj-abcdefghijklmnopqrstuvwx",
        uncertaintyNotes: [
          "token sk-proj-abcdefghijklmnopqrstuvwx leaked into a note",
          `dining history is short ${"and noisy ".repeat(40)}`,
          "reimbursements are still settling",
          "third note beyond the cap"
        ]
      },
      proposedPatch: {
        categories: [
          { amount: 900, label: `Groceries ${"plus a very long label tail ".repeat(8)}` },
          { amount: 800, label: "sk-proj-abcdefghijklmnopqrstuvwx" },
          { amount: 700, label: "Dining" },
          { amount: 600, label: "Dining" },
          { amount: -50.4, label: "Rideshare" }
        ],
        month: "not-a-month"
      }
    })
  ];

  const outbox = buildOpenClawOutboxResponse(signals, { includeBudgetBriefing: false });
  const proposal = outbox.messages.find((message) => message.kind === "budget_proposal");

  assert.ok(proposal);
  assert.ok(proposal.body.length <= 320);
  assert.match(proposal.body, /next month plan/);
  assert.doesNotMatch(proposal.body, /sk-proj-|access-production-|123-45-6789|leaked into a note|third note beyond the cap/i);
  assert.doesNotMatch(proposal.replyAction?.prompt ?? "", /sk-proj-|access-production-/i);
  assertAssistantContextSafe(outbox);
});

test("budget proposal mentions calendar pressure only when present in proposal evidence", () => {
  const now = new Date(OUTBOX_GENERATED_AT);
  const busyCalendar = buildUpcomingCalendarContext(
    [
      { allDay: true, end: "2026-05-17", location: "SFO Airport", start: "2026-05-16", title: "Flight to Phoenix" },
      { allDay: false, end: "2026-05-17T18:00:00.000Z", location: "Phoenix, AZ", start: "2026-05-17T15:00:00.000Z", title: "Hotel check-in" }
    ],
    { generatedAt: OUTBOX_GENERATED_AT, now }
  );

  const withoutEvidence = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  withoutEvidence.openClarificationQuestions = [];
  withoutEvidence.calendarContext = busyCalendar;
  withoutEvidence.pendingProposals = [monthlyBudgetProposalSignal()];
  const quietBody = buildOpenClawOutboxResponse(withoutEvidence, { includeBudgetBriefing: false })
    .messages.find((message) => message.kind === "budget_proposal")?.body ?? "";

  assert.doesNotMatch(quietBody, /Calendar pressure/i);
  assert.doesNotMatch(quietBody, /Phoenix|SFO|Flight|Hotel/i);

  const withEvidence = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  withEvidence.openClarificationQuestions = [];
  withEvidence.pendingProposals = [
    monthlyBudgetProposalSignal({
      evidence: {
        calendarPressure: {
          categories: ["travel", "dining", "not-an-allowed-category"],
          level: "high"
        }
      }
    })
  ];
  const outbox = buildOpenClawOutboxResponse(withEvidence, { includeBudgetBriefing: false });
  const body = outbox.messages.find((message) => message.kind === "budget_proposal")?.body ?? "";

  assert.match(body, /Calendar pressure high \(travel and dining ahead\)/);
  assert.doesNotMatch(body, /not-an-allowed-category/);
  assertAssistantContextSafe(outbox);
});

test("budget-threshold and reimbursement-detected nudges never leak seeded secret-looking data", () => {
  const signals = structuredClone(openClawSignalsFixture) as OpenClawSignalsResponse;
  signals.openClarificationQuestions = [];
  signals.pendingProposals = [
    pendingProposalSignal({
      id: "detected-secret",
      evidence: {
        transaction: {
          amount: -120,
          date: "2026-05-11",
          merchant: "Sushi House"
        },
        secretNote: "ssn 123-45-6789 token sk-proj-abcdefghijklmnopqrstuvwx",
        rawProviderPayload: "access-production-0123456789abcdef"
      }
    })
  ];

  const outbox = buildOpenClawOutboxResponse(signals, {
    includeBudgetBriefing: false,
    budgetGuardrails: guardrailSummary([
      {
        budgetAmount: 500,
        currentAmount: 460,
        id: "cat-dining",
        label: "Dining",
        openReviewCount: 0,
        percentUsed: 92,
        projectedAmount: 1100,
        projectedPercent: 220,
        remainingAmount: 40,
        status: "near",
        transactionCount: 11,
        trustedAmount: 460,
        unresolvedReviewAmount: 0
      }
    ])
  });

  const bodies = outbox.messages.map((message) => message.body).join(" ");
  assert.doesNotMatch(bodies, /123-45-6789|sk-proj-|access-production-|secretNote|rawProviderPayload|ssn/i);
  assertAssistantContextSafe(outbox);
});
