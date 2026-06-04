# Architecture

Tally is a Next.js App Router application backed by Supabase Postgres, Supabase Auth, Plaid, and an optional AI suggestion provider. The architecture keeps provider data, user-approved enrichment, review workflow, and dashboard calculations separate so the app can explain where every number came from.

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
- `src/components/ui` owns reusable Tally primitives for buttons, panels, headings, metrics, badges, and notices.
- `src/components/brand` owns the Tally mark used by app shell and login surfaces.
- `src/lib/db` owns typed database access and conversion from database rows to app records.
- `src/lib/plaid` owns Plaid configuration, Link token creation, public token exchange, transaction sync, disconnect, token encryption, and safe error handling.
- `src/lib/calendar` owns read-only Google Calendar OAuth, encrypted token storage, token refresh, bounded event reads, and safe upcoming-event context.
- `src/lib/demo` owns local demo mode and seeded in-memory finance data.
- `src/lib/anomaly` owns deterministic persisted anomaly detectors, scan orchestration, and minimized OpenClaw alert packets.
- `src/lib/agents` owns the proposal-only finance action manifest, OpenClaw-safe context contracts, clarification policy, weekly planning context, and proposal-store safety helpers.
- `src/lib/review`, `src/lib/recurring`, `src/lib/finance`, `src/lib/settings`, and `src/lib/insights` own domain calculations and setup-state helpers.
- `supabase/migrations` owns schema, indexes, grants, RLS, and policies.

## Route Map

### Pages

| Route | Purpose | Data source |
| --- | --- | --- |
| `/login` | Supabase Auth sign-in and optional local demo entry | Supabase Auth server client |
| `/dashboard` | Balance dashboard with Net worth, Liquid, Debt, and Spendable scopes, sync freshness, selected-period transaction activity, liabilities due, credit-card payoff plan (per-card utilization tiers + cash allocation), category trend/month spending views, and mobile summary | Accounts, snapshots, transactions |
| `/transactions` | Searchable/filterable transaction table, summary cards, merchant cleanup, CSV export link | Accounts, categories, enriched transactions |
| `/transactions/[transactionId]` | Transaction edit surface | One enriched transaction plus categories |
| `/agent-inbox` | Sanitized proposal inbox derived from open review items and normalized review suggestions | Open review items and stored suggestions |
| `/review` | Review queue and split workflow | Review items, categories, transactions |
| `/recurring` | Recurring candidates and recurring rows | Transactions, recurring expenses |
| `/accounts` | Compact account cards with balances, account-filtered transaction links, conditional recent activity, and investment detail; Plaid connection health stays in Settings | Accounts, balance snapshots, and recent transactions |
| `/audit` | Advanced sanitized change trail for debugging and data integrity checks | Audit events |
| `/settings` | Plaid connection, sync, repair, disconnect, Calendar read connection, and session access | Plaid and Calendar connections |

