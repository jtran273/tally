import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuditEventRow } from "@/lib/db";
import {
  actionGroup,
  actionLabel,
  countByGroup,
  entityLabel,
  formatAuditEvent,
  shortenId,
  summarizeData
} from "./format";

function row(overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: "ev-1",
    user_id: "user-1",
    entity_table: "review_items",
    entity_id: "00000000-0000-0000-0000-000000000123",
    action: "review.suggestion_accepted",
    actor_id: null,
    before_data: null,
    after_data: null,
    metadata: {},
    created_at: "2026-05-18T10:00:00Z",
    ...overrides
  };
}

test("actionGroup classifies known action prefixes", () => {
  assert.equal(actionGroup("review.dismissed"), "review");
  assert.equal(actionGroup("merchant_rule.learned_from_edit"), "merchant-rule");
  assert.equal(actionGroup("agent_proposal.accepted"), "agent-proposal");
  assert.equal(actionGroup("recurring.candidate_confirmed"), "recurring");
  assert.equal(actionGroup("reimbursement.inflow_linked"), "reimbursement");
  assert.equal(actionGroup("plaid.item_disconnected"), "plaid");
  assert.equal(actionGroup("ledger_seed_loaded"), "seed-demo");
  assert.equal(actionGroup("something.else"), "other");
});

test("actionLabel returns curated label or humanizes tail", () => {
  assert.equal(actionLabel("review.suggestion_accepted"), "AI suggestion accepted");
  assert.equal(actionLabel("custom.module.frobnicate_widget"), "Frobnicate widget");
});

test("entityLabel maps known tables and falls back to humanized", () => {
  assert.equal(entityLabel("review_items"), "Review item");
  assert.equal(entityLabel("custom_widgets"), "Custom widgets");
});

test("shortenId trims long UUIDs", () => {
  assert.equal(shortenId(null), "—");
  assert.equal(shortenId("00000000-0000-0000-0000-000000000123"), "00000000");
  assert.equal(shortenId("abc"), "abc");
});

test("summarizeData drops sensitive keys and raw payloads", () => {
  const summary = summarizeData({
    merchantName: "Coffee Co",
    access_token: "should-be-hidden",
    secret: "nope",
    raw_payload: { foo: "bar" },
    plaid_access_token: "x",
    authorization: "Bearer y"
  });
  const keys = summary.map((entry) => entry.key);
  assert.ok(keys.includes("merchantName"));
  assert.ok(!keys.some((k) => k.includes("access_token")));
  assert.ok(!keys.some((k) => k.includes("secret")));
  assert.ok(!keys.some((k) => k.includes("raw_payload")));
  assert.ok(!keys.some((k) => k.includes("authorization")));
});

test("summarizeData formats arrays and nested objects safely", () => {
  const summary = summarizeData({
    accounts: 9,
    transactions: 44,
    appliedPatch: { merchantName: "Aldi", confidence: 0.92 }
  });
  const accounts = summary.find((entry) => entry.key === "accounts");
  assert.equal(accounts?.value, "9");
  const merchant = summary.find((entry) => entry.key === "appliedPatch.merchantName");
  assert.equal(merchant?.value, "Aldi");
});

test("summarizeData caps long strings and entry count", () => {
  const long = "x".repeat(120);
  const summary = summarizeData({ merchantName: long });
  const merchant = summary.find((entry) => entry.key === "merchantName");
  assert.ok(merchant && merchant.value.length <= 80);

  const bulky: Record<string, string> = {};
  for (let i = 0; i < 20; i += 1) {
    bulky[`merchantName${i}`] = `value-${i}`;
  }
  const wide = summarizeData(bulky);
  assert.ok(wide.length <= 8);
});

test("formatAuditEvent normalizes the row for display", () => {
  const display = formatAuditEvent(
    row({
      action: "review.suggestion_accepted",
      after_data: { merchantName: "Coffee Co", confidence: 0.91, access_token: "hidden" }
    })
  );
  assert.equal(display.group, "review");
  assert.equal(display.groupLabel, "Review");
  assert.equal(display.actionLabel, "AI suggestion accepted");
  assert.equal(display.entityLabel, "Review item");
  assert.equal(display.entityIdShort, "00000000");
  const keys = display.after.map((entry) => entry.key);
  assert.ok(keys.includes("merchantName"));
  assert.ok(!keys.some((k) => k.includes("access_token")));
});

test("countByGroup tallies events by group", () => {
  const counts = countByGroup([
    row({ action: "review.suggestion_accepted" }),
    row({ id: "ev-2", action: "review.dismissed" }),
    row({ id: "ev-3", action: "merchant_rule.learned_from_edit" }),
    row({ id: "ev-4", action: "ledger_seed_loaded", entity_table: "seed" })
  ]);
  assert.equal(counts.review, 2);
  assert.equal(counts["merchant-rule"], 1);
  assert.equal(counts["seed-demo"], 1);
  assert.equal(counts.plaid, 0);
});
