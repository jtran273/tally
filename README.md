# Personal Finance OS

Personal Finance OS is a personal finance dashboard for importing bank data, reviewing messy transactions, tracking recurring spending, and turning raw account activity into trusted budget records.

The app is branded in the UI as **Ledger**. It is currently built for one primary user, but the database already models every finance record with `user_id` so the product can expand later without rewriting the data ownership model.

## What Ledger Is

Ledger is not just a transaction table. It is a review-first finance workspace.

Bank feeds are useful, but imported data is often incomplete or misleading. Plaid can tell the app that a transaction was a Venmo payment, a transfer, or a generic merchant charge, but it cannot always know whether that activity was personal spending, business spending, shared spending, reimbursement, or a transfer that should not count against a budget.

Ledger keeps those concepts separate:

- **Raw provider data** answers: what did Plaid send?
- **Enriched transaction data** answers: what should the user trust this transaction to mean?
- **Review items** answer: what still needs human judgment?
- **Splits and recurring records** answer: how should activity affect budget and planning views?

This separation is the core of the product. It lets the app preserve evidence, explain calculations, and avoid treating uncertain imported data as final truth.

## Current Status

- GitHub repo: `jtran273/personal-finance-os`
- Visibility: private
- Default branch: `main`
- Deployment target: Vercel
- Database/Auth: Supabase
- Financial data provider: Plaid
- Optional AI provider: OpenAI

Production hardening currently includes:

- Supabase Auth on protected app routes.
- Supabase RLS policies on finance tables.
- Server-only Plaid token exchange and sync.
- Encrypted Plaid access token storage.
- Production demo mode disabled by default.
- Same-origin checks for mutating route handlers.
- Security headers in `next.config.ts`.
- Ignored local secret files and generated build output.

## Main Workflows

### Sign In

Users sign in with Supabase Auth at `/login`. Protected routes redirect unauthenticated users back to login.

Local demo mode can open a seeded workspace without Supabase or Plaid, but production disables demo mode unless `ENABLE_DEMO_MODE=true` is explicitly set.

### Connect A Bank

In `/settings`, the user starts Plaid Link. The browser receives only a short-lived Plaid public token. The server exchanges that public token for a Plaid access token, encrypts it, stores it in Supabase, and immediately runs an initial sync.

The Plaid access token never goes to the browser.

### Sync Accounts And Transactions

Manual sync imports:

- institutions,
- Plaid items,
- accounts,
- current balances,
- balance snapshots,
- raw transactions,
- enriched transactions,
- review items.

Sync is designed to be idempotent so repeated syncs do not create duplicate transaction records.

Settings derives safe sync status from stored Plaid item fields: item state, last successful sync time, and sanitized Plaid error code. The browser never receives access tokens, transaction cursors, raw provider payloads, or Plaid request ids. When a connection reports a repairable item error, Settings can open Plaid Link update mode for that item and then run a one-item sync.

### Review Transactions

The review queue flags transactions that need judgment, including:

- peer-to-peer payments,
- large charges,
- unclear transfers,
- transfer pairs,
- low-confidence categories,
- missing categories,
- recurring candidates.

Users can accept suggestions one at a time, bulk accept accept-ready AI suggestions after reviewing each preview row, dismiss review items, edit transactions, or resolve peer-to-peer payments with structured splits. Manual-only peer-to-peer rows stay out of bulk acceptance.

### Edit Enriched Records

The transaction edit view lets the user change app-facing fields:

- merchant,
- category,
- intent,
- notes,
- recurring status.

Raw Plaid fields stay preserved for context and auditability.

### Track Recurring Spending

The recurring detector scans imported transactions for repeated merchant, amount, and cadence patterns. Users can confirm or dismiss candidates from `/recurring`.

### Export

The CSV export uses the current transaction filters and returns enriched finance data plus safe raw Plaid context. It does not export Plaid access tokens, service-role keys, auth headers, or provider secrets.

## App Pages

| Route | What it does |
| --- | --- |
| `/login` | Supabase sign-in and optional local demo entry |
| `/dashboard` | Net worth, account totals, spending summary, insights, recurring context, review count |
| `/transactions` | Searchable and filterable enriched transaction table |
| `/transactions/[transactionId]` | Transaction edit page with raw Plaid context |
| `/review` | Queue for transactions that need human review |
| `/recurring` | Recurring expense candidates and confirmed recurring rows |
| `/accounts` | Accounts grouped by cash, credit, investments, and retirement |
| `/settings` | Plaid connection, manual sync, disconnect, and provider status |

