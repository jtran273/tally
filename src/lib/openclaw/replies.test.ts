import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentProposalRow,
  AuditEventRow,
  FinanceSupabaseClient
} from "@/lib/db";
import {
  OpenClawReplyBadRequestError,
  OpenClawReplyConflictError,
  OpenClawReplyNotFoundError,
  handleOpenClawReply,
  parseOpenClawReplyRequest
} from "./replies";

const userId = "11111111-1111-1111-1111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";
const candidateProposalId = "33333333-3333-4333-8333-333333333333";
const missingProposalId = "44444444-4444-4444-8444-444444444444";

type FakeTableName = "agent_proposals" | "audit_events";

class FakeQueryBuilder<Row extends Record<string, unknown>> {
  private filters: Array<(row: Row) => boolean> = [];
  private singleResult = false;

  constructor(
    private rows: Row[],
    private readonly operation: "select" | "insert" | "update",
    private readonly values?: Partial<Row> | Partial<Row>[]
  ) {}

  select() {
    return this;
  }

  eq(column: keyof Row & string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  order() {
    return this;
  }

  single() {
    this.singleResult = true;
    return this;
  }

  then<TResult1 = { data: Row[] | Row | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | Row | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    if (this.operation === "insert") {
      const inserted = (Array.isArray(this.values) ? this.values : [this.values ?? {}]).map((value) => {
        const row = {
          created_at: "2026-05-13T12:00:00.000Z",
          id: `row-${this.rows.length + 1}`,
          updated_at: "2026-05-13T12:00:00.000Z",
          ...value
        } as unknown as Row;
        this.rows.push(row);
        return row;
      });
      return { data: this.singleResult ? inserted[0] ?? null : inserted, error: null };
    }

    const matches = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.operation === "update") {
      matches.forEach((row) => Object.assign(row, this.values));
    }

    return { data: this.singleResult ? matches[0] ?? null : matches, error: null };
  }
}

class FakeFinanceClient {
  agentProposals: AgentProposalRow[] = [];
  auditEvents: AuditEventRow[] = [];

  asClient(): FinanceSupabaseClient {
    return this as unknown as FinanceSupabaseClient;
  }

  from(table: FakeTableName) {
    const rows = (table === "agent_proposals" ? this.agentProposals : this.auditEvents) as unknown as Array<Record<string, unknown>>;
    return {
      delete: () => new FakeQueryBuilder(rows, "select"),
      insert: (values: Partial<AgentProposalRow> | Partial<AuditEventRow> | Array<Partial<AgentProposalRow> | Partial<AuditEventRow>>) =>
        new FakeQueryBuilder(rows, "insert", values as Array<Partial<Record<string, unknown>>>),
      select: () => new FakeQueryBuilder(rows, "select"),
      update: (values: Partial<AgentProposalRow> | Partial<AuditEventRow>) =>
        new FakeQueryBuilder(rows, "update", values as Partial<Record<string, unknown>>),
      upsert: (values: Partial<AgentProposalRow> | Partial<AgentProposalRow>[]) =>
        new FakeQueryBuilder(rows, "insert", values)
    };
  }
}

function agentProposal(input: Partial<AgentProposalRow> = {}): AgentProposalRow {
  return {
    accepted_at: null,
    answered_at: null,
    clarification_answer: null,
    clarification_answer_kind: null,
    clarification_question: "Was this Ryan's share to reimburse?",
    confidence: 0.74,
    created_at: "2026-05-13T08:00:00.000Z",
    dismissed_at: null,
    evidence: { merchant: "Taco Guild" },
    expires_at: null,
    id: proposalId,
    proposal_type: "clarification_request",
    proposed_patch: { suggestedIntent: "reimbursable" },
    question_fingerprint: "fingerprint",
    source_agent: "test-agent",
    source_candidate_id: null,
    source_context_id: null,
    status: "pending",
    target_id: "22222222-2222-2222-2222-222222222222",
    target_kind: "enriched_transaction",
    updated_at: "2026-05-13T08:00:00.000Z",
    user_id: userId,
    ...input
  };
}

test("parseOpenClawReplyRequest validates proposal_id and raw_text", () => {
  assert.deepEqual(
    parseOpenClawReplyRequest({ proposal_id: ` ${proposalId} `, raw_text: " Ryan dinner " }),
    { proposal_id: proposalId, raw_text: "Ryan dinner" }
  );
  assert.throws(() => parseOpenClawReplyRequest(null), OpenClawReplyBadRequestError);
  assert.throws(() => parseOpenClawReplyRequest({ proposal_id: "", raw_text: "yes" }), OpenClawReplyBadRequestError);
  assert.throws(() => parseOpenClawReplyRequest({ proposal_id: "not-a-uuid", raw_text: "yes" }), OpenClawReplyBadRequestError);
  assert.throws(() => parseOpenClawReplyRequest({ proposal_id: proposalId, raw_text: "" }), OpenClawReplyBadRequestError);
});

