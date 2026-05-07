# Personal Finance OS PRD

## Product Summary

Personal Finance OS, branded in-app as Ledger, is a personal finance operating system for importing real financial activity, reviewing ambiguous transactions, and maintaining trusted budget data.

The product is built around one principle: raw provider data should be preserved, while user-approved enrichment should power decisions. Ledger does not blindly trust imported transactions. It makes uncertain items visible, asks for review, and keeps a record of material changes.

## Target User

The first user is an individual managing personal, business, shared, reimbursable, transfer, and recurring financial activity across multiple accounts.

This user needs:

- a reliable picture of balances and net worth,
- a way to clean imported transactions,
- confidence that transfers and peer-to-peer payments are not misclassified as spending,
- recurring expense awareness,
- exportable enriched records,
- a private and secure production deployment.

## Product Goals

- Connect financial institutions through Plaid.
- Import accounts, balances, balance snapshots, and transactions.
- Preserve raw Plaid transaction data.
- Maintain editable enriched transaction records.
- Show dashboard totals that are based on trusted data.
- Flag transactions that need review.
- Resolve peer-to-peer and shared spending through split allocation.
- Detect recurring expenses.
- Export enriched transaction data to CSV.
- Keep secrets, Plaid access tokens, and service-role credentials server-only.

## Non-Goals

- Native mobile app.
- Multi-user household collaboration.
- Autonomous AI edits.
- Tax-specific filing workflows.
- Receipt OCR.
- Public marketing site.
- Full production Plaid compliance program documentation.
- Background sync scheduler.

## Current Product Surface

### Login

Users sign in through Supabase Auth. Demo mode exists for local development, but it is disabled by default in production.

### Dashboard

The Today dashboard shows:

- net worth,
- cash, credit, investment, and retirement groups,
- balance trend,
- spending summary,
- recent transactions,
- review queue count,
- recurring context,
- insight cards with evidence-oriented copy.

### Transactions

Users can:

- search transactions,
- filter by date, account, category, intent, recurring status, and review status,
- inspect raw Plaid merchant/name/category context,
- edit merchant, category, intent, note, and recurring status,
- export filtered transactions to CSV.

### Review

The review queue explains why a transaction needs attention and lets the user:

- accept suggestions,
- dismiss review items,
- edit labels,
- resolve peer-to-peer transactions with structured splits.

Review reasons include:

- peer-to-peer payment,
- large transaction,
- transfer pair,
- unclear transfer,
- low confidence,
- missing category,
- new recurring candidate,
- recurring candidate.

### Recurring

The recurring view detects repeated transaction patterns and lets the user confirm or dismiss candidates.

### Accounts

The accounts view groups accounts by:

- cash,
- credit,
- investments,
- retirement.

It shows current balance, available balance, credit limit, currency, active state, institution, and last sync context.

### Settings

Settings includes:

- Plaid connection list,
- Plaid environment label,
- connect institution action,
- manual sync action,
- disconnect action,
- AI provider status,
- review and recurring summary.

## Key Workflows

### First Production Sign-In

1. User opens `/login`.
2. User signs in with Supabase Auth.
3. User lands on `/dashboard`.
4. User opens `/settings`.
5. User connects one Plaid institution.
6. App exchanges the public token server-side.
7. App imports accounts, balances, raw transactions, enriched transactions, and review items.
8. User reviews imported data before trusting totals.

### Daily Review

1. User opens `/dashboard`.
2. User sees review count and recent activity.
3. User opens `/review`.
4. User accepts, edits, dismisses, or splits flagged items.
5. Resolved items leave the open queue.
6. Dashboard and transaction totals update from enriched data.

### Peer-To-Peer Resolution

1. User opens a peer-to-peer review item.
2. User explains or allocates the real purpose.
3. User enters split labels, categories, intents, and amounts.
4. Split rows must total the full transaction amount.
5. App writes transaction splits, updates enrichment, resolves the review item, and records audit events.

### Recurring Review

1. User opens `/recurring`.
2. App shows detected recurring candidates.
3. User confirms or dismisses each candidate.
4. Confirmed recurring rows appear in summaries and future review context.

### Export

1. User filters transactions.
2. User exports CSV.
3. CSV includes enriched fields and selected raw Plaid context.
4. CSV excludes Plaid access tokens, auth secrets, and service credentials.

## Data Principles

- Raw Plaid data is preserved.
- Enriched data is the user-facing source of truth.
- Every finance row has `user_id`.
- RLS protects user-owned rows.
- Plaid access tokens are server-only and encrypted at rest.
- Service-role writes must still operate inside an authenticated user context.
- Review and recurring decisions should write audit events.
- Unresolved peer-to-peer data should not be treated as final spending truth.

## Security Requirements

- GitHub repository should be private for production.
- Production demo mode must be disabled unless deliberately enabled for a non-sensitive demo.
- Production Plaid access token encryption must use `PLAID_TOKEN_ENCRYPTION_KEY`.
- Browser security headers must be present.
- Mutating route handlers must reject invalid cross-origin requests.
- Supabase URL must use HTTPS in production.
- Provider secrets must never be sent to client components.
- Logs must not contain full secrets, raw auth headers, full Plaid payloads, or full database URLs.

## Acceptance Criteria

- A signed-in user can navigate all app views.
- Protected routes redirect unauthenticated users to `/login`.
- Local demo mode works outside production.
- Production hides demo mode by default.
- A Plaid Sandbox user can connect, sync, disconnect, and reconnect without duplicate transactions.
- Raw and enriched transaction records remain separate.
- Transaction edits persist.
- Review queue explains each item.
- Peer-to-peer splits require full allocation before resolution.
- Recurring candidates can be confirmed or dismissed.
- CSV export matches selected filters and excludes secrets.
- CI runs lint, typecheck, tests, build, and production dependency audit.

## Future Product Work

- Scheduled background sync.
- More complete insight evidence links.
- Merchant rules management UI.
- Reimbursement tracking UI.
- Audit event reporting UI.
- Category management UI.
- Token encryption migration tooling.
- Stronger end-to-end tests around Plaid and auth.
- Production observability and alerting.
