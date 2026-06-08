import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantContextSafe, buildWeeklyPlanningContext } from "@/lib/agents";
import { openClawSignalsFixture } from "@/lib/agents/openclaw-fixtures";
import { buildUpcomingCalendarContext, type CalendarEventInput } from "@/lib/calendar";
import type { ReviewQueueItem, TransactionRecord } from "@/lib/db";
import {
  buildOpenClawRecentTransactionsResponse,
  buildOpenClawReimbursementsResponse,
  buildOpenClawReviewItemsResponse,
  buildOpenClawSafeToSpendResponse,
  parseOpenClawLimit,
  parseSafeToSpendAmount
} from "./finance-read-api";
import { buildOpenClawSignalsResponse } from "./signals";

const SIGNALS_GENERATED_AT = "2026-05-13T12:00:00.000Z";

function signalsWithCalendar(events: CalendarEventInput[]) {
  const now = new Date(SIGNALS_GENERATED_AT);
  return buildOpenClawSignalsResponse({
    generatedAt: SIGNALS_GENERATED_AT,
    calendarContext: buildUpcomingCalendarContext(events, { generatedAt: SIGNALS_GENERATED_AT, now }),
    openClarificationProposals: [],
    pendingProposals: [],
    since: "2026-05-12T12:00:00.000Z",
    weeklyPlanningContext: buildWeeklyPlanningContext({
      generatedAt: SIGNALS_GENERATED_AT,
      now,
      transactions: []
    })
  });
}

function transaction(input: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: "tx-1",
    accountId: "account-1",
    accountName: "Checking",
    accountMask: "1234",
    amount: -42.5,
    category: "Food",
    categoryId: "category-food",
    confidence: 0.9,
    date: "2026-05-21",
    institutionName: "Bank",
    intent: "personal",
    merchant: "Cafe",
    note: "",
    plaidCategory: null,
    plaidTransactionId: null,
    plaidMerchant: null,
    plaidName: null,
    rawTransactionId: "raw-tx-1",
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId: "user-1",
    ...input
  };
}

function reviewItem(input: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: "review-1",
    createdAt: "2026-05-21T12:00:00.000Z",
    aiSuggestion: {},
    confidence: 0.42,
    explanation: "Needs category confirmation.",
    reason: "low-confidence",
    resolutionNote: null,
    resolutionKind: null,
    resolvedAt: null,
    status: "open",
    transaction: transaction(),
    transactionId: "tx-1",
    ...input
  };
}

test("recent transaction response exposes only safe transaction fields", () => {
  const response = buildOpenClawRecentTransactionsResponse([transaction()], {
    generatedAt: "2026-05-21T12:00:00.000Z",
    limit: 5
  });
  const serialized = JSON.stringify(response);

  assert.equal(response.object, "ledger.openclaw.recent_transactions");
  assert.equal(response.transactions[0]?.accountNickname, "Checking");
  assert.equal("accountMask" in response.transactions[0]!, false);
  assert.doesNotMatch(serialized, /1234|raw_payload|plaid_transaction|access_token|service_role/i);
  assertAssistantContextSafe(response);
});

test("recent transaction response redacts secret-shaped display text", () => {
  const response = buildOpenClawRecentTransactionsResponse([
    transaction({
      accountName: "Checking Bearer abcdefghijklmnop",
      merchant: "Cafe access-production-abcdefghijkl"
    })
  ], {
    generatedAt: "2026-05-21T12:00:00.000Z",
    limit: 5
  });

  assert.equal(response.transactions[0]?.accountNickname, "Checking [redacted]");
  assert.equal(response.transactions[0]?.merchant, "Cafe [redacted]");
  assert.doesNotMatch(JSON.stringify(response), /Bearer|access-production-abcdefghijkl/);
  assertAssistantContextSafe(response);
});

test("review items response summarizes open review queue", () => {
  const response = buildOpenClawReviewItemsResponse([
    reviewItem(),
    reviewItem({ id: "review-closed", status: "resolved" })
  ], { limit: 5 });

  assert.equal(response.object, "ledger.openclaw.review_items");
  assert.equal(response.openCount, 1);
  assert.deepEqual(response.items.map((item) => item.id), ["review-1"]);
  assertAssistantContextSafe(response);
});

test("review items response redacts secret-shaped explanation and merchant text", () => {
  const response = buildOpenClawReviewItemsResponse([
    reviewItem({
      explanation: "Needs check service_role_key=abcdefghijkl",
      transaction: transaction({
        merchant: "Coffee sk-proj-abcdefghijklmnopqrst"
      })
    })
  ], { limit: 5 });

  assert.equal(response.items[0]?.explanation, "Needs check [redacted]");
  assert.equal(response.items[0]?.merchant, "Coffee [redacted]");
  assert.doesNotMatch(JSON.stringify(response), /service_role_key|sk-proj-abcdefghijklmnopqrst/);
  assertAssistantContextSafe(response);
});

