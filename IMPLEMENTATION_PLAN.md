# Implementation Plan

This document tracks what exists, what is production-ready enough for the current MVP, and what should come next.

## Current Baseline

The app is now a working Next.js App Router finance dashboard with:

- Supabase Auth sign-in/sign-out.
- Auth-protected app routes.
- Supabase schema, RLS policies, indexes, and seed data.
- Plaid Link token creation, public token exchange, sync, connection list, and disconnect.
- Account, balance, balance snapshot, raw transaction, and enriched transaction persistence.
- Dashboard, transactions, review, recurring, accounts, and settings views.
- Transaction editing.
- Review queue workflow.
- Peer-to-peer split resolution.
- Recurring candidate detection and confirm/dismiss actions.
- CSV export.
- Deterministic AI suggestion fallback and optional OpenAI provider.
- CI for lint, tests/typecheck, build, and audit.
- Production-oriented deployment and security documentation.

## Stack

- Next.js App Router with TypeScript.
- React client components for interactive finance views.
- Server components for signed-in data loading.
- Server actions for transaction, review, and recurring mutations.
- Route handlers for Plaid, export, demo, and logout.
- Supabase Auth.
- Supabase Postgres.
- Plaid Link and Plaid Transactions.
- Optional OpenAI Responses API provider.
- Vercel deployment.
- GitHub Actions CI.

## Completed Phases

### Phase 0: Foundation

Status: complete.

- Next.js app scaffold.
- Ledger UI direction implemented.
- Global styles and shell navigation.
- Package scripts.
- CI baseline.
- Initial product and implementation docs.

### Phase 1: Data And Auth Foundation

Status: complete.

- Supabase Auth configured.
- Server/browser Supabase helpers.
- Auth middleware.
- Login and logout.
- Finance schema and seed data.
- RLS policies.
- Typed database helpers.

### Phase 2: Plaid Sync

Status: complete for manual MVP sync.

- Plaid config and client.
- Link token route.
- Public token exchange route.
- Plaid item persistence.
- Encrypted access token storage.
- Account and balance sync.
- Transaction sync with raw/enriched separation.
- Manual sync.
- Disconnect/revoke flow.

### Phase 3: Core Finance UI

Status: complete for MVP.

- Dashboard from persisted data.
- Accounts view.
- Transaction table.
- Transaction filters.
- Transaction edit form.
- Category and intent labels.
- Audit events for material edits.

### Phase 4: Review Intelligence

Status: complete for MVP.

- Review reason helpers.
- Deterministic suggestion provider.
- Optional OpenAI provider.
- Review queue UI.
- Accept/dismiss/edit workflows.
- Peer-to-peer split workflow.
- Recurring candidate detection.
- Confirm/dismiss recurring actions.
- Dashboard insight generation.

### Phase 5: Export, Deployment, And Hardening

Status: complete for current production MVP.

- CSV export endpoint.
- Vercel deployment guide.
- Security guide.
- Operations runbook.
- Production demo-mode guard.
- Same-origin checks for mutating route handlers.
- Browser security headers.
- Production Plaid token encryption key support.

## Current Security Gaps To Close

- GitHub repository is currently public and should be made private before relying on production financial data.
- A full dedicated secret scanner such as Gitleaks should be run in CI or manually before broader use.
- Production observability and alerting are not configured.
- Token encryption key rotation needs a planned migration path.
- Background sync is not scheduled.

## Next Recommended Work

### P0

- Make the GitHub repository private.
- Set `PLAID_TOKEN_ENCRYPTION_KEY` in Vercel Production.
- Confirm `ENABLE_DEMO_MODE` is unset or `false` in Vercel Production.
- Run a production smoke test from [DEPLOYMENT.md](DEPLOYMENT.md).

### P1

- Add Gitleaks or an equivalent secret scan to CI.
- Add Playwright smoke tests for login redirect, protected routes, and core navigation.
- Add an audit/events view for security and data changes.
- Add scheduled Plaid sync.
- Add operational logging with request ids and safe provider metadata.

### P2

- Add merchant rule management UI.
- Add category management UI.
- Add reimbursement tracking UI.
- Add more insight evidence links.
- Add token re-encryption migration tooling.
- Add richer export formats.

## Engineering Constraints

- Do not expose service role or provider secrets to client components.
- Keep raw Plaid records separate from user enrichment.
- Keep user ownership explicit in every query helper.
- Keep RLS in place for every finance table.
- Keep review uncertainty visible.
- Keep AI suggestions advisory.
- Keep docs updated when environment, deployment, data model, or security behavior changes.

## Verification Standard

Before shipping:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
git diff --check
```

For production changes, also complete the smoke test in [DEPLOYMENT.md](DEPLOYMENT.md).
