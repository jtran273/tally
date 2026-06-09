import assert from "node:assert/strict";
import test from "node:test";
import { createMockSuggestionAdapter } from "@/lib/ai";
import { TransactionSuggestionService } from "@/lib/ai/suggestion-service";
import type { ReimbursementCandidateAiRequest } from "@/lib/ai/types";
import type { AgentProposalRecord, AgentProposalRow, TransactionRecord } from "@/lib/db";
import type { FinanceSupabaseClient } from "@/lib/db/queries";
import {
  createDetectedReimbursementCandidateProposals,
  detectReimbursementCandidateProposals,
  prefilterReimbursementCandidates
} from "./reimbursement-candidates";

const userId = "11111111-1111-1111-1111-111111111111";
const suggestionService = new TransactionSuggestionService(createMockSuggestionAdapter());

function transaction(input: Partial<TransactionRecord> & Pick<TransactionRecord, "amount" | "date" | "id" | "merchant">): TransactionRecord {
  const { date, id, merchant, ...rest } = input;
  return {
    accountId: "account-1",
    accountMask: "1111",
    accountName: "Checking",
    category: "Food / Restaurants",
    categoryId: "cat-food",
    confidence: 0.82,
    date,
    id,
    institutionName: "Demo Bank",
    intent: "personal",
    merchant,
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidName: null,
    plaidTransactionId: null,
    rawTransactionId: `raw-${id}`,
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems: [],
    reviewReason: null,
    reviewStatus: null,
    splits: [],
    status: "posted",
    userId,
    ...rest
  };
}

function existingProposal(input: Partial<AgentProposalRecord> & Pick<AgentProposalRecord, "targetId">): AgentProposalRecord {
  return {
    acceptedAt: null,
    answeredAt: null,
    clarificationAnswer: null,
    clarificationAnswerKind: null,
    clarificationQuestion: "Was this reimbursable?",
    confidence: 0.72,
    createdAt: "2026-05-13T08:00:00.000Z",
    dismissedAt: null,
    evidence: {},
    expiresAt: null,
    id: "proposal-existing",
    proposalType: "reimbursement_candidate",
    proposedPatch: {},
    questionFingerprint: "fingerprint",
    sourceAgent: "ledger-reimbursement-candidate-detector",
    sourceCandidateId: null,
    sourceContextId: null,
    status: "pending",
    targetKind: "enriched_transaction",
    updatedAt: "2026-05-13T08:00:00.000Z",
    userId,
    ...input
  };
}

function proposalUpsertClient() {
  const rows: AgentProposalRow[] = [];

  return {
    rows,
    client: {
      from(table: string) {
        assert.equal(table, "agent_proposals");

        return {
          upsert(value: Partial<AgentProposalRow>, options?: { onConflict?: string }) {
            assert.equal(options?.onConflict, "user_id,source_agent,source_context_id");

            return {
              select() {
                return this;
              },
              single() {
                const now = "2026-05-13T08:00:00.000Z";
                const existing = rows.find((row) =>
                  row.user_id === value.user_id &&
                  row.source_agent === value.source_agent &&
                  row.source_context_id === value.source_context_id
                );

                if (existing) {
                  Object.assign(existing, value, { updated_at: value.updated_at ?? now });
                  return Promise.resolve({ data: existing, error: null });
                }

                const row = {
                  accepted_at: null,
                  answered_at: null,
                  clarification_answer: null,
                  clarification_answer_kind: null,
                  created_at: now,
                  dismissed_at: null,
                  id: `proposal-${rows.length + 1}`,
                  status: "pending",
                  updated_at: value.updated_at ?? now,
                  ...value
                } as AgentProposalRow;
                rows.push(row);
                return Promise.resolve({ data: row, error: null });
              }
            };
          }
        };
      }
    } as unknown as FinanceSupabaseClient
  };
}

