import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantContextSafe } from "@/lib/agents";
import { openClawSignalsFixture } from "@/lib/agents/openclaw-fixtures";
import type { OpenClawSignalsResponse } from "./types";
import { buildOpenClawOutboxResponse } from "./outbox";

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
