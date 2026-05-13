# Operations Runbook

This runbook covers day-to-day checks, deployment verification, Plaid sync troubleshooting, and maintenance for Ledger.

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

## PR Review Workflow

Before requesting review:

1. Check `git status --short --branch` and confirm the diff contains only intended files.
2. Fill out `.github/pull_request_template.md`.
3. Include user impact, security/data-safety notes, docs updates, and verification commands.
4. Call out skipped checks, missing environment variables, or known follow-ups.
5. For agent-created PRs, include enough handoff context that another agent or reviewer can continue safely.

Reviewers should focus first on secret exposure, user-owned data scoping, RLS/auth behavior, Plaid token handling, route-handler origin checks, and whether unresolved finance data could be treated as trusted budget data.

## Verify Repository Privacy

```bash
gh repo view jtran273/personal-finance-os --json nameWithOwner,visibility,isPrivate,url
```

Expected production security posture:

```text
visibility: PRIVATE
isPrivate: true
```

If it is public, make it private before storing real production data:

```bash
gh repo edit jtran273/personal-finance-os --visibility private
```

## Deployment Verification

After a Vercel deployment:

1. Open `/login`.
2. Confirm the demo button visibility matches the intended `ENABLE_DEMO_MODE` setting: `false` hides it; `true` or unset shows the seeded demo entry. Production should choose this explicitly.
3. Sign in with Supabase Auth.
4. Confirm `/dashboard` loads.
5. Confirm `/transactions`, `/review`, `/recurring`, `/accounts`, and `/settings` load.
6. Confirm the dashboard balance scopes, liabilities-due panel, and category trend/month views render without page overflow.
7. Confirm `/recurring` shows the next-30-day cashflow calendar using safe merchant/date/amount fields only.
8. Confirm Settings shows bank connection controls, last successful sync, repair actions when applicable, and session access.
9. Run a manual Plaid sync only after confirming the environment.
10. Export a CSV from `/transactions` and confirm no secrets are present.
11. Check browser devtools for blocked CSP resources.
12. Check Vercel logs for safe, non-secret errors only.

When validating reimbursement matching, confirm suggestions are read-only and show only safe app-owned transaction ids, amounts, dates, merchants, confidence, and reasons. A suggested Venmo, Zelle, Cash App, or PayPal inflow must not be linked automatically, must not expose raw Plaid payloads or provider ids, and must not mutate `raw_transactions`, `enriched_transactions`, or `reimbursement_records` without explicit user confirmation.

## Plaid Connection Check

Use `/settings` for connection health, sync status, repair actions, and disconnect controls. Confirm the intended Plaid environment in Vercel environment variables and the Plaid dashboard; Settings does not display the environment.

Expected healthy state:

- Plaid credentials and environment match the deployment configuration.
- Connected institution appears once.
- Last successful sync is present after sync.
- Accounts import with balances.
- Transactions import without duplicates.
- Revoked items remain visible as revoked and do not sync again.
- Repairable item errors show safe user copy and a Repair action. Repair opens Plaid Link update mode for the selected item, then syncs only that item.

## Plaid Sync Troubleshooting

### Link token creation fails

Check:

- user is signed in,
- `PLAID_CLIENT_ID` is set,
- correct Plaid secret is set for `PLAID_ENV`,
- `PLAID_TOKEN_ENCRYPTION_KEY` is set in production,
- `PLAID_REDIRECT_URI` or `NEXT_PUBLIC_APP_URL` is valid when using an OAuth redirect,
- Plaid redirect URI is registered for production OAuth institutions.

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

If Plaid returns `PRODUCT_NOT_ENABLED`, `PRODUCT_NOT_READY`, or `INVALID_PRODUCT` from Transactions Sync, Ledger should still import accounts, balances, and balance snapshots for that item. Treat a zero-transaction sync as a Transactions product availability issue only after confirming account rows and balance snapshots are updating.

### Sync fails with PLAID_CONFIGURATION_ERROR for every item

Check:

