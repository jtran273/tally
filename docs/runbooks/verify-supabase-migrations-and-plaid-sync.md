# Runbook: Verify Supabase finance migrations and Plaid sync (issue #236)

Vercel deploys the app code, but it does **not** apply Supabase SQL migrations.
If production has stale schema, Plaid sync can fail even though the deploy is
green. This runbook confirms the three hardening migrations are applied and that
a live sync works.

Migrations in scope:

- `supabase/migrations/20260513000100_add_agent_proposals.sql`
- `supabase/migrations/20260604000100_add_anomaly_alerts.sql`
- `supabase/migrations/20260604000200_add_plaid_pending_replacement_count.sql`
- `supabase/migrations/20260604000300_add_review_resolution_kind.sql`
- `supabase/migrations/20260608000200_repair_agent_proposals_schema.sql`

> Do not paste real Plaid tokens, service-role keys, database URLs, or provider
> payloads into issues, PRs, or chat.

## 1. Fast automated check (read-only)

Start with the consolidated local/env-shape preflight:

```bash
npm run ops:preflight
```

From a trusted operator machine with the production Supabase env loaded:

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
export SUPABASE_SERVICE_ROLE_KEY="<service role key>"   # bypasses RLS for an accurate global check

npm run migrations:verify
```

It probes each expected table/column and the `resolution_kind` backfill, printing
`PASS`/`FAIL` per check. It only runs `SELECT`/`count` and never prints secrets or
row data. Exit code is non-zero if anything is missing. It refuses to run in CI.

This covers acceptance criteria 1–3 except RLS **policy** presence, which is
verified by SQL in step 3.

If `ops:preflight` reports `BLOCKED` for #236, stop there. The schema verifier
needs production Supabase env, and the sync closeout needs a signed-in user or
the configured OpenClaw refresh token path.

## 2. Apply migrations if any check fails

Apply the in-repo migrations to production using your normal path, e.g. the
Supabase CLI linked to the production project:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Each migration is idempotent (`if not exists` / guarded `do $$` blocks), so
re-running is safe. Re-run `npm run migrations:verify` until every check is `PASS`.

## 3. Confirm RLS and policies on `anomaly_alerts`

Run this in the Supabase SQL editor (production). Expected: RLS enabled and a
`SELECT`-own policy for `authenticated`; inserts/updates/deletes go through
`service_role` only.

```sql
-- RLS enabled?
select relname, relrowsecurity
from pg_class
where relname = 'anomaly_alerts';

-- Policies present (expect anomaly_alerts_select_own for authenticated)?
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'anomaly_alerts';

-- Grants (expect select to authenticated, all to service_role; none to anon)?
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'anomaly_alerts'
order by grantee, privilege_type;
```

## 4. Verify a live signed-in Plaid sync

If OpenClaw is configured for this deployment, first run the bounded refresh
probe from a trusted operator shell:

```bash
export OPENCLAW_TALLY_BASE_URL="https://<tally-host>"
export OPENCLAW_PLAID_REFRESH_TOKEN="<refresh token>"
npm run openclaw:plaid-refresh
```

If it returns `OpenClaw Plaid refresh is not configured.`, set
`OPENCLAW_PLAID_REFRESH_TOKEN` on the deployed Tally server before using
OpenClaw to trigger refreshes. That error happens before any Plaid item or
Supabase schema diagnosis starts.

### 2026-06-05 OpenClaw refresh status

The deployed refresh endpoint was checked before continuing SchoolsFirst
diagnosis:

- Latest production deployment discovered from GitHub Deployments:
  `https://personal-finance-dwbw7xplg-jtran273s-projects.vercel.app`
- #256 preview deployment discovered from GitHub Deployments:
  `https://personal-finance-7xk5mqcvk-jtran273s-projects.vercel.app`
- Safe no-token POST to `/api/openclaw/plaid-refresh` returned HTTP 503 with
  `OpenClaw Plaid refresh is not configured.` on both deployments.

This confirms the deployed server has not been configured with
`OPENCLAW_PLAID_REFRESH_TOKEN` for these deployments. Do **not** infer a
SchoolsFirst root cause yet. The refresh route stops before Plaid item repair,
Transactions availability, Supabase schema, or internal save logic can be
observed.

Next unblock:

1. Set `OPENCLAW_PLAID_REFRESH_TOKEN` in the deployed Tally server environment
   for the deployment being tested.
2. Re-deploy or otherwise restart the serverless environment so the route sees
   the new variable.
3. Re-run:

   ```bash
   export OPENCLAW_TALLY_BASE_URL="https://<deployed-tally-host>"
   export OPENCLAW_PLAID_REFRESH_TOKEN="<same caller token>"
   npm run openclaw:plaid-refresh
   ```

4. If the probe then returns a safe sync packet, classify the SchoolsFirst
   failure from `status`, `reason`, and `sync.errorSummary` only:
   - item repair/re-auth if the safe error indicates a Plaid item repair state
   - Transactions availability if the safe error indicates product
     unavailability
   - Supabase schema if the safe error references missing expected columns or
     tables
   - internal save logic if Plaid succeeds but sanitized persistence counters or
     save errors show a local write failure
5. If it still returns `OpenClaw Plaid refresh is not configured.`, stop at
   server env configuration; do not debug SchoolsFirst.

1. Sign in to production as a real user with a linked Plaid item.
2. Open **Settings → bank connections** and trigger a manual sync.
3. Expected outcomes (acceptance criteria 4–5):
   - The sync completes, **or** returns a clear, actionable provider/config error
     (e.g. an item-repair / re-auth prompt) rather than a generic failure.
   - The bank-connections card no longer shows the generic
     "Unable to sync Plaid data" state after the manual sync, unless Plaid itself
     returns an item repair error.
4. Spot-check that `plaid_sync_runs` recorded the run with the new
   `pending_transactions_replaced` column populated (0 is fine):

   ```sql
   select id, status, pending_transactions_replaced, created_at
   from public.plaid_sync_runs
   order by created_at desc
   limit 5;
   ```

## 5. Close out

When all schema checks pass, policies are confirmed, and a live sync completes
(or returns a safe actionable error), update issue #236 with the results
(no secrets) and close it.

## Troubleshooting

- **`table missing` / `column missing`** from the verifier → migration not applied;
  go to step 2.
- **`resolution_kind backfill` FAIL** → resolved/dismissed rows have a null
  `resolution_kind`. Re-run migration `20260604000300`; its `update ... where
  status <> 'open'` backfills them.
- **Generic sync failure persists** → capture the structured error shown in the
  Settings card and the latest `plaid_sync_runs` row status; if Plaid returns an
  `ITEM_LOGIN_REQUIRED`/repair error, that is expected and not a schema problem.
