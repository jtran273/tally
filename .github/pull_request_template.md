## Summary

-

## Related Issue

- Closes #

## Verification

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm audit --omit=dev`

## Issue Acceptance Criteria

- [ ] CI installs dependencies with `npm ci`.
- [ ] CI runs lint with `npm run lint`.
- [ ] CI runs tests/typecheck with `npm test`.
- [ ] CI builds the existing Next.js Ledger app with `npm run build`.
- [ ] CI audits production dependencies with `npm audit --omit=dev`.

## Reviewer Checklist

- [ ] Changes map back to the related issue acceptance criteria.
- [ ] Protected auth/schema paths are untouched unless the PR explicitly owns that work: `src/lib/supabase/*`, `src/app/login/*`, `src/middleware.ts`, `supabase/migrations/*`, `supabase/seed.sql`, `src/lib/db/*`.
- [ ] Any new checks or scripts are lightweight, dependency-free, and scoped to this issue.
