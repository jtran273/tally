# Architecture

Ledger is a Next.js App Router application backed by Supabase Postgres, Supabase Auth, Plaid, and an optional AI suggestion provider. The architecture keeps provider data, user-approved enrichment, review workflow, and dashboard calculations separate so the app can explain where every number came from.

## Runtime Overview

```text
Browser
  |
  | Supabase Auth client cookies
  | Plaid Link public token
  v
Next.js App Router on Vercel
  |
  | Server components read finance data
  | Route handlers perform Plaid operations
  | Server actions mutate reviews, recurring rows, and transactions
  v
Supabase Postgres with RLS
  |
  | Server-only Plaid access token use
  v
Plaid API
```

## Application Boundaries

- `src/app` owns routing, route handlers, server actions, layouts, loading states, and page-level data fetching.
- `src/components` owns UI composition and interaction surfaces.
- `src/lib/db` owns typed database access and conversion from database rows to app records.
- `src/lib/plaid` owns Plaid configuration, Link token creation, public token exchange, transaction sync, disconnect, token encryption, and safe error handling.
- `src/lib/demo` owns local demo mode and seeded in-memory finance data.
- `src/lib/agents` owns the proposal-only finance action manifest and derived agent inbox proposal shaping.
- `src/lib/review`, `src/lib/recurring`, `src/lib/finance`, `src/lib/settings`, and `src/lib/insights` own domain calculations and setup-state helpers.
- `supabase/migrations` owns schema, indexes, grants, RLS, and policies.

## Route Map

### Pages

| Route | Purpose | Data source |
| --- | --- | --- |
| `/login` | Supabase Auth sign-in and optional local demo entry | Supabase Auth server client |
| `/dashboard` | Balance dashboard, sync freshness, selected-period transaction activity, liabilities due, category trend/month spending views | Accounts, snapshots, transactions |
| `/transactions` | Searchable/filterable transaction table, summary cards, merchant cleanup, CSV export link | Accounts, categories, enriched transactions |
| `/transactions/[transactionId]` | Transaction edit surface | One enriched transaction plus categories |
| `/agent-inbox` | Sanitized proposal inbox derived from open review items and normalized review suggestions | Open review items and stored suggestions |
| `/review` | Review queue and split workflow | Review items, categories, transactions |
| `/recurring` | Recurring candidates and recurring rows | Transactions, recurring expenses |
| `/accounts` | Accounts grouped by finance type | Accounts and balance snapshots |
| `/settings` | Plaid bank connection controls and session access | Plaid connections |

