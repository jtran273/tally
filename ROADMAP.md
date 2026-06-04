# Tally Roadmap

Reflects the current codebase as of 2026-06-04. The active backlog contains only work that still needs product or engineering effort; shipped items are listed in the recap so they aren't re-discussed.

## Active Backlog

### Credit Optimization v1 (epic: #224)

Tally already imports Plaid liabilities data and shows a credit-card action panel; the next layer is making the optimization timing, confidence, and copy honest.

- **#226 — Reported-balance optimizer MVP** (P1). Separate due-date safety from statement-close optimization. Surface aggregate + per-card utilization, the payment needed to land under 30 % / 10 %, and a recommended pay-by date with a processing buffer.
- **#227 — Statement-close confidence and source labels** (P1). Label every recommendation with the source of the date: actual Plaid liability, inferred cycle, stale, or unknown.
- **#228 — OpenClaw sparse credit utilization nudges** (P2). Pre-statement-close nudges through OpenClaw so the user isn't dependent on opening the dashboard at the right moment.
- **#231 — Account lifecycle lite** (P2). Guardrails for new/closed cards, annual-fee surfacing, and intent capture before any score-impact simulation.

See `docs/credit-card-optimization-product-plan.md` for the full product read.

### Reliability and operations

- **#236 — Apply production Supabase finance migrations and verify Plaid sync** (P1). Hardening code is merged; production sync can still fail until migrations are applied and verified end-to-end.
- **#112 — Verify Google Calendar production OAuth and planning signals** (P2). The connector works locally; production verification with a real account is pending.

### Agents and AI quality

- **#111 — Operationalize LLM reimbursement candidate proposals** (P1). The code path exists (heuristic prefilter, mock/OpenAI provider, dedup, scheduled scan); needs a measured rollout strategy and quality gates.
- **#138 — Make reimbursements first-class beyond reporting** (P2). Schema and link panel exist; full lifecycle (expected, requested, received, written-off) is open.

## Recently Shipped

### Repo + runtime security (PR #235, #237)
Branch protection, CodeQL `security-and-quality`, dependency-review fail-on-moderate, OpenSSF Scorecard, gitleaks, actionlint, gitleaks push protection, `npm ci --ignore-scripts`, all GH Actions SHA-pinned. Middleware default-deny per-route allowlist with `%2f` rejection. Demo cookie `SameSite=strict`. Server actions constrained via `experimental.serverActions.allowedOrigins`. `X-Powered-By` disabled. Cron handlers no longer alias `GET = POST`. Extended `logSafeError` redaction (JWT, Google OAuth, Anthropic, GitHub, AWS).

### Dashboard and review
Trusted vs unresolved spending split (#142, closed-out via #133); category trend rows deep-link to `/transactions?review=open` (#151); cashflow runway card (#143); AI suggestion quality panel on Review (#144); `/audit` reporting UI with pagination + text search (#140, #150); agent inbox proposals link to their audit history (#155); merchant rule provenance enum (#145); resolution_kind enum (#146); weekly review digest (#152); named saved transaction filter views (#153); audit cross-links on review/transaction pages (#154); dashboard typography hardening (#149, #156).

### Plaid + data reliability
Pending-to-posted reconciliation tracking (#137 / commit `94e14da`); persisted anomaly alerts for OpenClaw (#198 / commit `0bdcf18`); scheduled sync route guarded by `CRON_SECRET`; Plaid Link repair via update mode; one-item follow-up sync.

### Earlier (pre-2026-05)
Settings simplified to bank-connections + access. Review reasons for p2p/large/transfer-pair/new-recurring/low-confidence/missing-category/unclear-transfer/recurring-candidate, with seeded demo cases. Single-item AI suggestions, accept/dismiss, inline review edits, p2p split resolution. Merchant rules saved from accepted AI cleanup + inline edits, applied during Plaid enrichment. Transaction filters (month, range, account, category, intent, review state/reason, quality, row limit, transfer exclusion), CSV export, merchant cleanup using active filters. Dashboard balance scopes (net worth, cash, liabilities, cash − liabilities) with selectable trend ranges. Recurring detection, tracked recurring rows, next-30-day cashflow timeline. Proposal-only finance action manifest with derived agent inbox.

## Labels

- `priority:p0`, `priority:p1`, `priority:p2`
- `area:dashboard`, `area:review`, `area:ai`, `area:plaid`, `area:data`, `area:agents`, `area:operations`
- `area:transactions`, `area:accounts`, `area:reimbursements`, `area:mobile`

## Milestones

- `Credit Optimization v1` — #224, #226, #227, #228, #231
- `Plaid/Data Reliability` — #236
- `AI Review Automation` — #111
- `OpenClaw Agent Integration` — #112
- `Spending Intelligence` — #138
