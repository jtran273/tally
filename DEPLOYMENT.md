# Deployment

Tally is designed to run on Vercel with Supabase Auth/Postgres, Plaid, and an optional OpenAI provider. Production setup must keep code, secrets, database access, and Plaid environment choices aligned.

## Deployment Targets

- **Local development**: `npm run dev`, Plaid Sandbox, `.env.local`, local demo mode allowed.
- **Vercel Preview**: branch deployments for testing Supabase and Plaid Sandbox or limited real-data checks.
- **Vercel Production**: `https://personal-finance-os-jtran273s-projects.vercel.app`, Supabase Auth, Plaid intended environment, seeded demo entry disabled unless `ENABLE_DEMO_MODE=true`.

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

## Public Repository Requirement

The GitHub repository is public. Production safety depends on keeping secrets, private financial exports, provider payload dumps, and deployment settings out of git. Verify visibility with:

```bash
gh repo view jtran273/personal-finance-os --json nameWithOwner,visibility,isPrivate,url
```

Expected:

```json
{"isPrivate":false,"visibility":"PUBLIC"}
```

Before production use, confirm GitHub secret scanning and push protection are enabled. Branch protection, Dependabot security updates, CodeQL, and dependency review should be enabled before treating `main` as protected.

## Environment Variables

Set local values in `.env.local`. Set Vercel values in Project Settings -> Environment Variables. Use separate values for Preview and Production when needed.

| Name | Scope | Required | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Browser/server | Production yes | Canonical app URL. Must be HTTPS in production. Not used as a production Plaid Link redirect fallback. |
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
| `PLAID_REDIRECT_URI` | Server only | Production OAuth optional | Leave unset for ordinary web Link sessions. If OAuth institutions require a redirect, set the exact HTTPS URI registered in Plaid. Local `http://localhost` redirects are ignored for production Link tokens because Plaid only permits them in Sandbox. |
| `GOOGLE_CALENDAR_CLIENT_ID` | Server only | Calendar yes | OAuth client id for read-only Google Calendar access. |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Server only | Calendar yes | OAuth client secret for read-only Google Calendar access. |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Server only | Calendar recommended | Exact OAuth callback registered in Google Cloud. Defaults from `NEXT_PUBLIC_APP_URL` to `/api/calendar/callback`; production must be HTTPS. |
| `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` | Server only | Production Calendar yes | Dedicated AES-GCM key material for stored Google Calendar access and refresh tokens. Keep stable. |
| `OPENAI_API_KEY` | Server only | Optional | Enables server-side OpenAI suggestion provider. |
| `OPENAI_MODEL` | Server only | Optional | Defaults in code when unset. |
| `ENABLE_OPENAI_AUTO_REVIEW` | Server only | Optional | Defaults to disabled. Set `true` only when Plaid import, review page load, and proactive scans should spend OpenAI tokens on automatic suggestions. Manual review suggestions still work when OpenAI is configured. |
| `ENABLE_DEMO_MODE` | Server only | Production optional | Defaults to enabled outside production and disabled in production. Set `true` only when the deployment should expose the seeded demo workspace. Demo data is served from the in-memory demo client, not real Supabase/Plaid rows. |
| `CRON_SECRET` | Server only | Plaid cron yes | Bearer secret Vercel sends to `/api/plaid/sync/scheduled` so only the scheduler can trigger Plaid sync. Optional proactive scan and OpenClaw scheduled routes also require it if they are separately scheduled later. |
| `OPENCLAW_TOKEN` | Server only | OpenClaw yes | Shared bearer secret for `/api/openclaw/signals` and `/api/openclaw/replies`. Rotate alongside the OpenClaw caller. |
| `OPENCLAW_USER_ID` | Server only | OpenClaw yes | Supabase user id whose Tally rows are exposed to the server-to-server OpenClaw integration. |
| `OPENCLAW_BRIEFING_CADENCE` | Server only | Optional | `weekly` by default. Set to `daily` only if the scheduled OpenClaw briefing job should refresh a daily proposal key. |
| `PROACTIVE_SCAN_ENABLED` | Server only | Optional | Defaults to disabled. Set `true` only when the scheduled reimbursement-candidate detector should read the configured user's transactions and persist advisory proposals. |
| `PROACTIVE_SCAN_USER_ID` | Server only | Optional | Supabase user id for the nightly proactive reimbursement scan. Falls back to `OPENCLAW_USER_ID`. |
| `PROACTIVE_SCAN_MAX_TX` | Server only | Optional | Hard cap on candidate transactions scanned per proactive run. Defaults to `100`. |
| `FIDELITY_HOLDINGS` | Server only | Optional | Manual Fidelity holdings priced from recent market quotes, for example `AAPL:10,NVDA:2,cash:0`. This only affects investment valuation display; it does not run Plaid or write provider data. |
| `MANUAL_INVESTMENT_HOLDINGS` | Server only | Optional | JSON array for manual holdings beyond Fidelity. Each entry may include `accountName` or `institutionName`, `cash`, and `holdings` with `symbol` and `shares`. |
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
   The Plaid opportunistic sync work requires `supabase/migrations/20260515000100_add_opportunistic_plaid_sync_source.sql`.