test("prefilterReimbursementCandidates ranks likely shared expenses and nearby peer inflows", () => {
  const dinner = transaction({
    amount: -182.44,
    date: "2026-05-04",
    id: "tx-dinner",
    merchant: "State Bird Provisions"
  });
  const smallCoffee = transaction({
    amount: -6.5,
    date: "2026-05-04",
    id: "tx-coffee",
    merchant: "Coffee Bar"
  });
  const payroll = transaction({
    amount: 4200,
    category: "Income",
    date: "2026-05-08",
    id: "tx-payroll",
    merchant: "Payroll"
  });
  const venmo = transaction({
    amount: 91.22,
    category: "Uncategorized",
    date: "2026-05-06",
    id: "tx-venmo",
    merchant: "Venmo Maya R"
  });

  const candidates = prefilterReimbursementCandidates([dinner, smallCoffee, payroll], [venmo]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].transaction.id, "tx-dinner");
  assert.deepEqual(candidates[0].candidateInflows.map((inflow) => inflow.id), ["tx-venmo"]);
  assert(candidates[0].reasons.some((reason) => reason.includes("Nearby positive inflow")));
});

test("prefilterReimbursementCandidates ignores inflows that cover a negligible fraction of the expense", () => {
  const airbnb = transaction({
    amount: -1628.56,
    category: "Travel / Lodging",
    date: "2026-02-22",
    id: "tx-airbnb",
    merchant: "Airbnb"
  });
  const tinyRefund = transaction({
    amount: 32.31,
    category: "Shopping",
    date: "2026-03-02",
    id: "tx-amazon",
    merchant: "Amazon"
  });

  const candidates = prefilterReimbursementCandidates([airbnb], [tinyRefund]);

  // The expense may still surface for review, but the $32 inflow is far too
  // small (2% of the stay) to be offered as a reimbursement match.
  const airbnbCandidate = candidates.find((candidate) => candidate.transaction.id === "tx-airbnb");
  assert.deepEqual(airbnbCandidate?.candidateInflows ?? [], []);
  assert(!(airbnbCandidate?.reasons ?? []).some((reason) => reason.includes("Nearby positive inflow")));
});

test("prefilterReimbursementCandidates keeps peer-payment inflows the bank tagged as transfers", () => {
  const hotel = transaction({
    amount: -288.94,
    category: "Travel / Lodging",
    date: "2026-04-24",
    id: "tx-hotel",
    merchant: "La Quinta Inns & Suites"
  });
  // Zelle reimbursement for a shared room, but the bank auto-classified the
  // deposit as a transfer — the most common reason a true match is missed.
  const zelle = transaction({
    amount: 144.5,
    category: "Transfer",
    date: "2026-04-26",
    id: "tx-zelle",
    intent: "transfer",
    merchant: "Zelle payment from Jordan"
  });

  const candidates = prefilterReimbursementCandidates([hotel], [zelle]);

  const hotelCandidate = candidates.find((candidate) => candidate.transaction.id === "tx-hotel");
  assert.deepEqual(hotelCandidate?.candidateInflows.map((inflow) => inflow.id) ?? [], ["tx-zelle"]);
});

test("prefilterReimbursementCandidates excludes already linked reimbursement inflows", () => {
  const dinner = transaction({
    amount: -182.44,
    date: "2026-05-04",
    id: "tx-dinner",
    merchant: "State Bird Provisions"
  });
  const linkedVenmo = transaction({
    amount: 91.22,
    category: "Uncategorized",
    date: "2026-05-06",
    id: "tx-linked-venmo",
    intent: "reimbursable",
    merchant: "Venmo Maya R"
  });
  const availablePaypal = transaction({
    amount: 91.22,
    category: "Uncategorized",
    date: "2026-05-07",
    id: "tx-paypal",
    merchant: "PayPal Alex"
  });

  const candidates = prefilterReimbursementCandidates([dinner], [linkedVenmo, availablePaypal]);

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].candidateInflows.map((inflow) => inflow.id), ["tx-paypal"]);
});

test("prefilterReimbursementCandidates excludes Income-category deposits", () => {
  const hotel = transaction({
    amount: -900,
    category: "Travel / Hotel",
    date: "2026-05-04",
    id: "tx-hotel",
    merchant: "Ace Hotel"
  });
  const employerDeposit = transaction({
    amount: 4200,
    category: "Income",
    date: "2026-05-06",
    id: "tx-ach-income",
    merchant: "ACME INC"
  });

  const candidates = prefilterReimbursementCandidates([hotel], [employerDeposit]);

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].candidateInflows, []);
});