### Route Handlers

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/plaid/connections` | `GET` | List active/error/revoked Plaid connections for the signed-in user |
| `/api/plaid/link-token` | `POST` | Create a Plaid Link token for the signed-in user, including update mode for a selected item |
| `/api/plaid/exchange` | `POST` | Exchange a Plaid public token, persist item metadata, then run initial sync |
| `/api/plaid/sync` | `POST` | Manually sync all active Plaid connections, or one selected connection |
| `/api/plaid/sync/scheduled` | `GET`/`POST` | Run scheduled sync for all users with syncable Plaid items when authorized with `CRON_SECRET` |
| `/api/plaid/connections/[connectionId]` | `DELETE` | Revoke a Plaid item and stop future sync |
| `/api/export/transactions` | `GET` | Export filtered enriched transactions as CSV |
| `/login/demo` | `POST` | Set demo cookie when demo mode is enabled |
| `/login/logout` | `POST` | Sign out and clear demo cookie |

Browser-initiated mutating route handlers use same-origin validation through `src/lib/security/request.ts`. The scheduled Plaid sync route is the exception: it is intended for trusted server jobs and is authorized with `CRON_SECRET` instead of browser same-origin checks.

## Data Model

The finance schema is in `supabase/migrations/20260506000100_finance_schema.sql`.

Core tables:

- `institutions`: institution metadata, Plaid institution id, branding fields.
- `plaid_items`: Plaid item ids, encrypted Plaid access tokens, sync cursors, product and error state.
- `plaid_sync_runs`: persisted initial/manual/scheduled sync summaries with item status, changed-row counts, and safe error metadata.
- `plaid_sync_run_items`: per-item sync outcomes keyed by app-owned Plaid item row ids, not provider item ids.
- `accounts`: account metadata, balances, masks, active state, and grouping fields.
- `balance_snapshots`: point-in-time account balances for trends.
- `categories`: user-owned categories.
- `raw_transactions`: immutable Plaid transaction fields and raw payload.
- `enriched_transactions`: editable app-facing merchant, category, intent, notes, review state, and confidence.
- `review_items`: open/resolved/dismissed review tasks generated from heuristics and suggestions, including peer-to-peer, large, transfer-pair, new-recurring, low-confidence, missing-category, unclear-transfer, and recurring-candidate reasons.
- `transaction_splits`: split allocations for peer-to-peer or shared spending.
- `reimbursement_records`: expected/requested/received reimbursement tracking for reimbursable split portions.
- `recurring_expenses`: confirmed, pending, paused, or dismissed recurring rows.
- `insights`: persisted insight cards.
- `merchant_rules`: reusable merchant/category/intent rules for future automation.
- `audit_events`: material changes to labels, review state, recurring rows, and related records.

Every finance table includes `user_id`. RLS policies enforce user ownership.

## Plaid Flow

1. The settings page asks `/api/plaid/link-token` for a Link token.
2. The browser opens Plaid Link through `react-plaid-link`.
3. Plaid returns a short-lived public token to the browser.
4. The browser sends the public token to `/api/plaid/exchange`.
5. The server exchanges the public token for an access token.
6. The access token is encrypted in `src/lib/plaid/token-vault.ts`.
7. The app stores the encrypted token in `plaid_items.access_token_ciphertext`.
8. Initial sync imports accounts, balances, raw transactions, enriched transactions, and generated review items.
9. Future manual and scheduled syncs use Plaid transaction cursors for idempotency.

The core sync service can run either all syncable items or a single item by database item id. Route handlers use that single-item path after Plaid Link update mode so repair and relink flows do not depend on browser-side transaction logic.

Initial, manual, and scheduled syncs persist run-level and item-level observability rows. These rows store counts, app-owned row ids, status, timestamps, and sanitized Plaid error codes/messages only. Access tokens, transaction cursors, raw provider payloads, request auth headers, and provider item ids stay out of browser responses and sync logs.

The access token never leaves server code.

## Transaction Flow

Plaid data lands first in `raw_transactions`. The app then creates or updates `enriched_transactions` for user-facing edits and reporting.

Raw fields answer "what did Plaid send?" Enriched fields answer "what does the user trust this transaction to mean?"

This split lets the app:

- keep provider history intact,
- update labels without losing original evidence,
- re-run heuristics from raw data,
- show raw Plaid context in the edit UI,
- avoid treating unresolved activity as final budget truth.

The `/transactions` surface supports explicit merchant cleanup for repeated label fixes. A user can match merchant/raw-name text, choose one saved category and intent, update matching enriched rows, and optionally persist a merchant rule so future Plaid imports receive the same app-facing category. The action records audit events and does not mutate raw Plaid rows. Transaction filters include search, month, date range, account, category, intent, review state, review reason, quality state, row limit, and transfer exclusion.

## Review Flow

Review items are created for transactions that need user attention, including:

- peer-to-peer payments,
- large transactions,
- unclear transfers,
- transfer pairs,
- low-confidence categories,
- missing categories,
- recurring candidates.

Review reason copy and ordering live in `src/lib/review/reasons.ts`; the Transactions page exposes the same reasons as filters so review-sensitive slices can be inspected and exported.

Users can accept ready suggestions individually, dismiss non-peer-to-peer review items, request one AI suggestion at a time, edit the enriched transaction inline, or resolve peer-to-peer items with structured split allocation. Peer-to-peer items remain manual-only and require an explanation before they leave the queue. Reimbursable portions and reimbursement records travel with hydrated transactions so review and reporting can distinguish owed-back dollars from owned spending without exposing raw provider payloads. Material changes write audit events.

Accepted AI cleanups and review-page manual edits can upsert reusable merchant rules for future imports when the normalized merchant, category, and intent are specific enough. Rule creation writes audit events and still keeps raw Plaid rows immutable. The review page also auto-resolves stale `missing-category` review items when the enriched transaction already has an exact category match.

## Recurring Flow

`src/lib/recurring/detector.ts` scans persisted transactions for repeated merchants, amounts, and date cadence. Candidates can be confirmed or dismissed from `/recurring`. Confirmed and pending rows feed the recurring page timeline; dashboard cashflow summaries remain future work.

`src/lib/finance/cashflow.ts` also builds the upcoming cashflow calendar as a pure calculation. Confirmed and pending recurring rows produce scheduled bill events, while recurring posted positive transactions produce projected income events when their history has a deterministic cadence. `/recurring` displays only app-owned merchant, amount, date, cadence, and account-derived cash totals; Plaid provider ids and raw payloads are not part of the timeline model.

## Dashboard Calculations

`src/lib/finance/balances.ts` derives account totals, sync freshness, and balance trends from accounts, balance snapshots, and transaction history. The dashboard supports net worth, cash, liabilities, and cash-minus-liabilities views over 1-week, 1-month, 3-month, 6-month, 1-year, and all-time ranges. Selecting a point in the trend surfaces the related non-transfer transactions and links back to the transaction filters.

`src/lib/finance/liabilities.ts` builds the liabilities-due panel from active credit accounts, cash balances, credit limits, and likely payment transactions. It estimates due dates from the last payment when available and highlights overdue or due-soon balances without relying on provider-sensitive ids.

`src/lib/finance/spending.ts` powers category spending breakdowns, spending confidence, reimbursement-aware totals, and cleanup quality flags. The dashboard category panel can show cumulative category trends for the selected range or month-by-month category rows for the last six months. The separate `budget-guardrails.ts` helper remains available for deterministic guardrail summaries, but it is not the primary dashboard surface today.

## AI Suggestion Flow

`src/lib/ai` defines a provider interface. The deterministic provider is the safe fallback. The OpenAI provider is optional and only runs when `OPENAI_API_KEY` is present on the server. Automatic OpenAI cleanup on Plaid import and review page load is disabled unless `ENABLE_OPENAI_AUTO_REVIEW=true`; manual review actions can still request one suggestion at a time.

Manual AI suggestions are advisory and require explicit user acceptance. When `ENABLE_OPENAI_AUTO_REVIEW=true`, eligible high-confidence ordinary cleanup can be applied by server-side heuristics during import or review processing; peer-to-peer and ambiguous items remain manual.

The proposal-only finance action manifest in `src/lib/agents/finance-action-manifest.ts` defines read summaries and draft-only proposal actions for agent handoffs. `src/lib/agents/weekly-planning-context.ts` builds the v1 OpenClaw/assistant weekly planning context as a pure read model over existing spending, income, reimbursement, review, cashflow, and sync summaries. It excludes transfers from spend/income planning and surfaces transfers only as a separate signal, and it runs the manifest forbidden-field guard before handoff. The agent inbox at `/agent-inbox` is a proposal-first surface over open review items and stored review suggestions. It renders minimized enriched transaction context plus safe Plaid labels, omitting raw Plaid payloads, provider ids, tokens, auth headers, service-role keys, and cursors. Approvals reuse the explicit review acceptance action so writes stay user-initiated and audit-backed; dismissals reuse the standard review dismissal path.

## Settings Flow

Settings is deliberately narrow. The route renders Plaid Link connection, sync, repair, and disconnect controls plus the session sign-out action. Category management, review decisions, recurring work, AI suggestions, and dashboard finance summaries live on their own workflow pages instead of in Settings. Setup-state helpers remain in `src/lib/settings` for tests and future onboarding surfaces.

## Caching And Rendering

Finance pages use `dynamic = "force-dynamic"` so signed-in user data is read per request. CSV export and Plaid JSON responses set `Cache-Control: no-store`.

## Error Handling

- User-facing Plaid errors are generic.
- Server logs use safe Plaid error metadata from `src/lib/plaid/errors.ts`.
- Settings uses deterministic status helpers in `src/lib/plaid/status.ts` to translate common Plaid item errors into safe repair, retry, reconnect, or wait copy without exposing provider-sensitive ids.
- Database query errors are wrapped in `FinanceDbError`.
- Dashboard and table pages render configured/signed-in/error states instead of crashing where practical.

## Design System Notes

The UI is a dense finance tool, not a landing page. It favors:

- desktop sidebar navigation,
- mobile bottom navigation,
- compact cards and tables,
- tabular numeric data,
- explicit review states,
- restrained colors,
- clear empty/loading/error states.
