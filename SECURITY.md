# Security

This app handles financial data. Treat the repository, deployment settings, database, Plaid dashboard, and local environment as sensitive production surfaces.

## Public Repository Posture

The `origin` remote is:

```text
https://github.com/jtran273/personal-finance-os.git
```

The GitHub repository is public by design:

```text
visibility: PUBLIC
isPrivate: false
```

Verify it with:

```bash
gh repo view jtran273/personal-finance-os --json nameWithOwner,visibility,isPrivate,url
```

Public source is acceptable only because real financial data, provider payload dumps, secrets, tokens, database URLs, and deployment settings are kept out of git. If real secrets or private exports are ever committed, rotate the affected secret or remove the exposed data even if the file is later deleted.

If the repo should become private again, use:

```bash
gh repo edit jtran273/personal-finance-os --visibility private --accept-visibility-change-consequences
```

Current GitHub repository protections confirmed enabled:

- secret scanning,
- secret scanning push protection.

Recommended GitHub repository settings to enable or keep enabled:

- Dependabot alerts and security updates,
- branch protection on `main` requiring pull requests and passing checks,
- CodeQL code scanning through `.github/workflows/codeql.yml`,
- dependency review through `.github/workflows/dependency-review.yml`.

## Secret Handling

Never commit real secrets. Local secrets belong in `.env.local`; deployment secrets belong in Vercel environment variables and provider dashboards.

Server-only secrets:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_SANDBOX_SECRET`
- `PLAID_PRODUCTION_SECRET`
- `PLAID_TOKEN_ENCRYPTION_KEY`
- `PLAID_REDIRECT_URI`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`
- `OPENAI_API_KEY`
- `CRON_SECRET`
- `OPENCLAW_TOKEN`
- `OPENCLAW_USER_ID`
- `PROACTIVE_SCAN_ENABLED`
- `PROACTIVE_SCAN_USER_ID`

Browser-exposed values:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The Supabase anon key is not secret. It must still be protected by RLS.

## Git Ignore Coverage

The repo ignores:

- `.env`
- `.env*`
- `*.env`
- `.env*.local`
- `.vercel`
- `.next`
- `node_modules`
- logs, coverage, build output, editor folders, and `tsconfig.tsbuildinfo`

Current local secret files are not tracked by git.

## Secret And History Checks

A regex scan of current files and git history should not find real committed API keys or private keys. This does not replace GitHub secret scanning or a dedicated local scanner.

Recommended local scan:

```bash
gitleaks detect --source . --no-git --redact
gitleaks detect --source . --redact
```

If a real secret was ever committed, rotate the secret even if the file was later deleted. For this public repo, also confirm GitHub secret scanning push protection remains enabled before pushing new branches.

## Authentication

Supabase Auth is the primary auth system.

- Middleware in `src/lib/supabase/middleware.ts` protects app routes.
- `/login` is public.
- Static assets and Next internals are excluded from the auth matcher.
- Server components use `createSupabaseServerClient()`.
- Client sign-in uses `createSupabaseBrowserClient()`.
- Sign-out clears both Supabase state and the demo cookie.

## Authorization

The database is the security boundary.

- Every finance table includes `user_id`.
- RLS is enabled for finance tables.
- Policies constrain access to `auth.uid() = user_id`.
- `plaid_items.access_token_ciphertext`, `plaid_items.plaid_item_id`, and `plaid_items.transaction_cursor` have select revoked from `anon` and `authenticated`.
- `raw_transactions.raw_payload`, provider transaction ids, location, and payment metadata have select revoked from `anon` and `authenticated`; normal app reads use the narrowed raw context needed for review/search.
- `google_calendar_connections` revokes table-level access from `anon` and `authenticated`, then grants `authenticated` only safe metadata columns; writes are service-route-only.
- `plaid_items`, `agent_proposals`, and `audit_events` writes are service-route-only.
- Server routes that need privileged writes use `SUPABASE_SERVICE_ROLE_KEY` and still pass the signed-in user's `userId` into every mutation.