test("handleOpenClawReply round-trips through the clarification parser", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposal());

  const response = await handleOpenClawReply(client.asClient(), userId, {
    proposal_id: proposalId,
    raw_text: "Ryan dinner"
  });

  assert.equal(response.status, "answered");
  assert.equal(response.answer_kind, "counterparty");
  assert.deepEqual(response.applied_patch, {
    counterparties: ["Ryan"],
    suggestedIntent: "reimbursable"
  });
  assert.equal(client.agentProposals[0].clarification_answer, "Ryan dinner");
  assert.equal(client.auditEvents.length, 1);
  assert.deepEqual(client.auditEvents[0].metadata, {
    answerKind: "counterparty",
    proposalId,
    source: "openclaw_replies_api"
  });
});

test("handleOpenClawReply records answers on reimbursement candidate questions", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposal({
    id: candidateProposalId,
    proposal_type: "reimbursement_candidate"
  }));

  const response = await handleOpenClawReply(client.asClient(), userId, {
    proposal_id: candidateProposalId,
    raw_text: "Ryan dinner"
  });

  assert.equal(response.status, "answered");
  assert.equal(response.answer_kind, "counterparty");
  assert.deepEqual(response.applied_patch, {
    counterparties: ["Ryan"],
    suggestedIntent: "reimbursable"
  });
  assert.equal(client.agentProposals[0].clarification_answer, "Ryan dinner");
  assert.equal(client.auditEvents.length, 1);
});

test("handleOpenClawReply rejects secret-shaped reply text before storage", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposal());

  await assert.rejects(
    () => handleOpenClawReply(client.asClient(), userId, {
      proposal_id: proposalId,
      raw_text: "Bearer abcdefghijklmnop"
    }),
    OpenClawReplyBadRequestError
  );
  assert.equal(client.agentProposals[0].clarification_answer, null);
  assert.equal(client.auditEvents.length, 0);
});

test("handleOpenClawReply returns a not-found error for unknown proposals", async () => {
  const client = new FakeFinanceClient();

  await assert.rejects(
    () => handleOpenClawReply(client.asClient(), userId, {
      proposal_id: missingProposalId,
      raw_text: "yes"
    }),
    OpenClawReplyNotFoundError
  );
});

test("handleOpenClawReply returns a conflict for stale proposals", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposal({ status: "dismissed" }));

  await assert.rejects(
    () => handleOpenClawReply(client.asClient(), userId, {
      proposal_id: proposalId,
      raw_text: "Ryan dinner"
    }),
    OpenClawReplyConflictError
  );
});

test("handleOpenClawReply returns a conflict for proposals without questions", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposal({ clarification_question: null }));

  await assert.rejects(
    () => handleOpenClawReply(client.asClient(), userId, {
      proposal_id: proposalId,
      raw_text: "Ryan dinner"
    }),
    OpenClawReplyConflictError
  );
});

test("handleOpenClawReply records monthly budget proposal approvals without touching the patch", async () => {
  const client = new FakeFinanceClient();
  const budgetProposalId = "55555555-5555-4555-8555-555555555555";
  client.agentProposals.push(agentProposal({
    clarification_question: null,
    id: budgetProposalId,
    proposal_type: "monthly_budget_proposal",
    proposed_patch: {
      action: "review_monthly_budget_proposal",
      directFinanceWritesAllowed: false,
      month: "2026-07",
      totalAmount: 875
    },
    target_kind: "monthly_budget"
  }));

  const response = await handleOpenClawReply(client.asClient(), userId, {
    proposal_id: budgetProposalId,
    raw_text: "Approve"
  });

  assert.equal(response.status, "answered");
  assert.equal(response.answer_kind, "approve");
  assert.deepEqual(response.applied_patch, {
    action: "review_monthly_budget_proposal",
    directFinanceWritesAllowed: false,
    month: "2026-07",
    totalAmount: 875
  });
  assert.equal(client.agentProposals[0].clarification_answer, "Approve");
  assert.equal(client.agentProposals[0].status, "answered");
  assert.equal(client.auditEvents.length, 1);
  assert.equal(client.auditEvents[0].action, "agent_proposal.monthly_budget_reply_recorded");
  assert.deepEqual(client.auditEvents[0].metadata, {
    answerKind: "approve",
    proposalId: budgetProposalId,
    source: "openclaw_replies_api"
  });
});

test("handleOpenClawReply classifies monthly budget adjustment replies", async () => {
  const client = new FakeFinanceClient();
  const budgetProposalId = "66666666-6666-4666-8666-666666666666";
  client.agentProposals.push(agentProposal({
    clarification_question: null,
    id: budgetProposalId,
    proposal_type: "monthly_budget_proposal",
    proposed_patch: { month: "2026-07" },
    target_kind: "monthly_budget"
  }));

  const response = await handleOpenClawReply(client.asClient(), userId, {
    proposal_id: budgetProposalId,
    raw_text: "dining 450"
  });

  assert.equal(response.status, "answered");
  assert.equal(response.answer_kind, "adjust");
  assert.equal(client.agentProposals[0].clarification_answer, "dining 450");
});