### Route Handlers

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/plaid/connections` | `GET` | List active/error/revoked Plaid connections for the signed-in user |
| `/api/plaid/link-token` | `POST` | Create a Plaid Link token for the signed-in user, including update mode for a selected item; demo mode rejects this write path |
| `/api/plaid/exchange` | `POST` | Exchange a Plaid public token, persist item metadata, then run initial sync; demo mode rejects this write path |
| `/api/plaid/sync` | `POST` | Manually sync all active Plaid connections, or one selected connection; demo mode returns a no-op seeded sync result |
| `/api/plaid/sync/scheduled` | `GET`/`POST` | Run scheduled sync for all users with syncable Plaid items when authorized with `CRON_SECRET` |
| `/api/plaid/connections/[connectionId]` | `DELETE` | Remove a Plaid item, stop future sync, and retain a revoked tombstone row while preserving historical Tally rows |
| `/api/calendar/auth-url` | `POST` | Start read-only Google Calendar OAuth for the signed-in user; demo mode rejects this write path |
| `/api/calendar/callback` | `GET` | Complete Google Calendar OAuth after state-cookie validation |
| `/api/calendar/connections` | `GET` | List signed-in user's Calendar connection status without token fields |
| `/api/calendar/connections/[connectionId]` | `DELETE` | Disconnect Calendar and stop future event reads |
| `/api/agents/proactive-scan/scheduled` | `GET`/`POST` | Run a bounded reimbursement candidate detector scan when authorized with `CRON_SECRET` |
| `/api/openclaw/anomaly-alerts/scheduled` | `GET`/`POST` | Persist deterministic anomaly alerts for the configured OpenClaw user when authorized with `CRON_SECRET` |
| `/api/openclaw/signals` | `GET` | Return bearer-auth OpenClaw-safe proposal, planning, and calendar signals |
| `/api/openclaw/outbox` | `GET` | Return delivery-neutral OpenClaw message packets, including clarification, review, reimbursement, anomaly, and budget messages |
| `/api/openclaw/recent-transactions` | `GET` | Return bounded OpenClaw-safe recent transaction DTOs without raw Plaid context |
| `/api/openclaw/review-items` | `GET` | Return bounded OpenClaw-safe open review items without raw Plaid context |
| `/api/openclaw/reimbursements` | `GET` | Return outstanding reimbursement summaries and bounded reimbursement items |
| `/api/openclaw/safe-to-spend` | `GET` | Return a bounded green/yellow/red spend answer from existing planning context |
| `/api/openclaw/query` | `POST` | Route allowlisted structured OpenClaw read intents to safe read endpoints |
| `/api/openclaw/replies` | `POST` | Record bearer-auth OpenClaw clarification answers |
| `/api/openclaw/briefing/scheduled` | `GET`/`POST` | Compile or update the current OpenClaw briefing proposal when authorized with `CRON_SECRET` |
| `/api/export/transactions` | `GET` | Export filtered enriched transactions as CSV |
| `/login/demo` | `POST` | Set demo cookie when demo mode is enabled |
| `/login/logout` | `POST` | Sign out and clear demo cookie |

Browser-initiated mutating route handlers use same-origin validation through `src/lib/security/request.ts`. The CSV export route is a credentialed read and rejects cross-site browser reads. Scheduled Plaid sync, proactive scan, and OpenClaw briefing routes are the exceptions: they are intended for trusted server jobs and are authorized with `CRON_SECRET` instead of browser same-origin checks.

## Data Model

The finance schema is in `supabase/migrations/20260506000100_finance_schema.sql`.

Core tables:

- `institutions`: institution metadata, Plaid institution id, branding fields.
- `plaid_items`: Plaid item ids, encrypted Plaid access tokens, sync cursors, product and error state.
- `plaid_sync_runs`: persisted initial/manual/scheduled sync summaries with item status, changed-row counts, and safe error metadata.
- `plaid_sync_run_items`: per-item sync outcomes keyed by app-owned Plaid item row ids, not provider item ids.
- `google_calendar_connections`: read-only Google Calendar OAuth connection metadata plus encrypted access and refresh tokens. Authenticated clients can select only non-token columns; writes are service-route-only.
- `accounts`: account metadata, balances, masks, active state, and grouping fields.
- `balance_snapshots`: point-in-time account balances for trends.
- `categories`: user-owned categories.
- `raw_transactions`: immutable Plaid transaction fields and raw payload.
- `enriched_transactions`: editable app-facing merchant, category, intent, notes, review state, and confidence.
- `review_items`: open/resolved/dismissed review tasks generated from heuristics and suggestions, including peer-to-peer, large, transfer-pair, new-recurring, low-confidence, missing-category, unclear-transfer, and recurring-candidate reasons.
- `transaction_splits`: split allocations for peer-to-peer or shared spending.
- `reimbursement_records`: expected/requested/received reimbursement tracking for reimbursable split portions.
- `agent_proposals`: persistent user-owned assistant proposals and clarification requests. Evidence and proposed patches are JSON objects that must pass forbidden-field checks before insert; accepted writes still re-read user-owned finance rows and write audit events.
- `anomaly_alerts`: deterministic user-owned finance exceptions, keyed by stable dedupe keys so dismissed or resolved alerts do not re-page. Evidence is minimized and checked against assistant forbidden fields before persistence.
- `recurring_expenses`: confirmed, pending, paused, or dismissed recurring rows.
- `insights`: persisted insight cards.
- `merchant_rules`: reusable merchant/category/intent rules for future automation.
- `audit_events`: material changes to labels, review state, recurring rows, and related records.

Every finance table includes `user_id`. RLS policies enforce user ownership.
Sensitive raw/provider columns are additionally hidden from direct authenticated selects where the browser does not need them, including Plaid access tokens, Plaid item ids, sync cursors, raw provider payloads, provider transaction ids, location, and payment metadata. `plaid_items`, `agent_proposals`, `anomaly_alerts`, and `audit_events` writes go through service-route code instead of direct browser-table writes.

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
Plaid API failures retain safe item codes when Plaid returns them, and otherwise keep safe HTTP status, error type, or transport code details when available. Non-Plaid exceptions during import persistence are stored as `PLAID_SYNC_INTERNAL_ERROR` with a safe sync step so Tally does not misreport local save failures as generic Plaid request failures.

When Plaid returns `PRODUCT_NOT_ENABLED`, `PRODUCT_NOT_READY`, or `INVALID_PRODUCT` for Transactions Sync, Tally treats transactions as skipped for that item while still importing accounts, balances, and balance snapshots where available. The sync run records skipped transaction counts and safe warning metadata, and it does not advance the item's transaction cursor on a skipped transaction pass.

The access token never leaves server code.

Disconnect is intentionally non-destructive for Tally-owned finance data. The service removes the item from Plaid, or marks it revoked locally when the old stored token can no longer decrypt, then keeps the `plaid_items` row as a disconnected tombstone with the stored cursor cleared and token ciphertext replaced by a revoked marker. Historical accounts, snapshots, raw/enriched transactions, reviews, splits, reimbursements, recurring rows, agent proposals, sync run items, and audit events remain available. The separate `npm run plaid:cleanup` CLI is the only destructive path and refuses to execute against non-revoked Plaid items.

## Calendar Flow

Google Calendar is optional and read-only.

1. Settings requests `/api/calendar/auth-url`.
2. The route validates same-origin session access, creates a short-lived OAuth state cookie, and returns a Google OAuth URL scoped only to `https://www.googleapis.com/auth/calendar.readonly`.
3. Google redirects back to `/api/calendar/callback`.
4. The callback validates the state cookie and signed-in Supabase session, exchanges the code server-side, encrypts the access and refresh tokens, and stores the primary Calendar connection row.
5. OpenClaw signal loading refreshes tokens when needed and reads the next 14 days of primary-calendar events.
6. The safe context builder emits only start, end, redacted/truncated title, `locationCity`, all-day flag, and suspected category.