test("reimbursements response surfaces outstanding reimbursable transactions", () => {
  const response = buildOpenClawReimbursementsResponse([
    transaction({
      id: "tx-dinner",
      amount: -80,
      intent: "reimbursable",
      merchant: "Dinner",
      reimbursements: [
        {
          counterparty: "Alex",
          dueDate: null,
          expectedAmount: 50,
          id: "reimb-alex",
          notes: null,
          receivedAmount: 10,
          receivedAt: "2026-05-08",
          receivedTransactionId: "tx-venmo",
          splitId: null,
          status: "requested",
          transactionId: "tx-dinner"
        }
      ]
    }),
    transaction({ id: "tx-normal" })
  ], { limit: 5 });

  assert.equal(response.object, "ledger.openclaw.reimbursements");
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.outstandingAmount, 40);
  assert.deepEqual(response.items[0]?.records, [
    {
      counterparty: "Alex",
      dueDate: null,
      expectedAmount: 50,
      outstandingAmount: 40,
      receivedAmount: 10,
      receivedAt: "2026-05-08",
      status: "requested"
    }
  ]);
  assert.equal(response.summary.outstandingAmount, 40);
  assert.equal(response.pageSummary.outstandingAmount, 40);
  assertAssistantContextSafe(response);
});

test("reimbursements response redacts secret-shaped merchant and counterparty text", () => {
  const response = buildOpenClawReimbursementsResponse([
    transaction({
      amount: -80,
      intent: "reimbursable",
      merchant: "Dinner postgres://secret.example/db",
      reimbursements: [
        {
          counterparty: "Ryan Bearer abcdefghijklmnop",
          dueDate: null,
          expectedAmount: 80,
          id: "reimb-ryan",
          notes: null,
          receivedAmount: 0,
          receivedAt: null,
          receivedTransactionId: null,
          splitId: null,
          status: "expected",
          transactionId: "tx-1"
        }
      ]
    })
  ], { limit: 5 });

  assert.equal(response.items[0]?.merchant, "Dinner [redacted]");
  assert.equal(response.items[0]?.records[0]?.counterparty, "Ryan [redacted]");
  assert.doesNotMatch(JSON.stringify(response), /postgres:\/\/secret\.example\/db|Bearer abcdefghijklmnop/);
  assertAssistantContextSafe(response);
});

test("reimbursements response summary covers transactions beyond the page limit", () => {
  const response = buildOpenClawReimbursementsResponse([
    transaction({
      id: "tx-large",
      amount: -120,
      intent: "reimbursable",
      merchant: "Group Hotel"
    }),
    transaction({
      id: "tx-small",
      amount: -40,
      intent: "reimbursable",
      merchant: "Rideshare"
    })
  ], { limit: 1 });

  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.transactionId, "tx-large");
  assert.equal(response.pageSummary.outstandingAmount, 120);
  assert.equal(response.summary.outstandingAmount, 160);
  assertAssistantContextSafe(response);
});

test("safe-to-spend response is bounded and explainable", () => {
  const response = buildOpenClawSafeToSpendResponse(openClawSignalsFixture, { amount: 80 });

  assert.equal(response.object, "ledger.openclaw.safe_to_spend");
  assert.equal(response.amount, 80);
  assert.match(response.rationale, /\$80/);
  assertAssistantContextSafe(response);
});

test("safe-to-spend stays green with a clear calendar and softens under calendar pressure", () => {
  const quiet = buildOpenClawSafeToSpendResponse(signalsWithCalendar([]), { amount: 200 });
  assert.equal(quiet.status, "green");
  assert.equal(quiet.summary.calendarPressure, "none");
  assert.equal(quiet.summary.calendarPlannedSpendEvents, 0);
  assert.doesNotMatch(quiet.rationale, /calendar/i);

  const busy = buildOpenClawSafeToSpendResponse(
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
    ]),
    { amount: 200 }
  );

  // Same finance numbers, identical query amount — only the calendar changed.
  assert.equal(busy.status, "yellow");
  assert.equal(busy.summary.calendarPressure, "high");
  assert.match(busy.rationale, /calendar may add planned spend/i);
  assert.match(busy.rationale, /travel/);
  assertAssistantContextSafe(busy);
});

test("safe-to-spend never exposes raw calendar event details", () => {
  const response = buildOpenClawSafeToSpendResponse(
    signalsWithCalendar([
      {
        allDay: false,
        end: "2026-05-15T03:00:00.000Z",
        location: "123 Market St, San Francisco https://meet.google.com/abc-defg-hij",
        start: "2026-05-15T01:00:00.000Z",
        title: "Dinner with alex@example.com about secret-project-orion"
      }
    ]),
    { amount: 50 }
  );
  const serialized = JSON.stringify(response);

  assert.doesNotMatch(serialized, /alex@example\.com/);
  assert.doesNotMatch(serialized, /123 Market St|Market St/);
  assert.doesNotMatch(serialized, /meet\.google\.com|https?:\/\//);
  assert.doesNotMatch(serialized, /secret-project-orion|Dinner with/);
  assertAssistantContextSafe(response);
});

test("OpenClaw read parsers validate bounded inputs", () => {
  assert.equal(parseOpenClawLimit("5"), 5);
  assert.equal(parseOpenClawLimit(null), 5);
  assert.throws(() => parseOpenClawLimit("26"), /limit/);
  assert.equal(parseSafeToSpendAmount("80.555"), 80.56);
  assert.equal(parseSafeToSpendAmount(null), null);
  assert.throws(() => parseSafeToSpendAmount("-1"), /amount/);
});
