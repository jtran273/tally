import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiProviderStatus } from "@/lib/ai/server";
import type { AccountRecord, RecurringExpenseRecord, ReviewQueueItem, TransactionRecord } from "@/lib/db";
import type { PlaidConnectionSummary } from "@/lib/plaid/service";
import { buildFirstRunChecklist } from "./first-run-checklist";

const aiFallback: AiProviderStatus = {
  activeKind: "mock",
  configured: false,
  label: "Deterministic fallback",
  model: null,
  summary: "Fallback suggestions are active."
};

const aiOpenAi: AiProviderStatus = {
  activeKind: "openai",
  configured: true,
  label: "OpenAI",
  model: "gpt-test",
  summary: "OpenAI suggestions are available."
};

const connection: PlaidConnectionSummary = {
  availableProducts: ["transactions"],
  billedProducts: ["transactions"],
  consentExpiresAt: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  errorCode: null,
  errorMessage: null,
  id: "item-1",
  institutionId: "inst-1",
  institutionName: "Test Bank",
  issue: null,
  lastSuccessfulSyncAt: "2026-05-06T00:00:00.000Z",
  plaidInstitutionId: "ins_test",
  plaidItemId: "plaid-item-1",
  status: "active",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

const account = { id: "account-1" } as AccountRecord;
const transaction = { id: "transaction-1" } as TransactionRecord;
const reviewItem = { id: "review-1" } as ReviewQueueItem;

function recurring(status: RecurringExpenseRecord["status"]) {
  return { id: `recurring-${status}`, status } as RecurringExpenseRecord;
}

function build(overrides: Partial<Parameters<typeof buildFirstRunChecklist>[0]> = {}) {
  return buildFirstRunChecklist({
    accounts: [],
    aiProviderStatus: aiFallback,
    isConfigured: true,
    isDemo: false,
    isSignedIn: false,
    plaidConnections: [],
    recurringExpenses: [],
    reviewItems: [],
    transactions: [],
    ...overrides
  });
}

describe("buildFirstRunChecklist", () => {
  it("blocks finance setup until the workspace can load a signed-in session", () => {
    const summary = build({ isConfigured: false });

    assert.equal(summary.completedFinanceItems, 0);
    assert.deepEqual(summary.items.map((item) => item.status), [
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "optional"
    ]);
  });

  it("marks imported data complete while leaving review and recurring work current", () => {
    const summary = build({
      accounts: [account],
      isSignedIn: true,
      plaidConnections: [connection],
      recurringExpenses: [recurring("pending")],
      reviewItems: [reviewItem],
      transactions: [transaction]
    });

    assert.equal(summary.completedFinanceItems, 3);
    assert.equal(summary.items.find((item) => item.id === "review")?.status, "current");
    assert.equal(summary.items.find((item) => item.id === "recurring")?.status, "current");
  });

  it("keeps AI provider setup optional and outside finance progress", () => {
    const summary = build({
      accounts: [account],
      aiProviderStatus: aiOpenAi,
      isSignedIn: true,
      plaidConnections: [connection],
      recurringExpenses: [recurring("active")],
      transactions: [transaction]
    });

    assert.equal(summary.completedFinanceItems, 5);
    assert.equal(summary.financeItems, 5);
    assert.equal(summary.items.find((item) => item.id === "ai")?.status, "complete");
  });
});
