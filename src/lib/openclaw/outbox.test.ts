import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantContextSafe } from "@/lib/agents";
import { openClawSignalsFixture } from "@/lib/agents/openclaw-fixtures";
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
