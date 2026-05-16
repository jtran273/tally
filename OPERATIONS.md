# Operations Runbook

This runbook covers day-to-day checks, deployment verification, Plaid sync troubleshooting, and maintenance for Tally.

## Routine Local Checks

Run these before opening a PR or deploying:

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

`npm run test:unit` runs Node tests under `src/**/*.test.ts`. `npm test` runs TypeScript typecheck first, then the unit tests. `npm run test:e2e` starts the Next.js dev server through Playwright and uses the seeded demo workspace. Set `PLAYWRIGHT_BASE_URL` to choose the loopback host or port for the Playwright-managed dev server.

## Start The App Locally

```bash
npm install
npm run dev
```

Default local URL:

```text
http://localhost:3000
```

Local demo mode is available by default unless `ENABLE_DEMO_MODE=false`.

To make demo behavior explicit for automated checks:

```bash
ENABLE_DEMO_MODE=true npm run test:e2e
```

To test the real Supabase login path locally:

```bash
ENABLE_DEMO_MODE=false npm run dev
```

## CI Workflow

GitHub Actions runs on pushes to `main`, PRs targeting `main`, and manual dispatch.

The CI job performs:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test:unit`
5. `npm run build`
6. `npx playwright install --with-deps chromium`
7. `npm run test:e2e`
8. `npm audit --omit=dev`
9. `git diff --check`

CI sets `ENABLE_DEMO_MODE=true` so Playwright can smoke-test the app without Supabase, Plaid, or OpenAI credentials. If a future test needs real provider access, keep it out of the default CI path unless it uses isolated preview credentials and documents the risk.

Security automation also includes:

- CodeQL analysis on pushes, PRs, manual dispatch, and a weekly schedule.
- Dependency review on PRs, failing high-severity dependency additions.
- Dependabot update checks for npm packages and GitHub Actions.

## PR Review Workflow

Before requesting review:

1. Check `git status --short --branch` and confirm the diff contains only intended files.
2. Fill out `.github/pull_request_template.md`.
3. Include user impact, security/data-safety notes, docs updates, and verification commands.
4. Call out skipped checks, missing environment variables, or known follow-ups.
5. For agent-created PRs, include enough handoff context that another agent or reviewer can continue safely.

Reviewers should focus first on secret exposure, user-owned data scoping, RLS/auth behavior, Plaid token handling, route-handler origin checks, and whether unresolved finance data could be treated as trusted budget data.

## Verify Public Repository Protection

```bash
gh repo view jtran273/personal-finance-os --json nameWithOwner,visibility,isPrivate,url
```

Expected visibility:

```text
visibility: PUBLIC
isPrivate: false
```

Verify GitHub security settings:

```bash
gh api repos/jtran273/personal-finance-os --jq '.security_and_analysis'
gh api repos/jtran273/personal-finance-os/branches/main/protection
```

Required before treating `main` as protected: secret scanning, secret scanning push protection, Dependabot alerts/security updates, and branch protection requiring PRs plus passing checks. If a setting cannot be enabled on the current plan, document the gap in the PR or deployment notes.

## Deployment Verification

After a Vercel deployment:

1. Open `/login`.
2. Confirm the demo button visibility matches the intended `ENABLE_DEMO_MODE` setting: production unset or `false` hides it; `true` shows the seeded demo entry.
3. Sign in with Supabase Auth.
4. Confirm `/dashboard` loads.
5. Confirm `/transactions`, `/review`, `/recurring`, `/accounts`, and `/settings` load.
6. Confirm the dashboard Net worth, Liquid, Debt, and Spendable scopes, liabilities-due panel, and category trend/month views render without page overflow.
7. In an iPhone-sized viewport, confirm the dashboard uses the simplified balance summary instead of the desktop balance chart, the top header stays visible, the bottom nav remains reachable, route loading stays compact, and no horizontal page overflow appears.
8. In demo mode, confirm Plaid, Calendar, merchant cleanup, transaction edit, review, and recurring write controls show read-only copy instead of starting provider OAuth or write actions.
9. Confirm `/recurring` shows the next-30-day cashflow calendar using safe merchant/date/amount fields only.
10. Confirm `/accounts` shows account cards first, only renders recent activity for accounts with transactions, and does not duplicate Settings connection health.
11. Confirm Settings shows bank connection controls, last successful sync, repair actions when applicable, and session access.
12. If Calendar is enabled, confirm Settings shows Google Calendar connection state and last successful read.
13. Run a manual Plaid sync only after confirming the environment.
14. Export a CSV from `/transactions` and confirm no secrets are present.
15. Check browser devtools for blocked CSP resources.
16. Check Vercel logs for safe, non-secret errors only.

When validating reimbursement matching, confirm suggestions are read-only and show only safe app-owned transaction ids, amounts, dates, merchants, confidence, and reasons. A suggested Venmo, Zelle, Cash App, or PayPal inflow must not be linked automatically, must not expose raw Plaid payloads or provider ids, and must not mutate `raw_transactions`, `enriched_transactions`, or `reimbursement_records` without explicit user confirmation.

## Plaid Connection Check

Use `/settings` for connection health, sync status, repair actions, and disconnect controls. Confirm the intended Plaid environment in Vercel environment variables and the Plaid dashboard; Settings does not display the environment.

Expected healthy state:

- Plaid credentials and environment match the deployment configuration.
- Connected institution appears once.
- Last successful sync is present after sync.
- Accounts import with balances.
- Transactions import without duplicates.
- Disconnecting a Plaid item preserves Tally finance rows and stops future syncs.
- The revoked Plaid item remains visible as a disconnected/revoked tombstone with a marker token and cleared cursor, and it does not sync again.
- Existing account, balance, transaction, review, recurring, and reimbursement rows for that item remain visible for history.
- Destructive Tally row cleanup is separate: run `npm run plaid:cleanup -- --user-id <user-id> --institution-name "<institution>"` for a dry run, then add `--execute --confirm DELETE_PLAID_ITEM_DATA` only for a revoked item you intend to purge.
- Repairable item errors show safe user copy and a Repair action. Repair opens Plaid Link update mode for the selected item, then syncs only that item.

## Plaid Sync Troubleshooting

### Link token creation fails

Check:

- user is signed in,
- `PLAID_CLIENT_ID` is set,
- correct Plaid secret is set for `PLAID_ENV`,
- `PLAID_TOKEN_ENCRYPTION_KEY` is set in production,
- `PLAID_REDIRECT_URI` is unset for ordinary web Link sessions or is the exact HTTPS URI registered in the Plaid dashboard for OAuth institutions,
- Plaid redirect URI is registered for production OAuth institutions when `PLAID_REDIRECT_URI` is set.

### Public token exchange fails

Check:

- request came from the app origin,
- Plaid public token has not expired,
- server route can reach Plaid,
- `SUPABASE_SERVICE_ROLE_KEY` is set,
- institutions and Plaid items can be written.

### Sync imports accounts but not transactions

Check:

- Plaid item has Transactions product access,
- account type supports transactions,
- transaction window contains posted transactions,
- `transaction_cursor` is not corrupt,
- Vercel logs for safe Plaid error code.

If Plaid returns `PRODUCT_NOT_ENABLED`, `PRODUCT_NOT_READY`, or `INVALID_PRODUCT` from Transactions Sync, Tally should still import accounts, balances, and balance snapshots for that item. Treat a zero-transaction sync as a Transactions product availability issue only after confirming account rows and balance snapshots are updating.

### Sync fails with PLAID_CONFIGURATION_ERROR for every item

Check:

- production Supabase has `plaid_sync_runs` and `plaid_sync_run_items`,
- `PLAID_CLIENT_ID` is set,
- `PLAID_ENV` matches the Plaid app/environment that created the stored access tokens,
- the selected scoped secret is present (`PLAID_PRODUCTION_SECRET` for production or `PLAID_SANDBOX_SECRET` for sandbox),
- existing legacy-encrypted access tokens can still decrypt after Plaid secret changes,
- `PLAID_TOKEN_ENCRYPTION_KEY` is set and unchanged in production before adding new production connections.

Manual and scheduled sync do not need Plaid Link redirect configuration. If sync works and Link token creation fails, inspect `PLAID_REDIRECT_URI` and the registered Plaid redirect URI separately. Production Link tokens do not infer a Plaid redirect from `NEXT_PUBLIC_APP_URL` or `VERCEL_URL`; use an explicit registered HTTPS `PLAID_REDIRECT_URI` only when OAuth redirect support is needed.

### Connection needs repair

Common repairable item errors include `ITEM_LOGIN_REQUIRED`, `INVALID_CREDENTIALS`, `ITEM_LOCKED`, and `USER_PERMISSION_REVOKED`.

Use `/settings`:

1. Confirm the connection shows a safe "Repair required" message.
2. Click Repair and complete Plaid Link update mode.
3. Confirm the app runs a one-item sync after Link succeeds.
4. Confirm the item returns to active status and `last_successful_sync_at` advances.

If repair fails with `INVALID_ACCESS_TOKEN`, `ITEM_NOT_FOUND`, or `PLAID_TOKEN_DECRYPTION_ERROR`, reconnect the institution. Disconnect the stale item to stop future syncs while preserving Tally history; use the cleanup CLI only if you intentionally want to purge historical rows for a revoked item.

## Google Calendar Check

Google Calendar is optional and read-only.

Expected healthy state:

- Google OAuth env vars are set only on deployments that should support Calendar.
- `/settings` can start Google OAuth and return to `/settings?calendar=connected`.
- Calendar connection rows never expose encrypted access or refresh token fields to authenticated browser clients.
- OpenClaw signals include `calendarContext` with `status: "ready"` only when Calendar is connected.
- Agent context includes only event start/end, redacted title, `locationCity`, all-day flag, and suspected category.

If Calendar connection fails:

- Confirm `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` are set.
- Confirm `GOOGLE_CALENDAR_REDIRECT_URI` exactly matches the Google Cloud OAuth redirect URI.
- Confirm production redirect URI uses HTTPS and is not a Vercel preview URL unless that preview URL is deliberately registered.
- Confirm `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` is set and stable.
- Reconnect Calendar from `/settings` if the OAuth refresh token was revoked.

### Scheduled sync wiring

Scheduled sync uses a dedicated server-only route:

```text
GET or POST /api/plaid/sync/scheduled
```

Recommended production wiring is a Vercel Cron or another trusted scheduler that sends:

```text
Authorization: Bearer <CRON_SECRET>
```

This route does not use browser same-origin auth. Keep scheduled jobs server-only: never expose Plaid access tokens, service-role keys, transaction cursors, auth headers, provider ids, or raw provider payloads to the browser or job logs.

For scheduled-sync maintenance:

1. Confirm `CRON_SECRET` is set in the server environment before enabling the scheduler.
2. Confirm the route returns a summary with safe item counts and sanitized error metadata.
3. Confirm the route response and server logs show only safe scheduled-run status, counts, and sanitized error metadata.
4. Log only safe Plaid metadata from `getSafePlaidError`.
5. Add alerting on failed item count, not provider-sensitive identifiers.

### Duplicate transactions appear

Check:

- `raw_transactions` uniqueness on `user_id` and `plaid_transaction_id`,
- Plaid cursor handling,
- pending-to-posted replacement behavior,
- any manual seed data overlapping with real Plaid ids.

## Scheduled Plaid Sync

Scheduled job routes are:

```text
/api/plaid/sync/scheduled
/api/agents/proactive-scan/scheduled
/api/openclaw/briefing/scheduled
```

Configure `CRON_SECRET` as a server-only environment variable before enabling a scheduler. Scheduled job routes accept `GET` or `POST` only when the request includes:

```text
Authorization: Bearer <CRON_SECRET>
```

The Plaid scheduled route uses the Supabase service-role client, finds users with non-revoked Plaid items, and writes the same persisted sync run summaries as manual sync. The proactive scan route uses `PROACTIVE_SCAN_USER_ID` or `OPENCLAW_USER_ID`, looks back 45 days for candidate expenses, caps candidate transactions with `PROACTIVE_SCAN_MAX_TX`, uses OpenAI only when `ENABLE_OPENAI_AUTO_REVIEW=true`, and writes only advisory reimbursement proposals. The OpenClaw briefing route uses `OPENCLAW_USER_ID` and writes only a proposal payload for OpenClaw to inspect. Logs and JSON responses must stay limited to safe status, app-owned ids, counts, and sanitized metadata.

## Supabase Troubleshooting

### App says Supabase is not configured

Check:

- `NEXT_PUBLIC_SUPABASE_URL`,
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
- Vercel environment scope,
- production URL uses HTTPS.

### Signed-in user sees no data

Check:

- RLS policies are applied,
- rows use the signed-in user's `auth.uid()`,
- seed data fixed user id is not being mistaken for the real user,
- server code passes `context.user.id` to query helpers.

### Service route writes fail

Check:

- `SUPABASE_SERVICE_ROLE_KEY` exists in the server environment,
- key was not exposed to browser code,
- service role client still writes user-owned rows with the signed-in `userId`.

## CSV Export Checks

Export route:

```text
/api/export/transactions
```

Expected:

- requires a signed-in user or demo mode,
- rejects cross-site browser reads,
- returns `Cache-Control: no-store`,
- includes enriched labels, review/filter context, reimbursement summaries, and safe raw Plaid context,
- excludes Plaid access tokens, provider transaction ids, service role keys, auth headers, and provider secrets.

## AI Provider Checks

The app works without `OPENAI_API_KEY` by using deterministic suggestions.

If `OPENAI_API_KEY` is set:

- OpenAI review actions should use the configured provider,
- automatic OpenAI cleanup and proactive OpenAI scans should stay off unless `ENABLE_OPENAI_AUTO_REVIEW=true`,
- the review queue should let the user generate individual suggestions manually,
- suggestions should remain advisory,
- no AI provider should perform autonomous writes,
- accepted suggestions and merchant rules should still require explicit user actions,
- persisted `agent_proposals` rows should contain only safe evidence/proposed-patch JSON and should be accepted only through Tally-owned helpers that write audit events,
- raw provider secrets must stay server-only.

## OpenClaw Integration Checks

Tally exposes server-to-server OpenClaw routes only when all of these server environment variables are set:

- `OPENCLAW_TOKEN`,
- `OPENCLAW_USER_ID`,
- `SUPABASE_SERVICE_ROLE_KEY`.

Routes:

```text
GET /api/openclaw/signals?since=<iso>
POST /api/openclaw/replies
GET|POST /api/openclaw/briefing/scheduled
```

Expected:

- requests must include `Authorization: Bearer <OPENCLAW_TOKEN>`,
- scheduled briefing requests must include `Authorization: Bearer <CRON_SECRET>`,
- responses return `Cache-Control: no-store`,
- `/api/openclaw/signals` returns pending proposal summaries, open clarification questions, weekly planning context, and a minimized `calendarContext` when Google Calendar is connected,
- `/api/openclaw/replies` accepts `{ "proposal_id": "...", "raw_text": "..." }` and records clarification answers for any pending Tally proposal carrying a question,
- `/api/openclaw/briefing/scheduled` idempotently creates or updates one `openclaw_briefing` proposal for the configured cadence, defaulting to weekly,
- stale reply attempts for proposals that are no longer pending return `409` rather than retryable server errors,
- OpenClaw never writes finance rows directly and Tally never sends iMessages,
- signal payloads must pass the assistant forbidden-field guard before serialization.

To rotate `OPENCLAW_TOKEN`, update the token in Vercel/server env and in OpenClaw, redeploy Tally, then confirm an old token receives 401 and the new token can call `/api/openclaw/signals`.

## Database Maintenance

Schema changes live in `supabase/migrations`.

When adding a table:

- include `user_id`,
- enable RLS,
- add select/insert/update/delete policies as appropriate,
- add indexes for common `user_id` queries,
- update `src/lib/db/types.ts`,
- add query helpers in `src/lib/db/queries.ts`,
- add tests for filtering or conversion logic when behavior is non-trivial.

## Secret Rotation

### Supabase anon key

1. Rotate in Supabase.
2. Update Vercel and `.env.local`.
3. Redeploy.
4. Confirm login and data reads.

### Supabase service role key

1. Rotate in Supabase.
2. Update Vercel server environment only.
3. Redeploy.
4. Test Plaid exchange, sync, and disconnect.

### OpenClaw token

1. Generate a new high-entropy token.
2. Update `OPENCLAW_TOKEN` in Vercel/server environment.
3. Update OpenClaw to send `Authorization: Bearer <new-token>`.
4. Redeploy Tally.
5. Confirm `/api/openclaw/signals` rejects the old token and accepts the new token.

### Plaid secret

1. Rotate in Plaid.
2. Update `PLAID_SANDBOX_SECRET`, `PLAID_PRODUCTION_SECRET`, or `PLAID_SECRET`.
3. Redeploy.
4. Test Link token creation and sync.

### Plaid token encryption key

Plan carefully. Existing encrypted Plaid access tokens depend on this key.

Safe options:

- reconnect Plaid items after rotation,
- add a migration path that decrypts with the old key and re-encrypts with the new key,
- rotate during a maintenance window.

Do not rotate this key casually in production.

## Release Notes Template

Use this shape for a production release note:

```markdown
## Summary

- What changed.

## User Impact

- What users can do now.
- Any migration or setup needed.

## Verification

- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --omit=dev`

## Security

- Secret or permission changes.
- New external services.
- RLS or auth changes.
```
