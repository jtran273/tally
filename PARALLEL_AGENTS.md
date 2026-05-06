# Parallel Agent Runbook

## Current State

The Ledger frontend baseline, CI checklist, and Supabase Auth foundation are committed to `main`. GitHub issues are created in `jtran273/personal-finance-os`; use the issue numbers in this runbook as the source of task ownership.

## GitHub Issue Creation Status

Issues are created through the authenticated GitHub CLI. Use labels to track dependency state, and keep issue comments updated when agents start, hand off, or complete work.

## Best Immediate Sequence

1. Land the database schema and seed data issue.
2. Start the second parallel batch from the updated `main`.
3. Keep secrets in `.env.local`, Vercel env vars, and Supabase/Plaid dashboards. Do not commit real keys.

## First Parallel Batch

These can run together after the baseline is merged.

### Agent A: Supabase Auth and Environment

Issue: `03 - Configure Supabase Auth and environment`

Ownership:

- `src/lib/supabase/*`
- `src/app/login/*`
- `src/middleware.ts`
- auth-related README/env docs only

Prompt:

```text
Implement Supabase Auth for this Next.js App Router project. Add browser/server Supabase helpers, a login page, logout flow, protected route middleware, and environment documentation. Do not change database schema files. Preserve the existing Ledger UI and redirect unauthenticated users to /login. Run lint, typecheck, and build.
```

Done criteria:

- User can sign in and sign out.
- Protected app routes redirect unauthenticated users.
- Environment requirements are documented, and local values live only in `.env.local`.
- No secrets are committed.

### Agent B: Database Schema and Seed Data

Issue: `04 - Add database schema and seed data`

Ownership:

- `supabase/migrations/*`
- `supabase/seed.sql`
- `src/lib/db/*`
- typed finance data-access helpers

Prompt:

```text
Create the Supabase Postgres schema for the Personal Finance Copilot MVP. Include institutions, plaid_items, accounts, balance_snapshots, raw_transactions, enriched_transactions, categories, review_items, transaction_splits, recurring_expenses, insights, reimbursement_records, merchant_rules, and audit_events. Add seed data equivalent to the current Ledger mock data. Add typed query helpers. Do not implement auth UI or Plaid routes. Run lint, typecheck, and build.
```

Done criteria:

- Raw/enriched transaction separation exists.
- `user_id` ownership is represented on user-owned tables.
- Seed data supports dashboard, transactions, review queue, recurring, and accounts.
- Foreign keys are present.

### Agent C: CI, Tests, and Baseline Checks

Issue: `17 - Add tests, CI, and reviewer checklist`

Ownership:

- `.github/workflows/*`
- `.github/pull_request_template.md`
- test setup files
- focused unit/smoke tests

Prompt:

```text
Add CI and baseline tests for the current Next.js Ledger app. CI should install dependencies, run lint, typecheck, tests, build, and audit. Add a PR checklist mapping changes back to issue acceptance criteria. Add focused tests where practical without touching Supabase schema or auth implementation. Run the full checks locally.
```

Done criteria:

- CI covers install, lint, typecheck, tests, build, and audit.
- PR template includes reviewer checklist.
- Existing app still builds.

## Second Parallel Batch

Run after Agent B lands schema and seed data.

### Agent D: Dashboard from Persisted Data

Issue: `08 - Build accounts and net worth dashboard from persisted data`

Ownership:

- dashboard/account data loaders
- finance calculation utilities
- account/net worth UI wiring

Depends on:

- Issue 04

Avoid:

- Do not change Plaid ingestion.
- Do not own transaction edit mutations.

### Agent E: Transactions Table from Persisted Data

Issue: `09 - Build transaction table and filters from persisted data`

Ownership:

- transaction list data loading
- filter query state
- table/list display wiring

Depends on:

- Issue 04

Avoid:

- Do not implement transaction edit drawer persistence unless issue 10 is assigned.

### Agent F: AI Suggestion Adapter

Issue: `11 - Add AI suggestion adapter and mock suggestions`

Ownership:

- `src/lib/ai/*`
- deterministic suggestion service
- suggestion tests

Depends on:

- Issue 04 data types

Avoid:

- Do not call OpenAI yet unless explicitly assigned.

### Agent G: Recurring Detection

Issue: `14 - Build recurring expense detection`

Ownership:

- recurring domain logic
- recurring candidates/actions
- focused tests

Depends on:

- Issue 04

Avoid:

- Do not wire recurring into Plaid ingestion until sync ownership is clear.

## Serial or Single-Owner Work

Keep these with one agent at a time:

- Issue 06 and 07: Plaid Link and Plaid sync.
- Issue 10 and 12: Transaction editing and review queue mutation APIs.
- Issue 13: Peer-to-peer split persistence and spending calculations.
- Issue 16: CSV export after transaction enrichment persistence is stable.
- Issue 18: Deployment notes late in the process.

## Keys You Are Gathering

Put local values in `.env.local` and Vercel values in the Vercel project settings:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV=sandbox`
- `OPENAI_API_KEY`

The app can continue without keys until auth/Plaid/AI issues start.
