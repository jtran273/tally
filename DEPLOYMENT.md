# Deployment

Ledger is designed to run on Vercel with Supabase Auth/Postgres, Plaid, and an optional OpenAI provider. Production setup must keep code, secrets, database access, and Plaid environment choices aligned.

## Deployment Targets

- **Local development**: `npm run dev`, Plaid Sandbox, `.env.local`, local demo mode allowed.
- **Vercel Preview**: branch deployments for testing Supabase and Plaid Sandbox or limited real-data checks.
- **Vercel Production**: `https://personal-finance-os-jtran273s-projects.vercel.app`, Supabase Auth, Plaid intended environment, seeded demo entry available unless disabled.

Use the stable production alias above for day-to-day access. Vercel also creates per-deployment URLs such as `personal-finance-<hash>-jtran273s-projects.vercel.app`; those are immutable build artifacts, not the main app URL.

## Required Services

- GitHub repository connected to Vercel.
- Vercel project using the Next.js preset.
- Supabase project with Auth enabled.
- Supabase database with migrations applied.
- Plaid app with Sandbox credentials for local work.
- Plaid Production or Limited Production credentials only when ready for real institutions.
- Google Cloud OAuth client for optional read-only Calendar context.
- Optional OpenAI API key for server-side suggestions.

## Production Repository Requirement

The GitHub repository is expected to be private for production financial data. Verify it with:

```bash
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
| `PLAID_REDIRECT_URI` | Server only | Production OAuth recommended | Exact HTTPS redirect URI registered in Plaid. Current production value should be `https://personal-finance-os-jtran273s-projects.vercel.app/settings`. Local `http://localhost` redirects are ignored for production Link tokens because Plaid only permits them in Sandbox. |
| `GOOGLE_CALENDAR_CLIENT_ID` | Server only | Calendar yes | OAuth client id for read-only Google Calendar access. |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Server only | Calendar yes | OAuth client secret for read-only Google Calendar access. |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Server only | Calendar recommended | Exact OAuth callback registered in Google Cloud. Defaults from `NEXT_PUBLIC_APP_URL` to `/api/calendar/callback`; production must be HTTPS. |
| `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` | Server only | Production Calendar yes | Dedicated AES-GCM key material for stored Google Calendar access and refresh tokens. Keep stable. |
| `OPENAI_API_KEY` | Server only | Optional | Enables server-side OpenAI suggestion provider. |
| `OPENAI_MODEL` | Server only | Optional | Defaults in code when unset. |
| `ENABLE_OPENAI_AUTO_REVIEW` | Server only | Optional | Defaults to disabled. Set `true` only when Plaid import and review page load should spend OpenAI tokens on automatic suggestions. Manual review suggestions still work when OpenAI is configured. |
| `ENABLE_DEMO_MODE` | Server only | Production explicit | Defaults to enabled. Set `false` to hide the seeded demo entry, or set `true`/leave unset only for an intentional demo deployment. Demo data is served from the in-memory demo client, not real Supabase/Plaid rows. |
| `CRON_SECRET` | Server only | Scheduled jobs yes | Shared bearer secret for `/api/plaid/sync/scheduled` and `/api/openclaw/briefing/scheduled`. Required before enabling Vercel Cron or another scheduler. |
| `OPENCLAW_TOKEN` | Server only | OpenClaw yes | Shared bearer secret for `/api/openclaw/signals` and `/api/openclaw/replies`. Rotate alongside the OpenClaw caller. |
| `OPENCLAW_USER_ID` | Server only | OpenClaw yes | Supabase user id whose Ledger rows are exposed to the server-to-server OpenClaw integration. |
| `OPENCLAW_BRIEFING_CADENCE` | Server only | Optional | `weekly` by default. Set to `daily` only if the scheduled OpenClaw briefing job should refresh a daily proposal key. |
| `VERCEL_URL` | Server | Automatic | Used as a fallback app URL by Vercel deployments. |

Generate `PLAID_TOKEN_ENCRYPTION_KEY`:

```bash
openssl rand -base64 32
```

