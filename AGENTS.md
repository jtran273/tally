# Agent Contribution Notes

This repo handles personal finance data. Keep changes small, reviewable, and explicit about verification.

## Default Workflow

1. Inspect `package.json`, `.github/workflows`, `README.md`, `ARCHITECTURE.md`, `OPERATIONS.md`, and the target code before editing.
2. Check `git status --short --branch` and avoid bundling unrelated local changes.
3. Prefer focused PRs that preserve the existing app UX unless the task explicitly asks for UX changes.
4. Update the relevant docs when routes, environment variables, setup steps, security behavior, data shape, or CI behavior change.
5. Run the narrowest useful local checks, then broaden based on risk.

## Checks

Use these commands when practical:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm test
npm run test:e2e
npm run build
npm audit --omit=dev
git diff --check
```

`npm test` runs typecheck plus unit tests. `npm run test:e2e` starts the Next.js dev server through Playwright and uses demo mode; set `ENABLE_DEMO_MODE=true` explicitly in CI or scripted runs.

## Data And Secret Guardrails

- Never commit `.env.local`, real financial exports, provider payload dumps, access tokens, service-role keys, auth headers, or database URLs.
- Keep Plaid access tokens and Supabase service-role operations in server-only code.
- Preserve the raw-versus-enriched transaction split.
- Keep user-owned rows scoped by `user_id` and account for RLS when changing database access.
- Treat AI output as advisory. It should not perform autonomous writes.

## PR Notes

Every PR should state what changed, why it changed, the verification performed, and any skipped checks or environment blockers. For overnight agent work, include enough handoff detail that the next reviewer can continue without reconstructing local context.