4. Verify RLS is enabled on finance tables.
5. Verify `plaid_items.access_token_ciphertext`, `plaid_items.plaid_item_id`, and `plaid_items.transaction_cursor` are not selectable by `anon` or `authenticated`.
6. Verify `raw_transactions.raw_payload`, provider transaction ids, location, and payment metadata are not selectable by `anon` or `authenticated`.
7. Verify direct authenticated writes are disabled for `plaid_items`, `agent_proposals`, and `audit_events`.
8. Create at least one Supabase Auth user.
9. Load `supabase/seed.sql` only for development/demo data.

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
6. Choose demo visibility intentionally: leave production unset or set `ENABLE_DEMO_MODE=false` to hide the seeded demo entry, or set `ENABLE_DEMO_MODE=true` only when the deployment should expose the seeded demo workspace.
7. Deploy a Preview build.
8. Verify login, app routes, Plaid settings, compact Accounts cards, and CSV export.
9. Set `CRON_SECRET`; `vercel.json` schedules `/api/plaid/sync/scheduled` daily at `12:00 UTC`, which is 5:00 AM America/Los_Angeles during daylight saving time. Vercel sends `CRON_SECRET` as the bearer token for cron invocations.
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
5. Leave `PLAID_REDIRECT_URI` unset unless you need OAuth institution redirects.
6. If `PLAID_REDIRECT_URI` is set, register that exact HTTPS URI in the Plaid dashboard.
7. Start with one institution.
8. Confirm import, opportunistic sync on app open, manual sync, disconnect, and no duplicate transactions.

For local desktop testing against Plaid Production, do not send `http://localhost` as the production redirect URI. Use a registered HTTPS tunnel/app URL, or omit the redirect URI and test from a normal desktop browser where Plaid can use a popup or new tab for OAuth institutions.

## Google Calendar Setup

Google Calendar is optional and read-only. It gives OpenClaw a minimized upcoming-event context for planning pressure such as travel, birthdays, weddings, and scheduled dinners.

1. Create a Google Cloud OAuth client for a web app.
2. Add the callback URL: `https://personal-finance-os-jtran273s-projects.vercel.app/api/calendar/callback`.
3. Set `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, and `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` in the production server environment. In Vercel, verify presence without revealing values: `vercel env ls production | grep GOOGLE_CALENDAR`.
4. Deploy, sign in, and connect Calendar from `/settings`.
5. Run the safe smoke check with production values loaded: `npm run calendar:prod-smoke`. To include the live OpenClaw endpoint, also set `OPENCLAW_SIGNALS_URL=https://<production-host>/api/openclaw/signals` and `OPENCLAW_TOKEN`; the script prints only status/counts and never prints token values or raw events.
6. Confirm `/api/openclaw/signals` includes `calendarContext` with `status: "ready"` only after Calendar is connected, and that each event includes only event start/end, redacted title, `locationCity`, all-day flag, and suspected category.

