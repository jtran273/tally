# Deployment

This MVP is designed for Vercel, Supabase, and Plaid Sandbox. Local secrets live in `.env.local`; deployment secrets live in the Vercel project environment settings. Do not commit either real values or generated secret templates.

## Required Services

- Vercel project connected to this GitHub repository.
- Supabase project with Auth enabled and the SQL migration in `supabase/migrations` applied.
- Plaid Sandbox app credentials.
- OpenAI API key for later AI-provider work; current suggestion logic can remain deterministic until the AI integration issue lands.

## Environment Variables

Set these in `.env.local` for local development and in Vercel for Preview/Production:

| Name | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser/server | Supabase project URL. Safe to expose as a public Supabase client setting. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server | Supabase anon key. Protected by RLS, not by secrecy. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Never expose to browser code. Use only in server routes/jobs that need admin access. |
| `SUPABASE_DB_URL` | Server/tooling | Direct Postgres connection string for migrations or server-side maintenance. |
| `PLAID_CLIENT_ID` | Server only | Plaid Sandbox client id. |
| `PLAID_SECRET` | Server only | Plaid Sandbox secret. Never expose to browser code. |
| `PLAID_ENV` | Server only | Use `sandbox` for the MVP. |
| `OPENAI_API_KEY` | Server only | Reserved for the swappable AI provider. Do not use from client components. |

## Supabase Setup

1. Create or select a Supabase project.
2. Apply `supabase/migrations/20260506000100_finance_schema.sql`.
3. Load `supabase/seed.sql` only for demo/dev data.
4. Confirm Row Level Security is enabled on finance tables.
5. Create at least one Supabase Auth user before using protected app routes.

The seed uses a fixed demo `user_id`. For real testing, either create matching data for your authenticated user id or add a controlled seed path that maps demo rows to the signed-in user.

## Vercel Setup

1. Import the GitHub repo into Vercel.
2. Set the environment variables above in the Vercel project settings.
3. Use the default Next.js build command: `npm run build`.
4. Deploy a Preview build from the current branch.
5. Verify `/login` renders, protected routes redirect unauthenticated users, and the Ledger shell renders after sign-in.

## Plaid Sandbox Setup

1. Keep `PLAID_ENV=sandbox` until the MVP has been reviewed end to end.
2. Add local and Vercel app URLs to the Plaid dashboard redirect configuration when OAuth redirect flows are used.
3. Exchange Plaid public tokens only in server route handlers.
4. Store Plaid access tokens server-side only. The schema has a dedicated `access_token_ciphertext` field; do not send it to client components or exports.

## Safe Logging

- Log request ids, issue ids, sync counts, and high-level error codes.
- Do not log Plaid access tokens, Supabase service-role keys, raw auth headers, full database URLs, or full Plaid payloads.
- Scrub user notes and transaction descriptions from production error logs unless they are necessary for a user-facing support flow.
- Return generic user-facing sync errors and keep detailed provider error metadata server-side.

## MVP Limitations

- Plaid is Sandbox-only.
- The first AI suggestion provider is deterministic/mock; no autonomous edits are allowed.
- The app is single-user per account, with `user_id` modeled throughout for later expansion.
- CSV export is intentionally simple and should exclude Plaid tokens and other secrets.
- Production-grade secret rotation, background sync scheduling, and full audit reporting are future hardening work.
