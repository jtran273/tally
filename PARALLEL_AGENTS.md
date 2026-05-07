# Parallel Agent Coordination

Use this document when splitting future work across multiple agents or engineers. The goal is to avoid overlapping writes across tightly coupled finance, Plaid, auth, and documentation surfaces.

## Current Coordination Rule

Do not start parallel implementation unless each worker has an explicit ownership area and a disjoint write set.

The highest-risk shared files are:

- `src/lib/db/queries.ts`
- `src/lib/db/types.ts`
- `src/lib/plaid/service.ts`
- `src/lib/plaid/token-vault.ts`
- `src/lib/supabase/*`
- `src/lib/security/*`
- `supabase/migrations/*`
- `src/components/finance/review/*`
- `src/components/finance/transactions/*`
- `src/components/finance/dashboard/*`
- root documentation files

## Safe Work Splits

### Secret Scanning CI

Owner writes:

- `.github/workflows/*`
- optional scripts under `scripts/`
- `SECURITY.md`
- `OPERATIONS.md`

Avoid:

- app runtime code,
- Supabase schema,
- Plaid service logic.

### Playwright Smoke Tests

Owner writes:

- test config,
- browser smoke tests,
- package scripts if needed,
- CI updates for the new test command.

Avoid:

- changing app behavior unless a test exposes a real bug.

### Scheduled Plaid Sync

Owner writes:

- new route/job code for scheduled sync,
- `src/lib/plaid/*` only where needed,
- deployment docs for scheduler setup.

Avoid:

- transaction table UI,
- review UI,
- unrelated query helper refactors.

### Audit Reporting UI

Owner writes:

- audit query helpers,
- audit view components,
- route under `src/app/(app)`,
- shell navigation if adding a new route.

Avoid:

- Plaid sync internals,
- transaction mutation behavior.

### Category And Merchant Rules UI

Owner writes:

- category/rule query helpers,
- settings or dedicated category/rule components,
- server actions for those forms.

Avoid:

- raw transaction persistence,
- Plaid token storage,
- auth middleware.

## Handoff Format

Each worker should report:

- files changed,
- behavior changed,
- verification commands run,
- remaining risks,
- any environment variables added,
- any migrations added.

## Merge Checklist

Before combining parallel work:

- Re-read `git diff --name-only` for overlap.
- Run `npm run lint`.
- Run `npm test`.
- Run `npm run build`.
- Run `npm audit --omit=dev`.
- Confirm docs mention any new environment variable, route, table, or security behavior.
- Confirm no worker printed or committed secrets.

## Documentation Ownership

Do not have multiple workers rewrite root docs at the same time. Docs should be updated after code integration so they describe the final combined behavior.
