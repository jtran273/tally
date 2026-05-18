# Personal Finance OS

Personal Finance OS is a personal finance dashboard for importing bank data, reviewing messy transactions, tracking recurring spending, and turning raw account activity into trusted budget records.

The app is branded in the UI as **Tally**. It is currently built for one primary user, but the database already models every finance record with `user_id` so the product can expand later without rewriting the data ownership model.

## What Tally Is

Tally is not just a transaction table. It is a review-first finance workspace.

Bank feeds are useful, but imported data is often incomplete or misleading. Plaid can tell the app that a transaction was a Venmo payment, a transfer, or a generic merchant charge, but it cannot always know whether that activity was personal spending, business spending, shared spending, reimbursement, or a transfer that should not count against a budget.

Tally keeps those concepts separate:

- **Raw provider data** answers: what did Plaid send?
- **Enriched transaction data** answers: what should the user trust this transaction to mean?
- **Review items** answer: what still needs human judgment?
- **Splits, reimbursements, and recurring records** answer: how should activity affect budget and planning views?

This separation is the core of the product. It lets the app preserve evidence, explain calculations, and avoid treating uncertain imported data as final truth.

## Current Status

- GitHub repo: `jtran273/personal-finance-os`
- Visibility: public
- Default branch: `main`
- Deployment target: Vercel
- Production URL: `https://personal-finance-os-jtran273s-projects.vercel.app`
- Database/Auth: Supabase
- Financial data provider: Plaid
- Calendar context provider: Google Calendar, optional read-only
- Optional AI provider: OpenAI

Production hardening currently includes:

- Supabase Auth on protected app routes.
- Supabase RLS policies on finance tables.
- Server-only Plaid token exchange and sync.
- Encrypted Plaid access token storage.
- Service-route-only writes for Plaid items, agent proposals, and audit events, with sensitive raw Plaid columns hidden from direct authenticated selects.
- Seeded demo mode available locally by default and in production only when `ENABLE_DEMO_MODE=true`, with no real Supabase/Plaid data exposed.
- Same-origin checks for browser-initiated mutating route handlers, with scheduled Plaid sync, proactive scan, and OpenClaw briefing jobs protected separately by `CRON_SECRET`.
- Security headers in `next.config.ts`.
- Ignored local secret files and generated build output.
- GitHub secret scanning and push protection enabled on the public repository, with CodeQL, dependency review, Dependabot, production dependency audit, and app checks in CI.

## Design System

Tally uses a small product design system documented in `docs/design-system.md`. The app-wide tokens live in `src/app/globals.css`: paper surfaces, sage as the only brand accent, muted semantic colors, Instrument Serif headings, Inter Tight UI text, and JetBrains Mono for money, counts, masks, and timestamps.

Reusable primitives live in `src/components/ui/primitives.tsx` for buttons, panels, section headings, metrics, badges, and notices. Prefer those primitives before adding page-local versions of the same controls.

## Main Workflows

### Sign In

Users sign in with Supabase Auth at `/login`. Protected routes redirect unauthenticated users back to login.

Demo mode can open a seeded read-only workspace without Supabase or Plaid. It is separate from real Supabase/Plaid data, uses an HTTP-only demo cookie, defaults on for local development, and is available in production only when `ENABLE_DEMO_MODE=true`.

### Connect A Bank

In `/settings`, the user starts Plaid Link. The browser receives only a short-lived Plaid public token. The server exchanges that public token for a Plaid access token, encrypts it, stores it in Supabase, and immediately runs an initial sync.

The Plaid access token never goes to the browser.

### Sync Accounts And Transactions

Initial, manual, and scheduled sync can import:

- institutions,
- Plaid items,
- accounts,
- current balances,
- balance snapshots,
- raw transactions,
- enriched transactions,
- review items.

Sync is designed to be idempotent so repeated syncs do not create duplicate transaction records.
Each initial, manual, or scheduled sync also writes a persisted run summary with item counts, changed-row counts, status, and sanitized error metadata. Browser responses and Settings show app-owned connection ids and safe status only, not Plaid access tokens, transaction cursors, raw payloads, or provider item ids.

