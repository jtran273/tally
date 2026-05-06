# HANDOFF

## Current Commit

- `044487a3e97b1e53a452e549c178fc2cdf0a3d5e`
- Branch: `main`
- Remote: `origin/main`
- Working tree status at handoff check: clean

## Closed Issues

- #1 Create PRD and implementation plan docs
- #2 Scaffold Next.js app and Ledger design baseline
- #3 Configure Supabase Auth and environment
- #4 Add database schema and seed data
- #5 Build app shell and navigation hardening
- #6 Implement Plaid Link connection
- #7 Implement account, balance, and transaction sync
- #8 Build accounts and net worth dashboard from persisted data
- #9 Build transaction table and filters from persisted data
- #10 Build transaction editing, categories, and intent labels
- #11 Add AI suggestion adapter and mock suggestions
- #12 Build review queue workflow
- #14 Build recurring expense detection
- #16 Add CSV export
- #17 Add tests, CI, and reviewer checklist
- #18 Configure Vercel deployment and production readiness notes

## Open Issues

- #13 Build Venmo/Zelle/Cash App shared-expense resolution
- #15 Build insight cards with evidence links

## Issues Currently Blocked

- No GitHub issue is formally blocked.
- #15 should avoid taking ownership of spending calculations while #13 is active.

## Known Blockers

- Supabase CLI is not installed locally.
- Live browser-based Plaid Sandbox sync has not been fully verified after the corrected Plaid key.
- End-to-end Plaid sync requires a signed-in user and connected Sandbox institution.
- Peer-to-peer transactions intentionally remain unresolved until #13 lands.

## Env Status

- Use `.env.local`; do not create `.env.example`.
- `.env.local` exists and contains expected key names for Supabase, Plaid Sandbox, OpenAI, and Vercel.
- Do not print secret values.
- Plaid Link token check previously succeeded after key correction.

## Checks That Pass

As of commit `044487a`:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm audit --omit=dev`
- `git diff --check`

## Next Recommended Batch

Run two agents in parallel only with strict ownership:

- Agent A: Issue #13, shared-expense resolution.
  - Own peer-to-peer review resolution, transaction splits, split persistence, and split-aware spending calculations.
  - This agent owns any spending calculation changes.

- Agent B: Issue #15, insight cards.
  - Own deterministic insight generation and dashboard insight UI.
  - Must not modify spending calculation logic while #13 is running.
  - Should label unresolved/P2P data as unresolved, not confirmed.

## Files/Modules To Avoid Touching In Parallel

Avoid overlapping edits unless one agent is explicitly assigned ownership:

- `src/lib/db/queries.ts`
- `src/lib/db/types.ts`
- `supabase/migrations/*`
- `src/components/finance/review/*`
- `src/components/finance/dashboard/*`
- `src/components/finance/transactions/*`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/review/page.tsx`
- `src/app/(app)/transactions/actions.ts`
- `src/app/globals.css`

## Orchestration Notes

- Start fresh from `main` at `044487a`.
- Create `HANDOFF.md` first.
- Do not start more agents until `HANDOFF.md` exists.
- After #13 and #15 complete, run full checks again.
- Then commit, push, close issues, and do a final browser smoke test.