- production Supabase has `plaid_sync_runs` and `plaid_sync_run_items`,
- `PLAID_CLIENT_ID` is set,
- `PLAID_ENV` matches the Plaid app/environment that created the stored access tokens,
- the selected scoped secret is present (`PLAID_PRODUCTION_SECRET` for production or `PLAID_SANDBOX_SECRET` for sandbox),
- existing legacy-encrypted access tokens can still decrypt after Plaid secret changes,
- `PLAID_TOKEN_ENCRYPTION_KEY` is set and unchanged in production before adding new production connections.

Manual and scheduled sync do not need Plaid Link redirect configuration. If sync works and Link token creation fails, inspect `PLAID_REDIRECT_URI`, `NEXT_PUBLIC_APP_URL`, and the registered Plaid redirect URI separately. Production Link tokens must not send an `http://localhost` redirect; use a registered HTTPS URL or omit the redirect for local desktop testing.

### Connection needs repair

Common repairable item errors include `ITEM_LOGIN_REQUIRED`, `INVALID_CREDENTIALS`, `ITEM_LOCKED`, and `USER_PERMISSION_REVOKED`.

Use `/settings`:

1. Confirm the connection shows a safe "Repair required" message.
2. Click Repair and complete Plaid Link update mode.
3. Confirm the app runs a one-item sync after Link succeeds.
4. Confirm the item returns to active status and `last_successful_sync_at` advances.

If repair fails with `INVALID_ACCESS_TOKEN` or `ITEM_NOT_FOUND`, reconnect the institution. Historical transactions should remain preserved in Ledger, but future imports require a new active Plaid item.

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

The scheduled sync route is:

```text
/api/plaid/sync/scheduled
```

Configure `CRON_SECRET` as a server-only environment variable before enabling a scheduler. The route accepts `GET` or `POST` only when the request includes:

```text
Authorization: Bearer <CRON_SECRET>
```

The route uses the Supabase service-role client, finds users with non-revoked Plaid items, and writes the same persisted sync run summaries as manual sync. Logs and JSON responses must stay limited to safe status, app-owned ids, counts, and sanitized Plaid error metadata.

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
- returns `Cache-Control: no-store`,
- includes enriched labels, review/filter context, reimbursement summaries, and safe raw Plaid context,
- excludes Plaid access tokens, service role keys, auth headers, and provider secrets.

## AI Provider Checks

The app works without `OPENAI_API_KEY` by using deterministic suggestions.

If `OPENAI_API_KEY` is set:

- OpenAI review actions should use the configured provider,
- automatic OpenAI cleanup should stay off unless `ENABLE_OPENAI_AUTO_REVIEW=true`,
- the review queue should let the user generate individual suggestions manually,
- suggestions should remain advisory,
- no AI provider should perform autonomous writes,
- accepted suggestions and merchant rules should still require explicit user actions,
- persisted `agent_proposals` rows should contain only safe evidence/proposed-patch JSON and should be accepted only through Ledger-owned helpers that write audit events,
- raw provider secrets must stay server-only.

## OpenClaw Integration Checks

Ledger exposes server-to-server OpenClaw routes only when all of these server environment variables are set:

- `OPENCLAW_TOKEN`,
- `OPENCLAW_USER_ID`,
- `SUPABASE_SERVICE_ROLE_KEY`.

Routes:

```text
GET /api/openclaw/signals?since=<iso>
POST /api/openclaw/replies
```

Expected:

- requests must include `Authorization: Bearer <OPENCLAW_TOKEN>`,
- responses return `Cache-Control: no-store`,
- `/api/openclaw/signals` returns pending proposal summaries, open clarification questions, weekly planning context, and a placeholder calendar context until the calendar connector lands,
- `/api/openclaw/replies` accepts `{ "proposal_id": "...", "raw_text": "..." }` and records clarification answers for any pending Ledger proposal carrying a question,
- stale reply attempts for proposals that are no longer pending return `409` rather than retryable server errors,
- OpenClaw never writes finance rows directly and Ledger never sends iMessages,
- signal payloads must pass the assistant forbidden-field guard before serialization.

To rotate `OPENCLAW_TOKEN`, update the token in Vercel/server env and in OpenClaw, redeploy Ledger, then confirm an old token receives 401 and the new token can call `/api/openclaw/signals`.

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
4. Redeploy Ledger.
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