Settings derives safe sync status from stored Plaid item fields: item state, last successful sync time, and sanitized Plaid error code. The browser never receives access tokens, transaction cursors, raw provider payloads, or Plaid request ids. When a connection reports a repairable item error, Settings can open Plaid Link update mode for that item and then run a one-item sync.

If Plaid account and balance data are available but Transactions Sync is not enabled or ready for an item, Tally can still import accounts, balances, and balance snapshots. The sync summary records skipped transaction rows and safe error metadata without advancing the transaction cursor.

Disconnecting a Plaid item stops future syncs and keeps historical Tally rows visible. The revoked Plaid item row remains as a disconnected tombstone with a marker token and cleared cursor, while accounts, balances, transactions, reviews, recurring rows, and reimbursements are preserved. If old token encryption cannot be decrypted during disconnect, Tally can still mark the item revoked locally so it no longer syncs.

Destructive Plaid data cleanup is a separate service-role CLI for revoked items only. It dry-runs by default:

```bash
npm run plaid:cleanup -- --user-id <user-id> --institution-name "SchoolsFirst Federal Credit Union"
```

Actual deletion requires `--execute --confirm DELETE_PLAID_ITEM_DATA`.

The app also performs a throttled opportunistic Plaid sync on app open through `/api/plaid/sync/opportunistic`. It skips items synced successfully in the last 24 hours and no-ops if another sync is already running.

Scheduled sync is exposed through `/api/plaid/sync/scheduled` and requires `Authorization: Bearer <CRON_SECRET>`. The same secret protects `/api/agents/proactive-scan/scheduled`, which runs a bounded reimbursement-candidate detector loop, and `/api/openclaw/briefing/scheduled`, which compiles or updates the current OpenClaw briefing proposal.

### Review Transactions

The review queue flags transactions that need judgment, including:

- peer-to-peer payments,
- large charges,
- unclear transfers,
- transfer pairs,
- low-confidence categories,
- missing categories,
- recurring candidates.

Plaid import automatically applies high-confidence, ordinary merchant/category/intent cleanup before the rows reach the user. OpenAI-backed automatic review cleanup and proactive scans are off by default to control token usage; users can generate AI suggestions manually from review items, enable automatic OpenAI work with `ENABLE_OPENAI_AUTO_REVIEW=true`, and enable the scheduled proactive detector separately with `PROACTIVE_SCAN_ENABLED=true`. Manual review is still required for peer-to-peer payments, large charges, shared/reimbursable intent, transfers, missing AI confidence, and unknown categories.
Users can accept ready suggestions one at a time, generate a suggestion for one review item, dismiss non-peer-to-peer review items, edit a transaction inline, or resolve peer-to-peer payments with structured splits. Manual-only peer-to-peer rows require an explanation and split allocation before leaving review.
Accepted AI suggestions and review-page manual edits can save reusable merchant rules when the merchant/category/intent decision is specific enough for future imports. Stale missing-category reviews can also be auto-resolved on the review page when the enriched row already has an exact category match.
Reimbursable split portions and tracked reimbursement records are surfaced separately from owned spending so shared expenses do not inflate trusted budgets.
Core reimbursement-link helpers can attach a received positive inflow to an existing reimbursement record, preserve partial outstanding balances, mark the received enriched row as reimbursable so it does not inflate income reports, and write audit events for link/unlink decisions without changing raw provider rows. Tally can also rank likely peer-to-peer reimbursement inflows against outstanding shared or reimbursable expenses, but those deterministic suggestions still require explicit user confirmation before any write.

Ambiguous reimbursement matches should become concise clarification requests only when the answer would materially change accounting and the system has at least medium confidence. The v1 path is seamless bank data plus Tally/OpenClaw reasoning: Plaid imports activity, Tally drafts a compact clarification request, and OpenClaw asks one short question only when needed. CSV exports or future manual imports can support optional historical backfill, but they are not required for automated v1 reimbursement clarification.

