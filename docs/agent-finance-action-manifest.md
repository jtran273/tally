# Agent-Safe Finance Action Manifest

This contract defines the narrow finance surface that automation agents, including OpenClaw handoffs, may use in Ledger. The initial version is proposal-only: agents can read minimized summaries and draft proposed changes, but they cannot apply financial mutations or bypass user approval.

## Goals

- Let agents answer operational finance questions from safe summaries.
- Let agents draft review suggestions and merchant-rule proposals for the signed-in user.
- Keep raw provider data, credentials, and user-private notes out of agent payloads by default.
- Require existing UI/server-action approval paths, audit events, and user scoping before anything changes persisted finance records.

## Non-Goals

- No autonomous transaction edits.
- No Plaid sync, Plaid disconnect, token exchange, or account mutation actions.
- No direct insert/update/delete endpoint for `enriched_transactions`, `review_items`, `transaction_splits`, `recurring_expenses`, `merchant_rules`, or `audit_events`.
- No agent access to Plaid access tokens, provider secrets, Supabase service role keys, auth headers, or raw Plaid payloads.

## Auth And User Scope

Every manifest request must run inside an authenticated app session or a server-side handoff that has already resolved a single `userId`.

- The database remains the security boundary. All reads and eventual approval writes must include `user_id = current user`.
- Agent manifests must not accept caller-supplied `userId` values from prompts or OpenClaw payload text.
- Server-side clients that use privileged credentials must still pass the resolved user id into every query helper.
- Demo mode may expose only seeded demo rows and must be labeled as demo data in handoff metadata.

## Data Classes

### Read Summaries

Supported summary actions:

| Action | Purpose | Source helpers |
| --- | --- | --- |
| `read.weekly_planning_context` | Build a bounded, AI-readable weekly planning packet for proactive budget assistants. | `buildWeeklyPlanningContext()`, `buildSpendingInsightSummary()`, `buildUpcomingCashflowTimeline()`, `buildReimbursementReportingSummary()` |
| `read.review_queue_summary` | Count open review items, top reasons, largest unresolved examples. | `listReviewItems()` |
| `read.spending_summary` | Summarize spending by category/intent over a bounded date range. | `listTransactions()`, `transactionSpendingAmount()` |
| `read.stale_sync_summary` | Report fresh/stale/never-synced account counts and limited account examples. | `listAccounts()`, `summarizeSync()` |

Read summaries may include:

- record ids needed for navigation or later approval,
- counts, dates, amounts, categories, intents, confidence values, review reasons, and normalized merchant names,
- account display name, institution name, account type, and last sync timestamp,
- enriched transaction fields that are already app-facing.

Read summaries must not include forbidden fields listed below.

### Weekly Planning Context

`read.weekly_planning_context` is the v1 OpenClaw/assistant planning payload. It is a read-only snapshot, not an action runner. It composes existing deterministic summaries for:

- the current seven-day planning window and prior seven-day comparison,
- owned spending, trusted versus open-review spending, grouped category/intent totals, and reimbursement-aware totals,
- non-transfer income and upcoming projected recurring income,
- upcoming recurring bills and projected cash from the existing cashflow timeline,
- open review queue counts/examples,
- fresh/stale/never-synced account counts,
- transfers as a separate informational signal.

Transfers are excluded from spending and income planning by default. The planning context may include transfer count/net/outflow totals only as a separate signal so an assistant can explain why card payments or account moves were not counted as spend.

The context must pass the same recursive forbidden-field check before handoff. It must not include Plaid ids, raw payloads, access tokens, auth headers, cookies, service-role secrets, transaction cursors, location/payment metadata, or personal notes. Google Calendar data is not required or included in v1.

### Proposal-Only Mutations

Supported proposal actions:

| Action | Purpose | Approval path |
| --- | --- | --- |
| `propose.review_suggestions` | Draft a proposed category, intent, merchant cleanup, recurring flag, confidence, and rationale for existing review items. | Existing review UI/server actions such as accepting a review suggestion. |
| `propose.merchant_rule` | Draft a merchant-rule candidate for future automation. | A future explicit merchant-rule review UI, or a server action that records audit events after user confirmation. |

Proposal payloads must be represented as drafts. A proposal is not permission to mutate data. The applying layer must:

- re-read target rows for the current user,
- validate the target is still open/eligible,
- show the exact diff to the user,
- require an explicit user confirmation,
- write audit events with before/after data,
- revalidate affected pages.

## Raw Vs Enriched Data

Agents should consume enriched records first. Enriched transactions represent user-facing merchant names, categories, intents, notes, review state, confidence, and split information. Raw Plaid rows exist as evidence but contain provider-specific details that are unnecessary for most agent work.

Raw fields are allowed only when they are already narrowed and exposed in existing app-facing records, for example `plaidMerchant`, `plaidName`, and `plaidCategory` on `TransactionRecord`. Full `raw_payload`, `location`, `payment_meta`, Plaid transaction ids, and Plaid item ids are forbidden in manifest output unless a future security review explicitly allows a redacted evidence bundle.

## Data Minimization

Manifest responses should default to compact summaries, not exports.

- Use bounded date ranges for spending summaries.
- Cap examples and proposal counts.
- Return navigation ids only for records an approval UI can re-read.
- Prefer counts and grouped totals over full transaction lists.
- Include only the fields required to explain a recommendation.
- Avoid notes unless the approval path specifically needs them; notes can contain personal details.

## Forbidden Fields

Manifest inputs and outputs must not contain:

- `access_token_ciphertext`
- `raw_payload`
- `payment_meta`
- `location`
- `plaid_item_id`
- `plaid_account_id`
- `plaid_transaction_id`
- `transaction_cursor`
- `auth_header`
- `authorization`
- `cookie`
- `set_cookie`
- `service_role_key`
- `supabase_service_role_key`
- `plaid_secret`
- `plaid_access_token`
- `openai_api_key`
- full database URLs or provider secrets under any casing variant

The typed manifest module exposes a recursive guard so handoff code can reject accidental forbidden fields before logging or sending payloads.

## OpenClaw Handoff

OpenClaw handoff payloads should use this envelope:

```json
{
  "manifestVersion": "2026-05-06",
  "handoffId": "uuid-or-run-id",
  "userScoped": true,
  "source": "ledger",
  "mode": "proposal-only",
  "actions": ["read.weekly_planning_context", "propose.review_suggestions"],
  "summary": {
    "weeklyPlanning": {}
  },
  "proposals": [],
  "forbiddenFieldCheck": "passed"
}
```

OpenClaw may route the proposal to a user notification or an approval surface, but it must not execute the proposal as a mutation. The current `/agent-inbox` UI derives proposals from open review items and stored review suggestions; a persistent generic proposal store is still future work. If a future integration adds an apply endpoint, it must be separate from this manifest, same-origin protected, user scoped, audited, and named as an approval action rather than an agent action.

## Audit Requirements

The proposal-only manifest does not write `audit_events` because it does not mutate finance data. Any later approval action that applies a proposal must write an audit event with:

- actor id,
- entity table and id,
- action name,
- before and after data,
- proposal id or handoff id in metadata,
- whether the source was deterministic, AI-generated, or user-edited.

## Versioning

Initial manifest version: `2026-05-06`.

Changes that add new read summaries, including `read.weekly_planning_context`, may be additive under the same approval model. Changes that add mutation execution require a new manifest version and security review.