Existing Plaid access tokens may have been encrypted with the legacy Plaid-derived key. The app can still decrypt those legacy tokens for sync, but production encryption for new connections requires `PLAID_TOKEN_ENCRYPTION_KEY`. Do not rotate Plaid secrets or the explicit token key without confirming existing items still sync.

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
6. Choose demo visibility intentionally: set `ENABLE_DEMO_MODE=false` to hide the seeded demo entry, or set `true`/leave unset only when the deployment should expose the seeded demo workspace.
7. Deploy a Preview build.
8. Verify login, app routes, Plaid settings, and CSV export.
9. If scheduled jobs are enabled, set `CRON_SECRET` and configure the scheduler to call `/api/plaid/sync/scheduled` and optionally `/api/openclaw/briefing/scheduled` with `Authorization: Bearer <CRON_SECRET>`.
10. Promote or deploy to Production after checks pass.

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
5. Set `PLAID_REDIRECT_URI=https://personal-finance-os-jtran273s-projects.vercel.app/settings`.
6. Register the exact redirect URI in the Plaid dashboard.
7. Start with one institution.
8. Confirm import, manual sync, disconnect, and no duplicate transactions.

For local desktop testing against Plaid Production, do not send `http://localhost` as the production redirect URI. Use a registered HTTPS tunnel/app URL, or omit the redirect URI and test from a normal desktop browser where Plaid can use a popup or new tab for OAuth institutions.

## Google Calendar Setup

Google Calendar is optional and read-only. It gives OpenClaw a minimized upcoming-event context for planning pressure such as travel, birthdays, weddings, and scheduled dinners.

1. Create a Google Cloud OAuth client for a web app.
2. Add the callback URL: `https://personal-finance-os-jtran273s-projects.vercel.app/api/calendar/callback`.
3. Set `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, and `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`.
4. Deploy, sign in, and connect Calendar from `/settings`.
5. Confirm `/api/openclaw/signals` includes `calendarContext` with only event start/end, redacted title, `locationCity`, all-day flag, and suspected category.

The app requests only `https://www.googleapis.com/auth/calendar.readonly`. It does not store descriptions, attendees, attendee emails, or raw event payloads in agent context.

## OpenAI Setup

The app runs without OpenAI by using deterministic suggestions.

To enable OpenAI suggestions:

1. Set `OPENAI_API_KEY` in Vercel server environment.
2. Optionally set `OPENAI_MODEL`.
3. Leave `ENABLE_OPENAI_AUTO_REVIEW=false` or unset for manual-only token usage.
4. Set `ENABLE_OPENAI_AUTO_REVIEW=true` only if automatic Plaid import and review page cleanup should call OpenAI.
5. Deploy.
6. Verify Review can request an OpenAI suggestion.

Manual OpenAI suggestions are advisory and require user acceptance. Automatic OpenAI cleanup only runs when `ENABLE_OPENAI_AUTO_REVIEW=true` and only applies eligible high-confidence ordinary categorization under server-side rules.

## First Production Smoke Test

1. Confirm GitHub repo is private.
2. Confirm Vercel Production variables are present.
3. Confirm the seeded demo entry visibility matches `ENABLE_DEMO_MODE`: `false` hides it; `true` or unset shows it.
4. Visit `/login`.
5. Sign in.
6. Confirm `/dashboard` loads.
7. Confirm the dashboard balance scopes, liabilities-due panel, and category trend/month views render.
8. Visit `/settings`.
9. Confirm bank connection controls, optional Google Calendar connection, last successful sync/read, and session access are correct.
10. Connect one institution.
11. Confirm accounts and transactions import.
12. Run manual sync.
13. Confirm no duplicates.
14. Edit one transaction.
15. Resolve one review item if present.
16. Export CSV and inspect columns.
17. Disconnect the Plaid item if this was only a smoke test.

## Security Headers

`next.config.ts` applies security headers globally. After deploy, verify:

```bash
curl -I https://personal-finance-os-jtran273s-projects.vercel.app
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

- Scheduled Plaid sync and OpenClaw briefing routes exist, but no scheduler is enabled unless Vercel Cron or another trusted runner is configured with `CRON_SECRET`.
- The app is single-user from a product perspective, though rows are modeled by `user_id`.
- Manual AI suggestions are advisory and require user acceptance. Automatic OpenAI cleanup can apply only when `ENABLE_OPENAI_AUTO_REVIEW=true` and server-side heuristics deem a suggestion eligible.
- Bulk review acceptance is not implemented; review suggestions are accepted one item at a time.
- The agent inbox is derived from review items and suggestions; it is not a persisted generic proposal store yet.
- Reimbursement reporting exists, but automatic reimbursement matching and full reimbursement lifecycle management are not implemented yet.
- Token encryption key rotation needs a planned migration or reconnect flow.
- Full audit reporting UI is not implemented yet.