### Agent Inbox

The `/agent-inbox` route remains available as a secondary proposal/audit queue for finance-agent recommendations. It derives sanitized proposals from open review items and stored suggestions; it is not a separate autonomous mutation store. The primary workflow is `/review`; the main navigation points there so high-confidence automation stays out of the way and only exceptions need attention.

Tally also has a persistent `agent_proposals` store for longer-lived assistant proposals and clarification requests. The store is user-owned, RLS-protected, and accepts only minimized evidence/proposed-patch JSON that passes forbidden-field checks. Persisted proposals can be dismissed, answered, or accepted only through Tally-owned helpers that re-read the current finance rows and write audit events.

Approving an inbox item applies the same explicit review approval path used by `/review`; dismissing an item only resolves the review item as dismissed. Import-time auto-categorization is limited to conservative high-confidence cleanup and records audit events.

### Edit Enriched Records

The transaction edit view lets the user change app-facing fields:

- merchant,
- category,
- intent,
- notes,
- recurring status.

Raw Plaid fields stay preserved for context and auditability.

Transactions can be filtered by search, month, date range, account, category, direction, intent, review state, review reason, quality state, row limit, and transfer exclusion. CSV export uses the same filter model so exported rows match the visible transaction slice.

The transaction list also includes a merchant cleanup control for user-initiated repeated fixes, such as applying a food category to all McDonald's rows or moving Retail Wash rows into Auto / Car Maintenance. The cleanup updates matching enriched rows, writes audit events, and can save a merchant rule for future imports.

### Configure The Workspace

Settings is intentionally minimal: it keeps Plaid connection, sync, repair, and disconnect controls, optional read-only Google Calendar context, mobile install/notification boundary copy, and session access only. Dashboard, Transactions, Review, and Recurring own the day-to-day finance workflow so Settings does not become a second workspace.

Tally supports a lightweight home-screen install through a web app manifest and safe product icons. Push notifications are intentionally deferred; conversational reminders and clarification prompts belong to OpenClaw unless a future opt-in Tally status-alert surface passes the security requirements in `docs/mobile-pwa-notifications.md`.

### Track Recurring Spending

The recurring detector scans imported transactions for repeated merchant, amount, and cadence patterns. Users can confirm or dismiss candidates from `/recurring`.
The recurring page also builds a deterministic next-30-day cashflow calendar from confirmed or pending recurring rows plus recurring positive transaction history, so upcoming bills, expected income, and projected cash after scheduled activity can be reviewed without exposing provider identifiers.

### Export

The CSV export uses the current transaction filters and returns enriched finance data plus safe raw Plaid context. It rejects cross-site browser reads and does not export Plaid access tokens, provider transaction ids, service-role keys, auth headers, or provider secrets.

CSV or manual import workflows are optional backfill tools, not the core reimbursement workflow. The main product path should continue to rely on connected bank data, review-safe AI or heuristic suggestions, and explicit user approval before writes.

## App Pages

| Route | What it does |
| --- | --- |
| `/login` | Supabase sign-in and seeded demo entry |
| `/dashboard` | Balance dashboard with Net worth, Liquid, Debt, and Spendable scopes, sync freshness, selected-period transactions, liabilities due, category trend/month views, and a simplified mobile balance summary |
| `/transactions` | Filterable enriched transaction table with review reason filters, merchant cleanup, reimbursement badges, and CSV export |
| `/transactions/[transactionId]` | Transaction edit page with raw Plaid context |
| `/agent-inbox` | Derived proposal queue for sanitized finance-agent recommendations from open review items |
| `/review` | Queue for transactions that need human review, including reimbursable shared-expense context |
| `/recurring` | Recurring expense candidates, confirmed recurring rows, and the next-30-day cashflow calendar |
| `/accounts` | Compact account cards with balances, account-filtered transaction links, conditional recent activity, and investment detail; connection health stays in Settings |
| `/settings` | Plaid connection/sync/repair/disconnect controls, Google Calendar read connection, mobile install/notification boundary, and session access |

