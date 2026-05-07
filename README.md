# Personal Finance OS

Personal Finance OS is a private personal finance dashboard for importing bank data, reviewing transactions, tracking recurring spending, and turning raw account activity into trusted budget data.

The app is branded in the UI as **Ledger**. It is built for a single signed-in user today, with every finance table keyed by `user_id` so the data model can support more users later.

## Production Status

This repo is connected to `https://github.com/jtran273/personal-finance-os.git`. The GitHub visibility check on this checkout returned `PUBLIC`, not private. Treat the codebase as public until the repository visibility is changed in GitHub.

The app has production-oriented safeguards in place:

- Supabase Auth protects all app routes outside `/login`.
- Supabase Row Level Security limits finance rows by `auth.uid() = user_id`.
- Plaid access tokens are encrypted before storage and are never sent to the browser.
- Production demo mode is disabled unless `ENABLE_DEMO_MODE=true` is explicitly set.
- Mutating route handlers reject invalid cross-origin requests.
- Security headers are configured in `next.config.ts`.
- `.env.local`, `.vercel`, `.next`, and dependency/build output are ignored by git.

## What The Product Does

Ledger helps turn raw financial activity into trusted, reviewable records:

- Connects banks and cards through Plaid.
- Imports institutions, Plaid items, accounts, balances, balance snapshots, and transactions.
- Preserves raw Plaid transaction records separately from editable enriched transactions.
- Lets the user edit merchant, category, intent, notes, recurring status, and review state.
- Flags ambiguous transactions for review.
- Supports peer-to-peer split resolution for Venmo, Zelle, Cash App, and similar payments.
- Detects recurring expense candidates and lets the user confirm or dismiss them.
- Builds dashboard totals, spending views, account groups, review nudges, and insight cards.
- Exports enriched transaction data to CSV without secrets.

## Current App Views

- `/login`: Supabase email/password sign-in, sign-out state, and local demo entry when enabled.
- `/dashboard`: net worth, account totals, spending summary, recent transactions, review count, insights, and recurring context.
- `/transactions`: searchable and filterable enriched transaction table.
- `/transactions/[transactionId]`: transaction edit form with raw Plaid context.
- `/review`: review queue for low-confidence, missing-category, large, transfer-like, recurring, and peer-to-peer transactions.
- `/recurring`: recurring expense candidates and confirmed recurring rows.
- `/accounts`: accounts grouped by cash, credit, investments, and retirement.
- `/settings`: Plaid connection controls, sync/disconnect actions, AI provider status, and operational summary.

## Stack

- Next.js App Router
- React and TypeScript
- CSS Modules plus global app styles
- Supabase Auth and Supabase Postgres
- Plaid Link and Plaid Transactions
- OpenAI Responses API as an optional suggestion provider
- Vercel deployment target
- Node test runner with `tsx`
- GitHub Actions CI

## Local Development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Run verification:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

## Environment

Local secrets belong in `.env.local`. Do not commit real values.

Core variables:

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

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full environment table and production setup.

Generate a production Plaid token encryption key with:

```bash
openssl rand -base64 32
```

## Repository Map

```text
src/app/                         Next.js routes, pages, route handlers, server actions
src/components/finance/          Ledger finance views and forms
src/components/plaid/            Plaid Link connection UI
src/components/shell/            Authenticated app shell and navigation
src/lib/db/                      Typed Supabase query helpers and app-facing records
src/lib/demo/                    Local demo data and demo session guard
src/lib/finance/                 Balance and spending calculations
src/lib/insights/                Dashboard insight generation
src/lib/plaid/                   Plaid client, config, sync, token encryption, and errors
src/lib/recurring/               Recurring expense detection and mutations
src/lib/review/                  Review reason and suggestion helpers
src/lib/security/                Request security helpers
src/lib/supabase/                Supabase browser/server clients and middleware
supabase/migrations/             Database schema, RLS, policies, indexes
supabase/seed.sql                Demo/dev seed data only
.github/workflows/ci.yml         Lint, test, build, and audit CI
```

## Documentation

- [PRD.md](PRD.md): product goals, workflows, and acceptance criteria.
- [ARCHITECTURE.md](ARCHITECTURE.md): runtime architecture, data flow, modules, and route map.
- [SECURITY.md](SECURITY.md): production security model, repo privacy, secrets, RLS, CSRF, headers, and incident response.
- [DEPLOYMENT.md](DEPLOYMENT.md): Vercel, Supabase, Plaid, and environment setup.
- [OPERATIONS.md](OPERATIONS.md): runbook for local checks, deployment verification, sync troubleshooting, and maintenance.
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): completed work and roadmap.
- [HANDOFF.md](HANDOFF.md): current project state and known gaps.
- [PARALLEL_AGENTS.md](PARALLEL_AGENTS.md): coordination notes for splitting future implementation work.

## Development Rules

- Keep real secrets in `.env.local`, Vercel environment variables, Supabase, Plaid, and OpenAI dashboards only.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, Plaid secrets, Plaid access tokens, or raw auth headers to client components.
- Keep raw Plaid records immutable from the UI perspective.
- Write user edits to enriched records and record material changes in `audit_events`.
- Keep unresolved peer-to-peer and review data distinct from trusted spending totals.
- Run the verification commands before shipping changes.
