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

## Calendar-Aware Finance Context

Google Calendar context is useful only as finance context. Tally should not become a calendar viewer, and OpenClaw should not store Google tokens or raw event payloads. Tally owns the read-only OAuth connection, encrypted token storage, and the minimized event context. OpenClaw consumes the bounded context to improve safe-to-spend, budget briefings, reimbursement prompts, and review questions.

Calendar context packets should include only bounded planning fields such as redacted title, start/end, all-day flag, city-level location, and suspected finance category. They must exclude attendee emails, descriptions, meeting URLs, full addresses, raw Google payloads, OAuth tokens, and secrets.

See `docs/calendar-aware-finance-context.md` for the product framing and issue #112 acceptance criteria.

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

## OpenClaw Outbox

`GET /api/openclaw/outbox` is the OpenClaw-facing notification bridge. It uses the same `OPENCLAW_TOKEN` bearer authentication and server-owned `OPENCLAW_USER_ID` scope as `/api/openclaw/signals`.

The outbox returns text-ready packets for:

- `reimbursement_clarification`: a bounded question with a reply action pointing back to `/api/openclaw/replies`.
- `reimbursement_alert`: a high-priority outstanding reimbursement summary.
- `review_queue_alert`: a high-priority cleanup prompt for open review items.
- `anomaly_alert`: a high-priority persisted anomaly alert for deterministic finance exceptions.
- `budget_briefing`: a compact budget summary using weekly spending, upcoming bills, projected cash when available, open review count, and reimbursement outstanding amount.
- `budget_proposal`: a pending `monthly_budget_proposal` agent proposal surfaced for approval. The body carries only sanitized category labels and rounded amounts, capped uncertainty notes, and — only when present in the proposal evidence — a bounded calendar-pressure summary (level plus allowlisted spend categories; never raw events, titles, descriptions, or attendees). The message includes a `replyAction` so James can reply "approve" or send adjustments through `/api/openclaw/replies`. This is proposal-only behavior: no confirmed budget exists yet, nothing is written until Tally-owned approval flows run, and `directFinanceWritesAllowed` stays `false`.

Monthly budget proposals may be compiled from historical budget guardrails, upcoming cashflow totals, open-review/reimbursement uncertainty, and the minimized calendar-pressure summary. The compiler persists only an advisory `agent_proposals` row with `proposal_type = monthly_budget_proposal` and `target_kind = monthly_budget`; it does not create confirmed budget rows or apply any budget changes.

Outbox packets are delivery-neutral. They do not contain phone numbers, Twilio credentials, push tokens, provider payloads, Plaid ids, service-role keys, or direct write authority. OpenClaw can forward the `body` through its own notification channel, but finance mutations still require Tally-owned reply or approval endpoints.

Optional query parameters:

| Parameter | Purpose |
| --- | --- |
| `since` | ISO cursor forwarded to the signals loader. |
| `limit` | Maximum outbox messages, from `0` to `25`; defaults to `5`. |
| `include_budget` | `true`/`false` flag for adding the budget briefing; defaults to `true`. |
| `min_priority` | `normal` or `high`; use `high` for scheduled notification loops that should only interrupt on actionable finance items. |

Recommended polling modes:

- `include_budget=false&limit=5`: ask only actionable clarification questions.
- `min_priority=high&limit=5`: allow reimbursement clarification, reimbursement alert, and review queue alert packets while suppressing normal status summaries.
- `include_budget=true&limit=5`: manual status pull, useful when James explicitly asks for the current Tally picture.

Because Plaid sync is usually manual, OpenClaw should not poll this endpoint every few minutes. A low-frequency schedule such as every 6 hours is enough for background checks, with an immediate on-demand `min_priority=high&limit=5` poll after manual Plaid sync.

## OpenClaw Read APIs

Dedicated read APIs let OpenClaw answer common finance questions without direct database access:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/openclaw/recent-transactions?limit=5` | Recent safe transaction DTOs. |
| `GET /api/openclaw/review-items?limit=5` | Open cleanup inbox items. |
| `GET /api/openclaw/reimbursements?limit=5` | Outstanding reimbursable transaction summaries. |
| `GET /api/openclaw/safe-to-spend?amount=80` | Green/yellow/red spend answer with one-sentence rationale. |
| `POST /api/openclaw/query` | Structured wrapper for allowlisted intents. |

The query endpoint accepts JSON only and intentionally does not accept raw natural-language SQL:

```json
{ "intent": "safe_to_spend", "amount": 80 }
```

Supported intents are `recent_transactions`, `review_items`, `reimbursements`, and `safe_to_spend`. All read API responses include a safety block and exclude raw provider payloads, Plaid ids, account numbers/masks, phone numbers, notes, service-role keys, and write authority. OpenClaw read handlers should avoid raw Plaid-context hydration and push request limits into the underlying database reads where possible.

## Fixtures

Example payloads live under `src/lib/agents/fixtures/`:

- `reimbursement-review-context.json`
- `reimbursement-review-response.json`

The fixture pair demonstrates a shared dinner, an incoming payment, and a proposed reimbursement match. The examples are safe demo data and intentionally omit raw Plaid fields, provider ids, secrets, user ids, and notes.

## Follow-Ups

1. Tally should add a persistent feedback table or audit-backed event shape for accepted, rejected, corrected, and ignored assistant suggestions. That storage should keep the original proposal id/context id, the final user action, and sanitized rationale without storing raw provider payloads.
2. OpenClaw should keep its scheduled `/api/openclaw/outbox` client low-frequency, deduplicate message ids including `anomaly_alert` packets, and forward the body through the configured notification channel. Replies should post only to `/api/openclaw/replies` with the proposal id from `replyAction`.
