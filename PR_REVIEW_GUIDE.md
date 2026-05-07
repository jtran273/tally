# Grace Overnight PR Review Guide

Generated: 2026-05-06 23:55 PT

Scope: integration audit for open Grace overnight PRs requested as #20, #21, #22, #23, #24, #38, and #39.

## Access Notes

- `gh pr list` and `git ls-remote` could not reach GitHub from this sandbox (`Could not resolve host: github.com` / `error connecting to api.github.com`).
- The GitHub connector returned 404 for PR #20, so PR metadata could not be refreshed from GitHub.
- Audit evidence therefore uses the seven locally available `origin/grace/night-*` refs. No additional remote PRs could be discovered.
- Local `grace/night-first-run-checklist-0506` and `grace/night-agent-manifest-0506` point at `origin/main` with no unique diff. Local `grace/night-merchant-rules-0506` points at the same commit as `origin/grace/night-review-ai-0506`.

## Assumed PR Map

| PR | Branch | Commit | Summary |
| --- | --- | --- | --- |
| #20 | `origin/grace/night-dashboard-ui-0506` | `00f0405` | Fix dashboard trend chart scaling and wide-viewport text distortion |
| #21 | `origin/grace/night-data-quality-0506` | `69aa68d` | Reduce review queue noise and expand Plaid transaction categorization |
| #22 | `origin/grace/night-review-ai-0506` | `dbc4e54` | Improve review AI with merchant rules, category validation, provider status, and tests |
| #23 | `origin/grace/night-ci-hardening-0506` | `3d77135` | Add CI hardening, agent contribution notes, and workflow docs |
| #24 | `origin/grace/night-roadmap-issues-0506` | `974fd02` | Add product roadmap |
| #38 | `origin/grace/night-spending-insights-0506` | `7a03a49` | Add deterministic spending insight summaries |
| #39 | `origin/grace/night-recurring-automation-0506` | `1ea7619` | Improve recurring detection and subscription review |

## Conflict Audit

Method: `git merge-tree <merge-base> origin/main <branch>` for each branch, plus pairwise branch checks using local object data. A disposable worktree was attempted but blocked because this checkout's Git metadata lives outside the writable root.

Result:

- Each local Grace branch is a one-commit branch from current `origin/main` (`1fb1d68`).
- All seven branches merge cleanly into current `origin/main` in the local object database.
- Pairwise branch merge checks emitted no textual conflicts.
- No merge commits were created, no branch was merged into `main`, and nothing was pushed.

Conflict risk by file overlap:

- Low direct conflict risk overall.
- #21 and #22 both touch review-related behavior but not the same core files except adjacent review domain logic.
- #38 and #20 both affect dashboard behavior, but #20 is chart rendering/CSS and #38 is insight data generation/page props.
- #39 and #21 have semantic overlap around recurring review noise: #21 stops large recurring transactions from being flagged as large, while #39 expands recurring detection and attention flags.
- #23 changes CI and docs only, but it changes `package.json` scripts. Merge it before relying on `npm run test:unit` in later PR verification.

## Recommended Review And Merge Order

1. #23 `night-ci-hardening-0506`
   - Reason: establishes CI scripts/docs (`test:unit`, explicit typecheck, Playwright smoke test) and should be in place before reviewing behavior PRs.
   - Main risk: CI runtime expands materially because Playwright browser install and e2e smoke tests are added.

2. #24 `night-roadmap-issues-0506`
   - Reason: docs-only roadmap, no code dependency.
   - Main risk: product direction wording, not integration.

3. #20 `night-dashboard-ui-0506`
   - Reason: isolated dashboard chart UI fix with minimal surface area.
   - Main risk: `ResizeObserver` in a client component should be acceptable in modern browsers, but reviewers should smoke-test dashboard chart rendering on narrow and wide screens.

4. #21 `night-data-quality-0506`
   - Reason: foundational categorization and review heuristics changes should land before AI/review and recurring changes are evaluated.
   - Main risk: lowering moderate low-confidence review noise can hide category uncertainty unless tests cover representative Plaid confidence levels.

5. #22 `night-review-ai-0506`
   - Reason: builds on the review workflow, adds merchant-rule context to AI suggestions, and validates accepted category IDs.
   - Main risk: confirm `merchant_rules` exists in the schema/types for deployed environments and that AI suggestion failures remain non-blocking.

6. #39 `night-recurring-automation-0506`
   - Reason: recurring detector behavior is finance-sensitive and should be reviewed after data-quality heuristics.
   - Main risk: new biweekly/quarterly cadence support and inactive filtering can change what users see as recurring; confirm existing dismissed/paused records still behave as intended.

7. #38 `night-spending-insights-0506`
   - Reason: largest generated insight surface and depends most on trusted categorization/review state.
   - Main risk: dashboard insight priority may shift because generated spending cards are inserted before sync/balance/recent-transaction cards and the final list is limited.

## PR-Specific Reviewer Checklist

### #20 Dashboard UI

- Open `/dashboard` with enough trend points to render the SVG.
- Check chart width, axis labels, inspector text, and hover/focus points at mobile, tablet, and wide desktop widths.
- Watch for first-render chart jump from default width `720` to measured container width.

### #21 Data Quality

- Review Plaid category mappings for transport, medical, entertainment, education, services, bank fees, and government/non-profit.
- Confirm low-confidence heuristics still flag genuinely unknown categories while avoiding duplicate noise.
- Confirm recurring charges over the large-spend threshold no longer create unnecessary `large` review items.

### #22 Review AI

- Confirm `listMerchantRules` is backed by current generated DB types and migrations.
- Verify accepted AI suggestions cannot write a stale or nonexistent `categoryId`.
- Review mock/provider tests for malformed AI payloads and merchant-rule context.

### #23 CI Hardening

- Review whether adding Playwright browser installation to default CI is acceptable for runtime and dependency footprint.
- Confirm `ENABLE_DEMO_MODE=true` is appropriate for CI smoke tests.
- Confirm `npm test` remains the expected local combined command after introducing `npm run test:unit`.

### #24 Roadmap

- Check roadmap priorities against current product intent.
- Verify no stale planning promises or private details are included.

### #39 Recurring Automation

- Confirm biweekly and quarterly cadence thresholds are correct enough for real bank posting variance.
- Check inactive candidate filtering so old subscriptions do not disappear when the user expects to review them.
- Validate recurring page summary no longer needs the removed `transactions` prop.

### #38 Spending Insights

- Confirm spending windows use the intended `asOfDate`; current implementation uses wall-clock `now`, not latest transaction date, from the dashboard.
- Check sign conventions for income, spending, net cashflow, splits, and transfer exclusion.
- Review dashboard card ordering because spending cards may crowd out sync or balance-trend insight cards under the default limit.

## Local Verification Performed

- `git status --short --branch`
- `git branch -r --sort=-committerdate`
- `git diff --name-status origin/main...<branch>` for all seven local refs
- `git diff --stat origin/main...<branch>` for all seven local refs
- `git merge-tree` individual checks for all seven local refs
- `git merge-tree` pairwise checks across the seven local refs

No application tests were run for the branch PRs because this task was an integration audit and the code PRs were not merged locally. After this guide was added, only docs-oriented validation is needed for this audit branch.

