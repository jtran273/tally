# Handoff

This file summarizes the current repository state for the next engineer or agent.

## Repository

- Local branch: `main`
- Remote: `origin`
- Remote URL: `https://github.com/jtran273/personal-finance-os.git`
- GitHub visibility check: `PUBLIC`, `isPrivate: false`

Make the repository private before depending on it for production financial data.

## Current Product State

Ledger is a working production-MVP personal finance dashboard with:

- Supabase Auth.
- Protected app shell.
- Supabase finance schema and RLS.
- Plaid Link connection flow.
- Plaid public token exchange.
- Manual Plaid sync.
- Plaid disconnect/revoke.
- Encrypted Plaid access token storage.
- Dashboard, transactions, review, recurring, accounts, and settings views.
- Transaction editing.
- Review queue.
- Peer-to-peer split resolution.
- Recurring candidate detection.
- CSV export.
- Deterministic AI suggestions and optional OpenAI provider.
- CI and documentation.

## Important Security State

- `.env.local` exists locally and should not be printed or committed.
- Current local secret files are ignored by git.
- A current-file and git-history regex scan did not find obvious committed secrets.
- Production demo mode is disabled by default.
- Mutating route handlers have same-origin checks.
- Browser security headers are configured.
- Production Plaid token encryption requires `PLAID_TOKEN_ENCRYPTION_KEY`.

## Known Gaps

- GitHub repo is public until changed in GitHub.
- No scheduled Plaid background sync.
- No production alerting or monitoring setup.
- No Gitleaks or equivalent secret scanning in CI yet.
- No browser E2E suite yet.
- Token encryption key rotation requires manual planning.
- Supabase CLI is not confirmed installed locally.
- Live production Plaid behavior still needs a careful one-institution smoke test.

## Verification Commands

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
git diff --check
```

## Environment Notes

Use `.env.local` for local development only.

Do not print:

- Supabase keys,
- Plaid secrets,
- Plaid access tokens,
- OpenAI keys,
- database URLs,
- auth headers.

Production should set:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PLAID_CLIENT_ID`
- `PLAID_PRODUCTION_SECRET` or `PLAID_SECRET`
- `PLAID_TOKEN_ENCRYPTION_KEY`
- `PLAID_ENV`
- `PLAID_REDIRECT_URI`

## Suggested Next Batch

1. Make GitHub repo private.
2. Add secret scanning to CI.
3. Add Playwright smoke tests.
4. Add scheduled Plaid sync.
5. Add audit event reporting UI.
6. Add category and merchant rule management.

## Files To Review Before Large Changes

- [README.md](README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [SECURITY.md](SECURITY.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [OPERATIONS.md](OPERATIONS.md)
- [src/lib/db/queries.ts](src/lib/db/queries.ts)
- [src/lib/plaid/service.ts](src/lib/plaid/service.ts)
- [supabase/migrations/20260506000100_finance_schema.sql](supabase/migrations/20260506000100_finance_schema.sql)