## Plaid Token Security

Plaid access tokens are encrypted with AES-256-GCM in `src/lib/plaid/token-vault.ts`.

Production requires `PLAID_TOKEN_ENCRYPTION_KEY`. Generate it with:

```bash
openssl rand -base64 32
```

The encryption code can still decrypt legacy local tokens derived from Plaid credentials, but new production tokens should use the dedicated encryption key. Keep this key stable for the lifetime of stored Plaid tokens. If it is lost, existing Plaid items cannot be decrypted and must be reconnected.

## Google Calendar Token Security

Google Calendar access and refresh tokens are encrypted with AES-256-GCM in `src/lib/calendar/token-vault.ts`.

Production requires `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`. Generate it with:

```bash
openssl rand -base64 32
```

The Calendar OAuth flow requests only `https://www.googleapis.com/auth/calendar.readonly`. Event reads request only status, start, end, summary, and location fields from Google. Agent context excludes descriptions, attendees, attendee emails, raw Google event payloads, OAuth tokens, and provider diagnostics.

## Demo Mode

Demo mode is intended for local development, screenshots, smoke tests, and deliberate product walkthroughs. It serves seeded in-memory finance rows through the demo finance client, not real Supabase/Plaid rows.

- Demo mode defaults on outside production.
- Demo mode defaults off in production.
- Set `ENABLE_DEMO_MODE=true` only for a deliberate non-sensitive production demo deployment.
- Set `ENABLE_DEMO_MODE=false` when local or preview testing must exercise only the real Supabase sign-in path.
- Demo cookies are ignored when demo mode is disabled.

The demo workspace does not expose real financial data, but production demo availability should still be explicit because the login page will show a demo entry when demo mode is enabled.

## Cross-Origin Request Protection

Mutating route handlers use `requireSameOriginRequest()` from `src/lib/security/request.ts`.

Protected handlers include:

- `/api/plaid/link-token`
- `/api/plaid/exchange`
- `/api/plaid/sync`
- `/api/plaid/connections/[connectionId]`
- `/api/calendar/auth-url`
- `/api/calendar/connections/[connectionId]`
- `/login/demo`
- `/login/logout`

The scheduled sync route `/api/plaid/sync/scheduled`, proactive scan route `/api/agents/proactive-scan/scheduled`, and scheduled OpenClaw briefing route `/api/openclaw/briefing/scheduled` are the exceptions: they are intended for trusted server-to-server callers and require `Authorization: Bearer <CRON_SECRET>`.

The Google Calendar OAuth callback is a browser redirect and uses a short-lived HTTP-only OAuth state cookie plus Supabase session verification instead of the same-origin POST guard.

The CSV export route is a credentialed read rather than a mutation. It rejects cross-site browser reads and returns `Cache-Control: no-store` so filtered enriched transaction exports cannot be read cross-origin or cached by shared intermediaries.

The helper accepts the app origin, forwarded host origin, `NEXT_PUBLIC_APP_URL`, and `VERCEL_URL`. In production, requests without an `Origin` header are rejected.

Server actions also rely on Next.js server action origin checks and Supabase session verification.

## Mobile Install And Notifications

Tally exposes a web app manifest so the app can be installed to a mobile home screen. The first pass intentionally does not add a service worker, offline finance data cache, offline mutation path, or browser push subscription flow.

If push notifications are added later, they must be opt-in, manageable from Settings, and limited to non-conversational status alerts. Notification payloads must not include merchant names, amounts, account names, transaction ids, provider ids, notes, raw payload fragments, or other private finance data. Conversational reminders, clarification questions, and assistant-style nudges belong to OpenClaw unless this boundary is deliberately changed. See `docs/mobile-pwa-notifications.md`.

## Browser Security Headers

