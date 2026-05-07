# Deployment

Ledger is designed to run on Vercel with Supabase Auth/Postgres, Plaid, and an optional OpenAI provider. Production setup must keep code, secrets, database access, and Plaid environment choices aligned.

## Deployment Targets

- **Local development**: `npm run dev`, Plaid Sandbox, `.env.local`, local demo mode allowed.
- **Vercel Preview**: branch deployments for testing Supabase and Plaid Sandbox or limited real-data checks.
- **Vercel Production**: canonical HTTPS app URL, Supabase Auth, Plaid intended environment, demo mode disabled.

## Required Services

- GitHub repository connected to Vercel.
- Vercel project using the Next.js preset.
- Supabase project with Auth enabled.
- Supabase database with migrations applied.
- Plaid app with Sandbox credentials for local work.
- Plaid Production or Limited Production credentials only when ready for real institutions.
- Optional OpenAI API key for server-side suggestions.

## Production Repository Requirement

The current GitHub visibility check returned `PUBLIC`. Make the repository private before relying on it for production financial data:

```bash
gh repo edit jtran273/personal-finance-os --visibility private
gh repo view jtran273/personal-finance-os --json nameWithOwner,visibility,isPrivate,url
```

Expected:

```json
{"isPrivate":true,"visibility":"PRIVATE"}
```

## Environment Variables

Set local values in `.env.local`. Set Vercel values in Project Settings -> Environment Variables. Use separate values for Preview and Production when needed.

| Name | Scope | Required | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Browser/server | Production yes | Canonical app URL. Must be HTTPS in production. Used to derive Plaid redirect URI when `PLAID_REDIRECT_URI` is unset. |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser/server | Yes | Supabase project URL. Must be HTTPS in production. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server | Yes | Supabase anon key. Safe to expose only because RLS is required. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Plaid writes yes | Used by Plaid route handlers for controlled server writes. Never expose to client code. |
| `SUPABASE_DB_URL` | Server/tooling | Migrations only | Direct Postgres URL for migrations and maintenance. Do not expose to browser code. |
| `PLAID_CLIENT_ID` | Server only | Plaid yes | Plaid client id for selected Plaid app. |
| `PLAID_SECRET` | Server only | Optional fallback | Generic Plaid secret fallback. Prefer scoped secrets below. |
| `PLAID_SANDBOX_SECRET` | Server only | Sandbox yes | Used before `PLAID_SECRET` when `PLAID_ENV=sandbox`. |
| `PLAID_PRODUCTION_SECRET` | Server only | Production yes | Used before `PLAID_SECRET` when `PLAID_ENV=production`. |
| `PLAID_TOKEN_ENCRYPTION_KEY` | Server only | Production yes | Dedicated AES-GCM key material for stored Plaid access tokens. Keep stable. |
| `PLAID_ENV` | Server only | Yes | `sandbox` or `production`. Use `sandbox` locally. |
| `PLAID_REDIRECT_URI` | Server only | Production OAuth yes | Exact HTTPS redirect URI registered in Plaid. Usually `https://your-app/settings`. |
| `OPENAI_API_KEY` | Server only | Optional | Enables server-side OpenAI suggestion provider. |
| `OPENAI_MODEL` | Server only | Optional | Defaults in code when unset. |
| `ENABLE_DEMO_MODE` | Server only | Optional | Defaults to enabled outside production and disabled in production. Do not enable on real production. |
| `VERCEL_URL` | Server | Automatic | Used as a fallback app URL by Vercel deployments. |

Generate `PLAID_TOKEN_ENCRYPTION_KEY`:

```bash
openssl rand -base64 32
```

## Supabase Setup

1. Create or select a Supabase project.
2. Enable Supabase Auth email/password sign-in.
3. Apply all SQL files in `supabase/migrations` in order.
4. Verify RLS is enabled on finance tables.
5. Verify `plaid_items.access_token_ciphertext` is not selectable by `anon` or `authenticated`.
6. Create at least one Supabase Auth user.
7. Load `supabase/seed.sql` only for development/demo data.

The seed uses a fixed demo `user_id`. Do not treat seed rows as real user data unless they are intentionally remapped to the signed-in user's id.

## Vercel Setup

1. Import the GitHub repository into Vercel.
2. Confirm Framework Preset is Next.js.
3. Use the default Next.js build output.
4. Set Build Command to:

```bash
npm run build
```

5. Add environment variables for Preview and Production.
6. Keep `ENABLE_DEMO_MODE` unset or `false` in Production.
7. Deploy a Preview build.
8. Verify login, app routes, Plaid settings, and CSV export.
9. Promote or deploy to Production after checks pass.

## Plaid Setup

### Local Sandbox

Use:

```bash
PLAID_ENV=sandbox
PLAID_REDIRECT_URI=http://localhost:3000/settings
```

Local OAuth redirects may require registering the local URI in Plaid. Non-OAuth Sandbox institutions may not need redirect registration.

### Production Or Limited Production

1. Use an HTTPS app URL.
2. Set `PLAID_ENV=production`.
3. Set `PLAID_PRODUCTION_SECRET`.
4. Set `PLAID_TOKEN_ENCRYPTION_KEY`.
5. Set `PLAID_REDIRECT_URI=https://your-domain/settings`.
6. Register the exact redirect URI in the Plaid dashboard.
7. Start with one institution.
8. Confirm import, manual sync, disconnect, and no duplicate transactions.

## OpenAI Setup

The app runs without OpenAI by using deterministic suggestions.

To enable OpenAI suggestions:

1. Set `OPENAI_API_KEY` in Vercel server environment.
2. Optionally set `OPENAI_MODEL`.
3. Deploy.
4. Verify Settings shows OpenAI configured.

OpenAI suggestions are advisory and do not write records autonomously.

## First Production Smoke Test

1. Confirm GitHub repo is private.
2. Confirm Vercel Production variables are present.
3. Confirm `ENABLE_DEMO_MODE` is not enabled.
4. Visit `/login`.
5. Sign in.
6. Confirm `/dashboard` loads.
7. Visit `/settings`.
8. Confirm Plaid environment is correct.
9. Connect one institution.
10. Confirm accounts and transactions import.
11. Run manual sync.
12. Confirm no duplicates.
13. Edit one transaction.
14. Resolve one review item if present.
15. Export CSV and inspect columns.
16. Disconnect the Plaid item if this was only a smoke test.

## Security Headers

`next.config.ts` applies security headers globally. After deploy, verify:

```bash
curl -I https://your-domain
```

Expected headers include:

- `Content-Security-Policy`
- `Permissions-Policy`
- `Referrer-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-Frame-Options`

If Plaid Link or Supabase Auth is blocked, inspect the CSP violation and update only the required directive.

## Rollback

For an app regression:

1. Use Vercel rollback to the previous healthy deployment.
2. Confirm environment variables were not changed accidentally.
3. Check Supabase migrations. Database migrations are not automatically rolled back by a Vercel rollback.
4. If a migration caused the issue, write a forward fix migration.

For a Plaid issue:

1. Stop manual syncs.
2. Inspect Vercel logs for safe Plaid error codes.
3. Confirm credentials and environment.
4. Revoke affected Plaid items only if needed.

For a secret issue:

1. Rotate the secret at the provider.
2. Update Vercel.
3. Redeploy.
4. Review logs and provider activity.

## Production Limitations

- Background Plaid sync scheduling is not implemented yet. Sync is manual.
- The app is single-user from a product perspective, though rows are modeled by `user_id`.
- AI suggestions are advisory.
- Token encryption key rotation needs a planned migration or reconnect flow.
- Full audit reporting UI is not implemented yet.