test("detectReimbursementCandidateProposals returns safe proposal payloads from the mock provider", async () => {
  const expense = transaction({
    amount: -240,
    category: "Travel / Hotel",
    date: "2026-05-01",
    id: "tx-hotel",
    merchant: "Ace Hotel"
  });
  const inflow = transaction({
    amount: 120,
    category: "Uncategorized",
    date: "2026-05-05",
    id: "tx-zelle",
    merchant: "Zelle Transfer Alex"
  });

  const detections = await detectReimbursementCandidateProposals({
    inflows: [inflow],
    suggestionService,
    transactions: [expense]
  });

  assert.equal(detections.length, 1);
  const proposal = detections[0].proposal;
  assert.equal(proposal.proposalType, "reimbursement_candidate");
  assert.equal(proposal.targetId, "tx-hotel");
  assert.equal(proposal.targetKind, "enriched_transaction");
  assert.equal(proposal.sourceAgent, "ledger-reimbursement-candidate-detector");
  assert.equal(proposal.sourceContextId, "reimbursement-candidate:tx-hotel");
  assert.equal(proposal.confidence! > 0.6, true);
  assert.equal(typeof proposal.clarificationQuestion, "string");
  assert.match(proposal.clarificationQuestion ?? "", /Ace Hotel/);
  assert.deepEqual((detections[0].proposedPatch as { suggestedInflowIds?: string[] }).suggestedInflowIds, ["tx-zelle"]);
});

test("detectReimbursementCandidateProposals keeps suggested inflows scoped to candidate inflows", async () => {
  const expense = transaction({
    amount: -240,
    category: "Travel / Hotel",
    date: "2026-05-01",
    id: "tx-hotel",
    merchant: "Ace Hotel"
  });
  const inflow = transaction({
    amount: 120,
    category: "Uncategorized",
    date: "2026-05-05",
    id: "tx-zelle",
    merchant: "Zelle Transfer Alex"
  });
  const noisyProvider = {
    async suggestReimbursementCandidate(
      request: ReimbursementCandidateAiRequest
    ) {
      return {
        confidence: 0.72,
        provider: {
          id: "test-provider",
          kind: "mock" as const,
          label: "Test provider",
          version: "test"
        },
        question: `Was ${request.transaction.merchant} shared?`,
        reason: "Test provider response.",
        signals: ["test"],
        suggestedInflowIds: ["tx-zelle", "tx-not-in-request", "tx-zelle"],
        suggestedIntent: "shared" as const,
        suggestionId: `test-${request.transaction.id}`,
        targetTransactionId: request.transaction.id
      };
    }
  };

  const detections = await detectReimbursementCandidateProposals({
    inflows: [inflow],
    suggestionService: noisyProvider,
    transactions: [expense]
  });

  assert.equal(detections.length, 1);
  assert.deepEqual(detections[0].aiSuggestion.suggestedInflowIds, ["tx-zelle"]);
  assert.deepEqual((detections[0].proposedPatch as { suggestedInflowIds?: string[] }).suggestedInflowIds, ["tx-zelle"]);
});

test("createDetectedReimbursementCandidateProposals upserts by source context for overlapping scans", async () => {
  const { client, rows } = proposalUpsertClient();
  const expense = transaction({
    amount: -240,
    category: "Travel / Hotel",
    date: "2026-05-01",
    id: "tx-hotel",
    merchant: "Ace Hotel"
  });
  const inflow = transaction({
    amount: 120,
    category: "Uncategorized",
    date: "2026-05-05",
    id: "tx-zelle",
    merchant: "Zelle Transfer Alex"
  });
  const input = {
    existingProposals: [],
    inflows: [inflow],
    suggestionService,
    transactions: [expense]
  };

  const first = await createDetectedReimbursementCandidateProposals(client, userId, input);
  const second = await createDetectedReimbursementCandidateProposals(client, userId, input);

  assert.equal(rows.length, 1);
  assert.equal(first[0].id, second[0].id);
  assert.equal(rows[0].source_context_id, "reimbursement-candidate:tx-hotel");
});