`next.config.ts` sets baseline headers:

- `Content-Security-Policy`
- `Permissions-Policy`
- `Referrer-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-DNS-Prefetch-Control`
- `X-Frame-Options`

The CSP allows the app itself, Supabase, and Plaid domains needed for Auth and Plaid Link. If a new browser-side vendor is added, update the CSP intentionally.

## Logging Rules

Safe to log:

- route context names,
- high-level provider error codes,
- counts of imported rows,
- app-owned database ids when useful for debugging,
- non-secret status values.

Do not log:

- Plaid access tokens,
- Google Calendar access or refresh tokens,
- Plaid secrets,
- Supabase service role key,
- raw auth headers,
- full database URLs,
- full Plaid payloads,
- raw Google Calendar event payloads,
- Plaid item, account, or transaction ids in user-visible logs or agent payloads,
- full transaction notes unless explicitly needed for a support flow.

Privileged route handlers should use `logSafeError()` instead of logging raw error objects. The safe logger records only name/message/code/status-shaped metadata and redacts secret-shaped strings.

## Production Checklist

- GitHub repo visibility is intentional and verified.
- GitHub secret scanning and push protection are enabled.
- Dependabot alerts and security updates are enabled, or any disabled setting is documented.
- `main` has branch protection requiring pull requests and passing checks, or the lack of branch protection is documented.
- Vercel project environment variables are set for Production and Preview separately.
- `ENABLE_DEMO_MODE` is set to `true` in production only when a seeded product walkthrough is intentional.
- `CRON_SECRET` is set before enabling scheduled sync, proactive scans, or scheduled OpenClaw briefings and omitted when no scheduler is configured.
- `PROACTIVE_SCAN_ENABLED` is set to `true` only when scheduled reimbursement-candidate proposals are intentionally enabled for the configured user.
- `PLAID_TOKEN_ENCRYPTION_KEY` is set in production.
- `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` is set before enabling Google Calendar.
- `NEXT_PUBLIC_APP_URL` is the canonical HTTPS production URL.
- `PLAID_REDIRECT_URI` is unset for ordinary Plaid Link sessions, or HTTPS and registered in Plaid when OAuth redirects are required.
- `GOOGLE_CALENDAR_REDIRECT_URI` is HTTPS and registered in Google Cloud when Calendar is enabled.
- Supabase Auth is enabled.
- Supabase migrations are applied.
- RLS is enabled and verified.
- Plaid is using the intended environment.
- OpenAI key is present only if AI suggestions should run.
- CI is passing.
- `npm audit --omit=dev` has no unresolved high or critical production findings.

## Incident Response

If a secret is exposed:

1. Remove the secret from the active deployment environment.
2. Rotate it in the provider dashboard.
3. Update Vercel with the new value.
4. Redeploy.
5. Search logs for use of the exposed secret.
6. Review recent account activity in Supabase, Plaid, OpenAI, Vercel, and GitHub.
7. If committed to git, assume it is compromised even after removal.

If Plaid access tokens are exposed:

1. Revoke affected Plaid items through the app or Plaid.
2. Rotate Plaid secrets.
3. Rotate `PLAID_TOKEN_ENCRYPTION_KEY` only after planning token migration or reconnecting affected items.
4. Audit `plaid_items`, `audit_events`, and recent sync logs.

If Google Calendar tokens are exposed:

1. Revoke the affected Google OAuth grant.
2. Rotate `GOOGLE_CALENDAR_CLIENT_SECRET` if needed.
3. Rotate `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` only after planning token migration or reconnecting Calendar.
4. Audit `google_calendar_connections`, `audit_events`, and recent app logs.

## Reporting Security Issues

Do not open public GitHub issues with secrets or private financial data. Use a private channel and include:

- what happened,
- when it happened,
- affected environment,
- affected account or deployment,
- relevant logs with secrets redacted,
- steps already taken.