Calendar descriptions, attendees, attendee emails, raw Google event payloads, OAuth tokens, and provider diagnostics are not included in agent context. The generic field name `location` remains forbidden in finance/assistant manifests; calendar context uses `locationCity` to avoid confusing city-only planning context with raw provider location data.

## Transaction Flow

Plaid data lands first in `raw_transactions`. The app then creates or updates `enriched_transactions` for user-facing edits and reporting.

Raw fields answer "what did Plaid send?" Enriched fields answer "what does the user trust this transaction to mean?"

This split lets the app:

- keep provider history intact,
- update labels without losing original evidence,
- re-run heuristics from raw data,
- show raw Plaid context in the edit UI,
- avoid treating unresolved activity as final budget truth.

The `/transactions` surface supports explicit merchant cleanup for repeated label fixes. A user can match merchant/raw-name text, choose one saved category and intent, update matching enriched rows, and optionally persist a merchant rule so future Plaid imports receive the same app-facing category. The action records audit events and does not mutate raw Plaid rows. Transaction filters include search, month, date range, account, category, direction, intent, review state, review reason, quality state, row limit, and transfer exclusion.

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

The reimbursement schema also supports linking a received positive inflow to an existing reimbursement record through app-owned enriched rows. Linking updates only `reimbursement_records` and the received inflow's enriched intent, leaving `raw_transactions` unchanged. Linked reimbursement inflows use intent `reimbursable`, so spending reports continue to exclude reimbursable portions and income reports do not treat received reimbursements as earned income. Link and unlink helpers write `audit_events` with before/after reimbursement snapshots, the received transaction id, applied amount, outstanding amount, and source metadata.

`src/lib/finance/reimbursement-matching.ts` provides a pure deterministic helper for ranking possible reimbursement inflows against outstanding reimbursable expenses. It filters out transfers, payroll-like income, negative transactions, and inflows already linked to reimbursement records, then returns app-owned transaction ids, confidence, score, and human-readable reasons. It is advisory only: no raw Plaid rows are mutated, no reimbursement link is written, and linking still requires explicit user confirmation through the audited write path.