## Stack

- Next.js App Router
- React
- TypeScript
- CSS Modules and global CSS
- Supabase Auth
- Supabase Postgres
- Plaid Link and Plaid Transactions
- Google Calendar read-only OAuth
- Optional OpenAI Responses API provider
- Vercel
- GitHub Actions
- Node test runner with `tsx`
- Playwright smoke tests

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Default local URL:

```text
http://localhost:3000
```

Run the core checks:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm test
npm run test:e2e
npm run build
npm audit --omit=dev
git diff --check
```

`npm test` runs `npm run typecheck` followed by the Node unit tests. `npm run test:e2e` starts the Next.js dev server through Playwright and exercises the seeded demo workspace. Use `PLAYWRIGHT_BASE_URL` to choose a local host or port for that server.

## Environment Variables

Local secrets belong in `.env.local`. Do not commit real values.

Common local shape:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_SANDBOX_SECRET=
PLAID_PRODUCTION_SECRET=
PLAID_TOKEN_ENCRYPTION_KEY=
PLAID_ENV=sandbox
PLAID_REDIRECT_URI=http://localhost:3000/settings
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/api/calendar/callback
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=
ENABLE_OPENAI_AUTO_REVIEW=false
ENABLE_DEMO_MODE=true
CRON_SECRET=
OPENCLAW_TOKEN=
OPENCLAW_USER_ID=
OPENCLAW_BRIEFING_CADENCE=weekly
PROACTIVE_SCAN_ENABLED=false
PROACTIVE_SCAN_USER_ID=
PROACTIVE_SCAN_MAX_TX=100
FIDELITY_HOLDINGS=AAPL:10,NVDA:2,cash:0
MANUAL_INVESTMENT_HOLDINGS='[{"accountName":"Brokerage","cash":0,"holdings":[{"symbol":"AAPL","shares":10}]}]'
```

For production Plaid Link, leave `PLAID_REDIRECT_URI` unset unless you are using OAuth institutions that require a redirect. If you set it, use the exact HTTPS URI registered in the Plaid dashboard; `NEXT_PUBLIC_APP_URL` is not used as a production Plaid redirect fallback.

Generate a production Plaid token encryption key with:

```bash
openssl rand -base64 32
```

Use [DEPLOYMENT.md](DEPLOYMENT.md) for the full environment table and production setup.

`FIDELITY_HOLDINGS` is optional and server-only. Use it for manually tracked Fidelity holdings that Plaid does not sync, with `SYMBOL:shares` pairs plus optional `cash`. `MANUAL_INVESTMENT_HOLDINGS` supports the same manual valuation path for other accounts as JSON, keyed by `accountName` or `institutionName` with optional `cash` and `holdings`. When either value is set, dashboard and account totals use recent market quotes for matching manual accounts and leave Plaid sync untouched.

## Demo Mode

Demo mode is intended for local development, screenshots, smoke tests, CI, and deliberate product walkthroughs. It uses a seeded in-memory finance workspace, not real Supabase/Plaid data. Demo mode defaults on outside production and defaults off in production unless `ENABLE_DEMO_MODE=true`.

Demo data is read-only. Buttons that would connect Plaid, connect Google Calendar, sync, disconnect, clean up merchants, edit transactions, resolve review items, or confirm recurring rows render as preview/read-only controls and do not call real provider or write paths.

The seeded workspace includes review cases for missing category, unclear transfer, recurring candidate, low-confidence cleanup, and merchant-rule testing, including Retail Wash rows that exercise the merchant cleanup flow.

Set it explicitly when a scripted environment needs the seeded workspace:

```bash
ENABLE_DEMO_MODE=true npm run test:e2e
```

Set `ENABLE_DEMO_MODE=false` when testing only the real Supabase sign-in path. Set `ENABLE_DEMO_MODE=true` deliberately on any production deployment that should show the seeded demo entry.

## Repository Map

