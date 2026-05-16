# OpenClaw/Tally Assistant Contract

Tally is the finance system of record and approval surface. OpenClaw/Grace is the reasoning and proactive layer. This contract defines the small payloads Tally may send out for assistant reasoning, and the proposal-only JSON shape an assistant may return.

## Boundary

Tally owns:

- persisted finance records,
- raw provider evidence,
- review state,
- reimbursement state,
- audit events,
- user approval,
- any write to Supabase or Plaid-backed data.

OpenClaw/Grace may:

- read minimized Tally context packets,
- reason over review and planning signals,
- return typed suggestions,
- ask clarifying questions,
- route a proposal back to Tally or a notification workflow.

OpenClaw/Grace must not:

- mutate Tally records directly,
- run Plaid sync or token exchange,
- store provider payloads or credentials,
- treat a suggestion as approved,
- use prompt-provided user ids as authority.

## Context Packet

TypeScript definitions live in `src/lib/agents/assistant-contract.ts`. The initial packet kind is `reimbursement_review`.

Context packets contain only app-owned ids and enriched review fields needed for reasoning:

- transaction id, date, amount, merchant, category, intent, status, and confidence,
- account display label, institution name, and mask,
- open review item id, reason, and explanation,
- split id, label, amount, category, and intent,
- reimbursement id, counterparty, expected/received amount, due date, and status.

Context packets explicitly exclude raw provider payloads, provider ids, account numbers, user ids, auth data, database URLs, cookies, tokens, service-role keys, OpenAI keys, and secret-shaped values. The contract module exposes `assertAssistantContextSafe()` for recursive key and value checks before payloads are logged or sent.

## Suggestion Response

Assistant responses are proposals. Every suggestion has `approvalRequired: true` and must be re-read and validated by Tally before any write.

Supported suggestion types:

| Type | Purpose |
| --- | --- |
| `possible_reimbursable_expense` | Suggest that a shared charge should become reimbursable or shared. |
| `reimbursement_match` | Suggest matching an incoming transaction to an expected reimbursement. |
| `safe_to_spend_warning` | Warn that planned or recent activity may affect safe-to-spend calculations. |
| `clarification_request` | Ask the user for missing context before Tally changes anything. |

Tally approval code must re-read current rows for the signed-in user, show the exact proposed diff, require explicit confirmation, write audit events, and then update review/reimbursement state. This contract does not define an apply endpoint.

## Fixtures

Example payloads live under `src/lib/agents/fixtures/`:

- `reimbursement-review-context.json`
- `reimbursement-review-response.json`

The fixture pair demonstrates a shared dinner, an incoming payment, and a proposed reimbursement match. The examples are safe demo data and intentionally omit raw Plaid fields, provider ids, secrets, user ids, and notes.

## Follow-Ups

1. Tally should add a persistent feedback table or audit-backed event shape for accepted, rejected, corrected, and ignored assistant suggestions. That storage should keep the original proposal id/context id, the final user action, and sanitized rationale without storing raw provider payloads.
2. OpenClaw should add a client and scheduled/cron workflow that can request bounded Tally context packets, call the reasoning layer, and return proposal JSON to a Tally-owned approval inbox or notification route without performing writes.