## Stack

- Next.js App Router
- React
- TypeScript
- CSS Modules and global CSS
- Supabase Auth
- Supabase Postgres
- Plaid Link and Plaid Transactions
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
OPENAI_API_KEY=
OPENAI_MODEL=
ENABLE_DEMO_MODE=true
```

Generate a production Plaid token encryption key with:

```bash
openssl rand -base64 32
```

Use [DEPLOYMENT.md](DEPLOYMENT.md) for the full environment table and production setup.

## Demo Mode

Demo mode is intended for local development, screenshots, smoke tests, and CI. It is enabled by default outside production and disabled by default when `NODE_ENV=production` or `VERCEL_ENV=production`.

Set it explicitly when a scripted environment needs the seeded workspace:

```bash
ENABLE_DEMO_MODE=true npm run test:e2e
```

Set `ENABLE_DEMO_MODE=false` when testing the real Supabase sign-in path locally. Do not enable demo mode on the production app that contains real financial data.

## Repository Map

```text
src/app/                         Next.js pages, route handlers, server actions, layouts
src/components/finance/          Dashboard, transactions, review, recurring, accounts, settings UI
src/components/plaid/            Plaid Link connection panel
src/components/shell/            Authenticated app navigation shell
src/lib/ai/                      AI provider interface, deterministic fallback, optional OpenAI provider
src/lib/db/                      Typed Supabase query helpers and app-facing finance records
src/lib/demo/                    Local demo mode and seeded in-memory finance client
src/lib/export/                  CSV export helpers
src/lib/finance/                 Balance and spending calculations
src/lib/insights/                Dashboard insight generation
src/lib/plaid/                   Plaid config, client, sync, token vault, and safe error handling
src/lib/recurring/               Recurring detection and recurring mutations
src/lib/review/                  Review reasons, heuristics, and suggestion helpers
src/lib/security/                Request security helpers
src/lib/supabase/                Supabase browser/server clients and auth middleware
supabase/migrations/             Database schema, indexes, grants, RLS policies
supabase/seed.sql                Development seed data only
e2e/                             Playwright smoke tests
.github/workflows/ci.yml         CI checks
```

## Documentation Set

The repo intentionally keeps only the main docs:

- [README.md](README.md): product overview, workflows, local setup, and repo map.
- [ARCHITECTURE.md](ARCHITECTURE.md): how the app is structured, how data flows, and where key code lives.
- [SECURITY.md](SECURITY.md): auth, RLS, secret handling, Plaid token protection, headers, and incident response.
- [DEPLOYMENT.md](DEPLOYMENT.md): Vercel, Supabase, Plaid, OpenAI, and production environment setup.
- [OPERATIONS.md](OPERATIONS.md): day-to-day checks, smoke tests, troubleshooting, maintenance, and rotation runbooks.
- [AGENTS.md](AGENTS.md): contribution guardrails for agent-driven PRs and overnight maintenance work.

Historical planning, handoff, and parallel-agent notes were removed because they were useful during buildout but noisy for normal repo use.

## PR Workflow

Before opening a PR:

1. Keep the diff scoped to the requested behavior.
2. Update docs for setup, environment, security, CI, route, or data-model changes.
3. Run the relevant checks from [OPERATIONS.md](OPERATIONS.md), or call out any skipped checks and why.
4. Fill in the PR template with user impact, security/data-safety notes, verification, and agent handoff details.

CI runs install, lint, typecheck, unit tests, build, Playwright smoke tests in demo mode, production dependency audit, and whitespace checks on PRs to `main`.

## Development Rules

- Keep real secrets in `.env.local`, Vercel, Supabase, Plaid, and OpenAI dashboards only.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, Plaid secrets, Plaid access tokens, database URLs, or auth headers to client components.
- Keep raw Plaid data separate from enriched transaction data.
- Write user-facing edits to enriched records.
- Record material review and transaction changes in `audit_events`.
- Treat unresolved review and peer-to-peer items as uncertain until the user resolves them.
- Update the relevant main doc when routes, environment variables, data model, deployment behavior, or security behavior changes.