Accepted AI cleanups and review-page manual edits can upsert reusable merchant rules for future imports when the normalized merchant, category, and intent are specific enough. Rule creation writes audit events and still keeps raw Plaid rows immutable. The review page also auto-resolves stale `missing-category` review items when the enriched transaction already has an exact category match.

## Recurring Flow

`src/lib/recurring/detector.ts` scans persisted transactions for repeated merchants, amounts, and date cadence. Candidates can be confirmed or dismissed from `/recurring`. Confirmed and pending rows feed the recurring page timeline; dashboard cashflow summaries remain future work.

`src/lib/finance/cashflow.ts` also builds the upcoming cashflow calendar as a pure calculation. Confirmed and pending recurring rows produce scheduled bill events, while recurring posted positive transactions produce projected income events when their history has a deterministic cadence. `/recurring` displays only app-owned merchant, amount, date, cadence, and account-derived cash totals; Plaid provider ids and raw payloads are not part of the timeline model.

## Dashboard Calculations

`src/lib/finance/balances.ts` derives account totals, sync freshness, and balance trends from accounts, balance snapshots, and transaction history. The dashboard supports Net worth, Liquid, Debt, and Spendable views over 1-week, 1-month, 3-month, 6-month, 1-year, and all-time ranges; internally those map to `netWorth`, `cash`, `liabilities`, and `cashMinusLiabilities`. Desktop layouts render the interactive balance chart; mobile layouts use a simplified balance summary with the same range controls and transaction link so phone views avoid horizontal chart overflow. Selecting a point in the desktop trend surfaces the related non-transfer transactions and links back to the transaction filters.

`src/lib/finance/liabilities.ts` builds the liabilities-due panel from active credit accounts, cash balances, credit limits, and likely payment transactions. It prefers Plaid liabilities fields (`next_payment_due_date`, `last_statement_issue_date`, `last_statement_balance`, `minimum_payment_amount`) when available and otherwise estimates due dates from the last payment, highlighting overdue or due-soon balances without relying on provider-sensitive ids.

`src/lib/finance/payoff-plan.ts` is a pure helper that turns the same active credit accounts plus available cash into a deterministic payoff recommendation for the dashboard. It classifies per-card utilization into Optimal (<10%), OK (<30%), High (30–50%), and Critical (50%+) tiers, greedily allocates cash to drop above-30% cards to 30%, then below 10%, then by remaining balance. The returned plan exposes a per-card `nextReportingDate` (≈ due date + 9 days, or `last_statement_issue_date` + 30 when Plaid supplies it) and rolls all dates forward in 30-day cycles whenever an estimate has passed, so the panel stays correct as time advances. No AI dependency; the allocator and copy are fully deterministic.

`src/lib/finance/spending.ts` powers category spending breakdowns, spending confidence, reimbursement-aware totals, and cleanup quality flags. The dashboard category panel can show cumulative category trends for the selected range or month-by-month category rows for the last six months. The separate `budget-guardrails.ts` helper remains available for deterministic guardrail summaries, but it is not the primary dashboard surface today.

## AI Suggestion Flow

`src/lib/ai` defines a provider interface. The deterministic provider is the safe fallback. The OpenAI provider is optional and only runs when `OPENAI_API_KEY` is present on the server. Automatic OpenAI cleanup on Plaid import and review page load is disabled unless `ENABLE_OPENAI_AUTO_REVIEW=true`; scheduled proactive scans are disabled unless `PROACTIVE_SCAN_ENABLED=true`, and they use OpenAI only when `ENABLE_OPENAI_AUTO_REVIEW=true`. Manual review actions can still request one suggestion at a time.

Manual AI suggestions are advisory and require explicit user acceptance. When `ENABLE_OPENAI_AUTO_REVIEW=true`, eligible high-confidence ordinary cleanup can be applied by server-side heuristics during import or review processing; peer-to-peer and ambiguous items remain manual.

