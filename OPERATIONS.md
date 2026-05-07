# Operations Runbook

This runbook covers day-to-day checks, deployment verification, Plaid sync troubleshooting, and maintenance for Ledger.

## Routine Local Checks

Run these before opening a PR or deploying:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
git diff --check
```

`npm test` runs TypeScript typecheck first, then Node tests under `src/**/*.test.ts`.

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
2. Confirm the demo button is not visible in production.
3. Sign in with Supabase Auth.
4. Confirm `/dashboard` loads.
5. Confirm `/transactions`, `/review`, `/recurring`, `/accounts`, and `/settings` load.
6. Confirm Settings shows the intended Plaid environment.
7. Run a manual Plaid sync only after confirming the environment.
8. Export a CSV from `/transactions` and confirm no secrets are present.
9. Check browser devtools for blocked CSP resources.
10. Check Vercel logs for safe, non-secret errors only.

## Plaid Connection Check

Use `/settings`.

Expected healthy state:

- Plaid environment label matches the deployment.
- Connected institution appears once.
- Last successful sync is present after sync.
- Accounts import with balances.
- Transactions import without duplicates.
- Revoked items remain visible as revoked and do not sync again.

## Plaid Sync Troubleshooting

### Link token creation fails

Check:

- user is signed in,
- `PLAID_CLIENT_ID` is set,
- correct Plaid secret is set for `PLAID_ENV`,
- `PLAID_TOKEN_ENCRYPTION_KEY` is set in production,
- `PLAID_REDIRECT_URI` or `NEXT_PUBLIC_APP_URL` is valid,
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

### Duplicate transactions appear

Check:

- `raw_transactions` uniqueness on `user_id` and `plaid_transaction_id`,
- Plaid cursor handling,
- pending-to-posted replacement behavior,
- any manual seed data overlapping with real Plaid ids.

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
- includes enriched labels and raw Plaid context,
- excludes Plaid access tokens, service role keys, auth headers, and provider secrets.

## AI Provider Checks

The app works without `OPENAI_API_KEY` by using deterministic suggestions.

If `OPENAI_API_KEY` is set:

- provider status in Settings should show OpenAI is configured,
- suggestions should remain advisory,
- no AI provider should perform autonomous writes,
- raw provider secrets must stay server-only.

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