test("detectReimbursementCandidateProposals limits concurrent provider calls", async () => {
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const delayedService = {
    async suggestReimbursementCandidate(request: ReimbursementCandidateAiRequest) {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeCalls -= 1;

      return {
        confidence: 0.72,
        provider: {
          id: "test-provider",
          kind: "mock" as const,
          label: "Test provider",
          version: "test"
        },
        question: `Was ${request.transaction.merchant} shared?`,
        reason: "Test provider response.",
        signals: ["test"],
        suggestedInflowIds: request.candidateInflows.map((inflow) => inflow.id).slice(0, 1),
        suggestedIntent: "shared" as const,
        suggestionId: `test-${request.transaction.id}`,
        targetTransactionId: request.transaction.id
      };
    }
  };
  const expenses = [1, 2, 3].map((index) => transaction({
    amount: -100 - index,
    date: "2026-05-04",
    id: `tx-dinner-${index}`,
    merchant: `Dinner ${index}`
  }));
  const inflows = [1, 2, 3].map((index) => transaction({
    amount: 50,
    category: "Uncategorized",
    date: "2026-05-06",
    id: `tx-venmo-${index}`,
    merchant: `Venmo Friend ${index}`
  }));

  const detections = await detectReimbursementCandidateProposals({
    inflows,
    maxAiConcurrency: 2,
    suggestionService: delayedService,
    transactions: expenses
  });

  assert.equal(detections.length, 3);
  assert.equal(maxActiveCalls, 2);
});

test("detectReimbursementCandidateProposals dedupes active existing proposals by target transaction", async () => {
  const expense = transaction({
    amount: -182.44,
    date: "2026-05-04",
    id: "tx-dinner",
    merchant: "State Bird Provisions"
  });
  const venmo = transaction({
    amount: 91.22,
    category: "Uncategorized",
    date: "2026-05-06",
    id: "tx-venmo",
    merchant: "Venmo Maya R"
  });

  const detections = await detectReimbursementCandidateProposals({
    existingProposals: [existingProposal({ targetId: "tx-dinner" })],
    inflows: [venmo],
    suggestionService,
    transactions: [expense]
  });

  assert.equal(detections.length, 0);
});

test("detectReimbursementCandidateProposals ignores dynamically expired pending proposals", async () => {
  const expense = transaction({
    amount: -182.44,
    date: "2026-05-04",
    id: "tx-dinner",
    merchant: "State Bird Provisions"
  });
  const venmo = transaction({
    amount: 91.22,
    category: "Uncategorized",
    date: "2026-05-06",
    id: "tx-venmo",
    merchant: "Venmo Maya R"
  });

  const detections = await detectReimbursementCandidateProposals({
    existingProposals: [existingProposal({
      expiresAt: "2026-05-01T00:00:00.000Z",
      targetId: "tx-dinner"
    })],
    inflows: [venmo],
    now: new Date("2026-05-13T00:00:00.000Z"),
    suggestionService,
    transactions: [expense]
  });

  assert.equal(detections.length, 1);
});

test("detectReimbursementCandidateProposals rejects unsafe candidate context before provider calls", async () => {
  let calls = 0;
  const unsafeService = {
    async suggestReimbursementCandidate() {
      calls += 1;
      throw new Error("Provider should not be called for unsafe context.");
    }
  };
  const expense = transaction({
    amount: -182.44,
    date: "2026-05-04",
    id: "tx-unsafe",
    merchant: "Bearer abcdefghijklmnop"
  });
  const venmo = transaction({
    amount: 91.22,
    category: "Uncategorized",
    date: "2026-05-06",
    id: "tx-venmo",
    merchant: "Venmo Maya R"
  });

  await assert.rejects(
    () => detectReimbursementCandidateProposals({
      inflows: [venmo],
      suggestionService: unsafeService,
      transactions: [expense]
    }),
    /forbidden data|bearer_token/i
  );
  assert.equal(calls, 0);
});
