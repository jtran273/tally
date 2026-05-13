# Security

This app handles financial data. Treat the repository, deployment settings, database, Plaid dashboard, and local environment as sensitive production surfaces.

## Repository Privacy

The `origin` remote is:

```text
https://github.com/jtran273/personal-finance-os.git
```

The expected GitHub visibility is:

```text
visibility: PRIVATE
isPrivate: true
```

Verify it with:

```bash
gh repo view jtran273/personal-finance-os --json nameWithOwner,visibility,isPrivate,url
```

If it ever becomes public again, make it private before using real financial data:

```bash
gh repo edit jtran273/personal-finance-os --visibility private --accept-visibility-change-consequences
```

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

## Secret History Check

A regex scan of current files and git history did not find obvious committed API keys or private keys. This does not replace a full secret scanner. Before treating the repository as clean, run a dedicated scanner such as Gitleaks or GitHub secret scanning.

Recommended local scan:

```bash
gitleaks detect --source . --no-git --redact
gitleaks detect --source . --redact
```

If a real secret was ever committed, rotate the secret even if the file was later deleted.

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
- `plaid_items.access_token_ciphertext` has select revoked from `anon` and `authenticated`.
- `google_calendar_connections` revokes table-level access from `anon` and `authenticated`, then grants `authenticated` only safe metadata columns; writes are service-route-only.
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

- Demo mode is enabled by default unless `ENABLE_DEMO_MODE=false`.
- Set `ENABLE_DEMO_MODE=false` on any production deployment where the demo entry should not appear.
- Set `ENABLE_DEMO_MODE=true` or leave it unset only for a deliberate non-sensitive demo deployment.
- Demo cookies are ignored when demo mode is disabled.

The demo workspace does not expose real financial data, but the production choice should still be explicit because the login page will show a demo entry when demo mode is enabled.

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

The scheduled sync route `/api/plaid/sync/scheduled` and scheduled OpenClaw briefing route `/api/openclaw/briefing/scheduled` are the exceptions: they are intended for trusted server-to-server callers and require `Authorization: Bearer <CRON_SECRET>`.

The Google Calendar OAuth callback is a browser redirect and uses a short-lived HTTP-only OAuth state cookie plus Supabase session verification instead of the same-origin POST guard.

The helper accepts the app origin, forwarded host origin, `NEXT_PUBLIC_APP_URL`, and `VERCEL_URL`. In production, requests without an `Origin` header are rejected.

Server actions also rely on Next.js server action origin checks and Supabase session verification.

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

## Production Checklist

- GitHub repo is private.
- Vercel project environment variables are set for Production and Preview separately.
- `ENABLE_DEMO_MODE` is explicitly set for production: `false` to hide the demo entry, or `true`/unset only when a seeded product walkthrough is intentional.
- `CRON_SECRET` is set before enabling scheduled sync or scheduled OpenClaw briefings and omitted when no scheduler is configured.
- `PLAID_TOKEN_ENCRYPTION_KEY` is set in production.
- `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` is set before enabling Google Calendar.
- `NEXT_PUBLIC_APP_URL` is the canonical HTTPS production URL.
- `PLAID_REDIRECT_URI` is HTTPS and registered in Plaid.
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
