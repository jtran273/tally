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
| `read.review_queue_summary` | Count open review items, top reasons, largest unresolved examples. | `listReviewItems()` |
| `read.spending_summary` | Summarize spending by category/intent over a bounded date range. | `listTransactions()`, `transactionSpendingAmount()` |
| `read.stale_sync_summary` | Report fresh/stale/never-synced account counts and limited account examples. | `listAccounts()`, `summarizeSync()` |

Read summaries may include:

- record ids needed for navigation or later approval,
- counts, dates, amounts, categories, intents, confidence values, review reasons, and normalized merchant names,
- account display name, institution name, account type, and last sync timestamp,
- enriched transaction fields that are already app-facing.

Read summaries must not include forbidden fields listed below.

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
  "actions": ["read.review_queue_summary", "propose.review_suggestions"],
  "summary": {},
  "proposals": [],
  "forbiddenFieldCheck": "passed"
}
```

OpenClaw may route the proposal to a user notification or an approval surface, but it must not execute the proposal as a mutation. The current `/agent-inbox` UI derives proposals from open review items and stored review suggestions; a persistent generic proposal store is still future work. If a future integration adds an apply endpoint, it must be separate from this manifest, same-origin protected, user scoped, audited, and named as an approval action rather than an agent action.

## Reimbursement Clarification Requests

Ambiguous reimbursements should use Plaid/bank activity, enriched transaction context, deterministic heuristics, and optional LLM reasoning as the v1 product path. CSV exports or manual imports may be useful for historical backfill or evidence reconciliation, but they are not required for the automated v1 clarification flow.

When Ledger has a candidate reimbursement match that needs James's judgment, OpenClaw should receive a compact `assistant_clarification_request` object. The object is a question request, not an approval to mutate finance rows:

```json
{
  "object": "assistant_clarification_request",
  "id": "clarify-reimbursement-candidate-123",
  "answerType": "reimbursement_clarification",
  "candidateId": "candidate-123",
  "transactionId": "tx-dinner",
  "questionFingerprint": "merchant-date-counterparty-window",
  "priority": "medium",
  "confidence": 0.74,
  "accountingImpactAmount": 48,
  "context": {
    "amount": -96,
    "currency": "USD",
    "date": "2026-05-10",
    "merchant": "Taco Guild",
    "suggestedCounterparty": "Ryan"
  },
  "question": "Was $48.00 of Taco Guild on 2026-05-10 Ryan's share to reimburse?",
  "approvalRequired": true,
  "audit": {
    "writesAllowed": false,
    "evidence": ["Dinner charge followed by same-day Venmo credit."]
  }
}
```

Clarification routing should follow these rules:

- Ask only when confidence is at least medium and the answer would meaningfully change accounting, such as moving a material split from owned spending to reimbursable.
- Stay silent for low-confidence matches, low-value matches, or candidates with no accounting impact.
- Queue in the app instead of interrupting when a similar open `questionFingerprint` already exists.
- Queue in the app instead of interrupting when James already has too many open clarification requests.
- Keep the question concise and answerable without opening Ledger whenever possible.

Example OpenClaw question:

```text
Was $48.00 of Taco Guild on 2026-05-10 Ryan's share to reimburse?
```

Answer normalization should accept terse replies:

| Reply | Normalized answer | Meaning |
| --- | --- | --- |
| `yes` | `confirm-reimbursement` | Use the suggested reimbursement interpretation. |
| `Ryan dinner` | `counterparty`, `["Ryan"]` | Treat Ryan as the counterparty and keep the answer as evidence text. |
| `not reimbursement` | `not-reimbursement` | Suppress this candidate as reimbursable spending. |
| `split between Alex and Sam` | `split-counterparties`, `["Alex", "Sam"]` | Draft a split across those counterparties for later approval. |

After James answers, Ledger should store learning as auditable feedback tied to the candidate and target transaction. The persisted record should include the normalized answer kind, counterparties when supplied, original question id, question fingerprint, model or heuristic source, confidence at ask time, raw answer text, created/answered timestamps, and whether the answer produced an approved split, reimbursement record, merchant rule, or suppression rule. Feedback can improve future matching and batching, but it must not directly apply transaction splits, reimbursement records, merchant rules, or review resolutions without an approval action that re-reads the target row, shows the diff, scopes by `user_id`, and writes an `audit_events` row.

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

Changes that add new read summaries may be additive under the same approval model. Changes that add mutation execution require a new manifest version and security review.