The proposal-only finance action manifest in `src/lib/agents/finance-action-manifest.ts` defines read summaries and draft-only proposal actions for agent handoffs. `src/lib/agents/weekly-planning-context.ts` builds the v1 OpenClaw/assistant weekly planning context as a pure read model over existing spending, income, reimbursement, review, cashflow, and sync summaries. It excludes transfers from spend/income planning and surfaces transfers only as a separate signal, and it runs the manifest forbidden-field guard before handoff.

The `agent_proposals` table persists longer-lived assistant suggestions and clarification requests so OpenClaw integrations do not need to recreate state from open review items on every poll. `src/lib/db/queries.ts` exposes creation, listing, dismissal, clarification-answer recording, and narrow acceptance helpers. Inserted evidence and proposed patches are JSON objects checked by the assistant forbidden-field guard; expired pending proposals are hidden from normal pending lists. Acceptance is not autonomous: Tally re-reads the current user-owned target row, dispatches through known mutation paths such as review suggestion acceptance or reimbursement matching, and writes `audit_events`.

The `anomaly_alerts` table persists deterministic alerts for OpenClaw delivery. The scheduled scan loads bounded account and transaction context, emits stable dedupe keys for high-signal conditions, inserts only new alerts, and refreshes still-pending matches. Dismissed and resolved dedupe keys suppress future inserts so the same condition does not repeatedly notify. OpenClaw outbox packets omit evidence and ids beyond the app-owned alert id.

`src/lib/review/reimbursement-candidates.ts` detects unlabeled personal expenses that may be reimbursable before the user marks them shared. It runs a deterministic prefilter over safe enriched transaction summaries and nearby positive inflows, then asks the configured AI suggestion provider to refine the candidate into a `reimbursement_candidate` proposal. The detector only emits proposals and clarification questions; it does not create splits, reimbursement records, or links.

The `/review` route is the primary human review surface for transaction exceptions. The agent inbox at `/agent-inbox` remains available as a secondary proposal/audit queue for derived review proposals. It renders minimized enriched transaction context plus safe Plaid labels, omitting raw Plaid payloads, provider ids, tokens, auth headers, service-role keys, and cursors. Broader persisted proposal browsing is future UI work.

Ambiguous reimbursement clarification is modeled as an agent-safe question request, not a mutation. `src/lib/agents/clarifications.ts` decides whether a reimbursement candidate should interrupt James, stay silent, or remain queued in the app based on confidence, accounting impact, open-question batching, and value thresholds. The resulting `assistant_clarification_request` carries minimized transaction context, a single question, evidence strings, and `writesAllowed: false`. Answers become feedback for future reimbursement matching and suppression, but any split, reimbursement record, merchant rule, or review resolution still needs an explicit approval path that re-reads user-owned rows and writes audit events.

CSV exports and any future manual imports are optional backfill or reconciliation tools. CSV exports include enriched rows and safe raw merchant/category labels, but not Plaid provider transaction ids. They are not required in the v1 automated clarification path, which should rely on Plaid/bank data, Tally heuristics, optional LLM reasoning, and OpenClaw asking only when the answer changes accounting meaningfully.

## Settings Flow

Settings is deliberately narrow. The route renders Plaid Link connection, sync, repair, and disconnect controls; optional Google Calendar read connection controls; and the session sign-out action. Category management, review decisions, recurring work, AI suggestions, and dashboard finance summaries live on their own workflow pages instead of in Settings. Setup-state helpers remain in `src/lib/settings` for tests and future onboarding surfaces.

## Caching And Rendering

Finance pages use `dynamic = "force-dynamic"` so signed-in user data is read per request. CSV export and Plaid JSON responses set `Cache-Control: no-store`.

## Error Handling

- User-facing Plaid errors are generic.
- Server logs use safe Plaid error metadata from `src/lib/plaid/errors.ts`.
- Settings uses deterministic status helpers in `src/lib/plaid/status.ts` to translate common Plaid item errors into safe repair, retry, reconnect, or wait copy without exposing provider-sensitive ids.
- Database query errors are wrapped in `FinanceDbError`.
- Dashboard and table pages render configured/signed-in/error states instead of crashing where practical.

## Design System Notes

The design system is documented in `docs/design-system.md`. The UI is a dense finance tool, not a landing page. It favors:

- desktop sidebar navigation,
- mobile bottom navigation,
- compact cards and tables,
- tabular numeric data,
- explicit review states,
- restrained colors,
- clear empty/loading/error states.
