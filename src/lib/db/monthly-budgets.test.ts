import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentProposalRow,
  AuditEventRow,
  FinanceSupabaseClient,
  MonthlyBudgetRow
} from "@/lib/db";
import {
  acceptAgentProposal,
  FinanceDbError,
  getConfirmedMonthlyBudget
} from "./queries";

const userId = "11111111-1111-1111-1111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";

type FakeTableName = "agent_proposals" | "audit_events" | "monthly_budgets";

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
          created_at: "2026-06-10T12:00:00.000Z",
          id: `33333333-3333-4333-8333-33333333000${this.rows.length + 1}`,
          updated_at: "2026-06-10T12:00:00.000Z",
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
  monthlyBudgets: MonthlyBudgetRow[] = [];

  asClient(): FinanceSupabaseClient {
    return this as unknown as FinanceSupabaseClient;
  }

  from(table: FakeTableName) {
    const rows = (
      table === "agent_proposals"
        ? this.agentProposals
        : table === "monthly_budgets"
          ? this.monthlyBudgets
          : this.auditEvents
    ) as unknown as Array<Record<string, unknown>>;
    return {
      insert: (values: Partial<Record<string, unknown>> | Array<Partial<Record<string, unknown>>>) =>
        new FakeQueryBuilder(rows, "insert", values),
      select: () => new FakeQueryBuilder(rows, "select"),
      update: (values: Partial<Record<string, unknown>>) =>
        new FakeQueryBuilder(rows, "update", values)
    };
  }
}

function budgetProposal(input: Partial<AgentProposalRow> = {}): AgentProposalRow {
  return {
    accepted_at: null,
    answered_at: null,
    clarification_answer: null,
    clarification_answer_kind: null,
    clarification_question: null,
    confidence: null,
    created_at: "2026-06-10T08:00:00.000Z",
    dismissed_at: null,
    evidence: { directFinanceWritesAllowed: false },
    expires_at: null,
    id: proposalId,
    proposal_type: "monthly_budget_proposal",
    proposed_patch: {
      action: "review_monthly_budget_proposal",
      categories: [
        { amount: 500, label: "Dining" },
        { amount: 375.5, label: "Groceries" }
      ],
      directFinanceWritesAllowed: false,
      month: "2026-07",
      totalAmount: 875.5
    },
    question_fingerprint: "monthly-budget-proposal:2026-07",
    source_agent: "ledger-monthly-budget-proposal-generator",
    source_candidate_id: null,
    source_context_id: "monthly-budget-proposal:2026-07",
    status: "pending",
    target_id: "44444444-4444-4444-8444-444444444444",
    target_kind: "monthly_budget",
    updated_at: "2026-06-10T08:00:00.000Z",
    user_id: userId,
    ...input
  };
}

test("accepting a monthly budget proposal confirms the budget with audit events", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(budgetProposal());

  const accepted = await acceptAgentProposal(client.asClient(), userId, proposalId, {
    actorId: userId,
    source: "agent_inbox_monthly_budget_accept"
  });

  assert.equal(accepted.status, "accepted");
  assert.equal(client.monthlyBudgets.length, 1);
  assert.equal(client.monthlyBudgets[0].month, "2026-07");
  assert.equal(client.monthlyBudgets[0].status, "confirmed");
  assert.equal(client.monthlyBudgets[0].total_amount, 875.5);
  assert.equal(client.monthlyBudgets[0].source_proposal_id, proposalId);
  assert.deepEqual(client.monthlyBudgets[0].categories, [
    { amount: 500, label: "Dining" },
    { amount: 375.5, label: "Groceries" }
  ]);

  const actions = client.auditEvents.map((event) => event.action);
  assert.ok(actions.includes("monthly_budget.confirmed"));
  assert.ok(actions.includes("agent_proposal.accepted"));

  const confirmed = await getConfirmedMonthlyBudget(client.asClient(), userId, "2026-07");
  assert.ok(confirmed);
  assert.equal(confirmed.totalAmount, 875.5);
  assert.equal(confirmed.categories.length, 2);
});

test("accepting a budget proposal supersedes the previous confirmed budget for the month", async () => {
  const client = new FakeFinanceClient();
  client.monthlyBudgets.push({
    categories: [{ amount: 700, label: "Everything" }],
    confirmed_at: "2026-06-01T00:00:00.000Z",
    created_at: "2026-06-01T00:00:00.000Z",
    id: "55555555-5555-4555-8555-555555555555",
    month: "2026-07",
    source_proposal_id: null,
    status: "confirmed",
    superseded_at: null,
    total_amount: 700,
    updated_at: "2026-06-01T00:00:00.000Z",
    user_id: userId
  });
  client.agentProposals.push(budgetProposal());

  await acceptAgentProposal(client.asClient(), userId, proposalId);

  const confirmedRows = client.monthlyBudgets.filter((row) => row.status === "confirmed");
  const supersededRows = client.monthlyBudgets.filter((row) => row.status === "superseded");
  assert.equal(confirmedRows.length, 1);
  assert.equal(confirmedRows[0].total_amount, 875.5);
  assert.equal(supersededRows.length, 1);
  assert.ok(supersededRows[0].superseded_at);
  assert.ok(client.auditEvents.some((event) => event.action === "monthly_budget.superseded"));
});

test("an answered budget proposal (approved via OpenClaw reply) can still be applied", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(budgetProposal({
    answered_at: "2026-06-10T09:00:00.000Z",
    clarification_answer: "approve",
    clarification_answer_kind: "approve",
    status: "answered"
  }));

  const accepted = await acceptAgentProposal(client.asClient(), userId, proposalId);

  assert.equal(accepted.status, "accepted");
  assert.equal(client.monthlyBudgets.length, 1);
  assert.equal(client.monthlyBudgets[0].status, "confirmed");
});

test("budget proposals without a usable plan are rejected without writes", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(budgetProposal({
    proposed_patch: { categories: [], month: "not-a-month" }
  }));

  await assert.rejects(
    () => acceptAgentProposal(client.asClient(), userId, proposalId),
    FinanceDbError
  );
  assert.equal(client.monthlyBudgets.length, 0);
  assert.equal(client.agentProposals[0].status, "pending");
});