```text
src/app/                         Next.js pages, route handlers, server actions, layouts
src/components/brand/            Tally brand mark
src/components/finance/          Dashboard, transactions, review, recurring, accounts, settings UI
src/components/ledger/           Seeded Tally data and legacy prototype UI used by demo cases
src/components/plaid/            Plaid Link connection panel
src/components/shell/            Authenticated app navigation shell
src/components/ui/               Reusable Tally primitives
src/lib/agents/                  Agent-safe finance manifest and derived proposal helpers
src/lib/ai/                      AI provider interface, deterministic fallback, optional OpenAI provider
src/lib/calendar/                Google Calendar OAuth, token vault, event listing, and safe context builder
src/lib/db/                      Typed Supabase query helpers and app-facing finance records
src/lib/demo/                    Local demo mode and seeded in-memory finance client
src/lib/export/                  CSV export helpers
src/lib/finance/                 Balance, budget guardrail, cashflow, and spending calculations
src/lib/insights/                Insight generation helpers and tests
src/lib/plaid/                   Plaid config, client, sync, token vault, and safe error handling
src/lib/recurring/               Recurring detection and recurring mutations
src/lib/review/                  Review reasons, heuristics, and suggestion helpers
src/lib/security/                Request security helpers
src/lib/settings/                Setup-state helpers retained for tests and future onboarding surfaces
src/lib/supabase/                Supabase browser/server clients and auth middleware
supabase/migrations/             Database schema, indexes, grants, RLS policies
supabase/seed.sql                Development seed data only
e2e/                             Playwright smoke tests
.github/dependabot.yml           Dependency and GitHub Actions update checks
.github/workflows/ci.yml         Main app CI checks
.github/workflows/codeql.yml     CodeQL static analysis
.github/workflows/dependency-review.yml
                                  Dependency review for pull requests
```

## Documentation Set

The repo intentionally keeps the main docs focused:

- [README.md](README.md): product overview, workflows, local setup, and repo map.
- [ARCHITECTURE.md](ARCHITECTURE.md): how the app is structured, how data flows, and where key code lives.
- [SECURITY.md](SECURITY.md): auth, RLS, secret handling, Plaid token protection, headers, and incident response.
- [DEPLOYMENT.md](DEPLOYMENT.md): Vercel, Supabase, Plaid, OpenAI, and production environment setup.
- [OPERATIONS.md](OPERATIONS.md): day-to-day checks, smoke tests, troubleshooting, maintenance, and rotation runbooks.
- [ROADMAP.md](ROADMAP.md): active backlog plus shipped items from the earlier buildout roadmap.
- [AGENTS.md](AGENTS.md): contribution guardrails for agent-driven PRs and overnight maintenance work.

Supporting docs, such as historical review notes or the agent finance action manifest under `docs/`, may exist for context, but these primary files are the docs to update when behavior changes.

## PR Workflow

Before opening a PR:

1. Keep the diff scoped to the requested behavior.
2. Update docs for setup, environment, security, CI, route, or data-model changes.
3. Run the relevant checks from [OPERATIONS.md](OPERATIONS.md), or call out any skipped checks and why.
4. Fill in the PR template with user impact, security/data-safety notes, verification, and agent handoff details.

CI runs install, lint, typecheck, unit tests, build, Playwright smoke tests in demo mode, production dependency audit, and whitespace checks on PRs to `main`. Separate security workflows run CodeQL analysis and dependency review, and Dependabot is configured for npm and GitHub Actions updates.

## Development Rules

- Keep real secrets in `.env.local`, Vercel, Supabase, Plaid, and OpenAI dashboards only.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, Plaid secrets, Plaid access tokens, database URLs, or auth headers to client components.
- Keep raw Plaid data separate from enriched transaction data.
- Write user-facing edits to enriched records.
- Record material review and transaction changes in `audit_events`.
- Treat unresolved review and peer-to-peer items as uncertain until the user resolves them.
- Update the relevant main doc when routes, environment variables, data model, deployment behavior, or security behavior changes.