The app requests only `https://www.googleapis.com/auth/calendar.readonly`. It does not store descriptions, attendees, attendee emails, or raw Google event payloads in agent context. The offline smoke fixture covers travel, dining, gift, and wedding category inference before a live account is tested.

## OpenAI Setup

The app runs without OpenAI by using deterministic suggestions.

To enable OpenAI suggestions:

1. Set `OPENAI_API_KEY` in Vercel server environment.
2. Optionally set `OPENAI_MODEL`.
3. Leave `ENABLE_OPENAI_AUTO_REVIEW=false` or unset for manual-only token usage.
4. Set `ENABLE_OPENAI_AUTO_REVIEW=true` only if automatic Plaid import, review page cleanup, and enabled proactive scans should call OpenAI.
5. Deploy.
6. Verify Review can request an OpenAI suggestion.

Manual OpenAI suggestions are advisory and require user acceptance. Automatic OpenAI cleanup and proactive scans only run OpenAI when `ENABLE_OPENAI_AUTO_REVIEW=true`, and cleanup only applies eligible high-confidence ordinary categorization under server-side rules. The scheduled proactive scan route also requires `PROACTIVE_SCAN_ENABLED=true`; otherwise it returns a safe disabled status without reading transactions or creating proposals.

## First Production Smoke Test

1. Confirm GitHub repo visibility is intentional and public-safe repository protections are enabled.
2. Confirm Vercel Production variables are present.
3. Confirm the seeded demo entry visibility matches `ENABLE_DEMO_MODE`: production unset or `false` hides it; `true` shows it.
4. Visit `/login`.
5. Sign in.
6. Confirm `/dashboard` loads.
7. Confirm the dashboard Net worth, Liquid, Debt, and Spendable scopes, liabilities-due panel, and category trend/month views render.
8. Visit `/settings`.
9. Confirm bank connection controls, optional Google Calendar connection, last successful sync/read, and session access are correct.
10. Visit `/accounts` and confirm compact account cards show balances, relevant recent activity, and no duplicated Settings connection-health section.
11. Connect one institution.
12. Confirm accounts and transactions import.
13. Run manual sync.
14. Confirm no duplicates.
15. Edit one transaction.
16. Resolve one review item if present.
17. Export CSV and inspect columns.
18. Disconnect the Plaid item if this was only a smoke test. Historical Tally rows should remain unless you run the separate cleanup CLI against the revoked item.

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

- Scheduled Plaid sync is enabled through Vercel Cron at `12:00 UTC` daily. Vercel cron schedules are UTC, so this maps to 5:00 AM America/Los_Angeles during daylight saving time and 4:00 AM during standard time; on Hobby, invocation may occur within the scheduled hour. Proactive scan and OpenClaw briefing routes still need a separate trusted runner if enabled.
- The app is single-user from a product perspective, though rows are modeled by `user_id`.
- Manual AI suggestions are advisory and require user acceptance. Automatic OpenAI cleanup can apply only when `ENABLE_OPENAI_AUTO_REVIEW=true` and server-side heuristics deem a suggestion eligible; scheduled proactive scans also require `PROACTIVE_SCAN_ENABLED=true` before reading transactions, and use `ENABLE_OPENAI_AUTO_REVIEW=true` before spending OpenAI tokens.
- Bulk review acceptance is not implemented; review suggestions are accepted one item at a time.
- The agent inbox is still a review-first proposal surface. Persistent `agent_proposals` exist for longer-lived assistant proposals and clarification requests, but broader persisted proposal browsing remains future UI work.
- Reimbursement matching can rank likely reimbursement inflows and link them through audited helper paths after explicit approval; fully autonomous reimbursement lifecycle management is not implemented.
- Token encryption key rotation needs a planned migration or reconnect flow.
- Full audit reporting UI is not implemented yet.
