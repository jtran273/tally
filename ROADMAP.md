# Ledger Roadmap

This roadmap turns the current Personal Finance OS codebase into an issue-ready backlog. It is grouped by product milestone and written so each item can become one GitHub issue without further discovery.

Live GitHub issue and PR inspection was attempted from this workspace, but both local `gh` and the installed GitHub connector could not access `jtran273/personal-finance-os`. Before creating these issues in GitHub, re-run an open issue search to avoid duplicates.

## Milestone: MVP Polish

### 1. Tighten the dashboard around trusted vs unresolved spending

**Priority:** P0

**Why:** The dashboard already combines balances, spending summaries, review counts, recurring context, and generated insights. The next polish step is making it immediately clear which numbers are trusted and which still depend on review.

**Acceptance criteria:**

- Dashboard spending totals explicitly separate trusted spending from unresolved review spending.
- Review-sensitive insights show a visible unresolved state when open review items affect the calculation.
- Recent transactions and insight links preserve the filters needed to explain the displayed totals.
- Empty, unauthenticated, unconfigured, and Plaid-error states remain readable on desktop and mobile.

**Implementation notes:**

- Start in `src/components/finance/dashboard/dashboard-view.tsx`, `src/lib/finance/spending.ts`, and `src/lib/insights/generator.ts`.
- Reuse existing review totals from `ReviewQueueView` where possible instead of inventing a second spending definition.
- Add focused tests around spending aggregation for open-review transactions and split transactions.

### 2. Add a first-run checklist in Settings

**Priority:** P1

**Why:** Settings exposes Plaid, review guardrails, and provider status, but a single-user app still needs an obvious path from blank workspace to useful ledger.

**Acceptance criteria:**

- Settings shows setup progress for Supabase sign-in, Plaid connection, first successful sync, open review queue, recurring confirmation, and AI provider state.
- Each checklist row links directly to the route/action that completes it.
- The checklist distinguishes optional AI setup from required finance data setup.
- Demo mode and production mode render appropriate copy without exposing secrets.

**Implementation notes:**

- Extend `src/components/finance/settings/settings-view.tsx` using existing props before adding new queries.
- Reuse `PlaidConnectionPanel` state where possible.
- Add a small test for checklist state derivation if the logic grows beyond render-only branching.

## Milestone: AI Review Automation

### 3. Turn accepted AI cleanup into reusable merchant rules

**Priority:** P0

**Why:** The schema already includes `merchant_rules`, and AI suggestions remain human-approved. Capturing accepted decisions as rules is the strongest way to reduce repeated review work while keeping James in control.

**Acceptance criteria:**

- Accepting a non-peer-to-peer AI suggestion can create or update a merchant rule based on the normalized merchant/category/intent/recurring decision.
- Future Plaid imports apply enabled merchant rules before falling back to Plaid/default enrichment.
- Rule-created enrichments record `source = 'rule'` and still create review items when confidence or policy requires review.
- The audit log records whether a merchant rule was created, updated, or applied.

**Implementation notes:**

- Build on `acceptReviewSuggestionAction` in `src/components/finance/review/actions.ts`.
- Apply rules in `buildEnrichedTransactionInsert`/`seedEnrichedTransactions` in `src/lib/plaid/service.ts`.
- Add query helpers for merchant rules in `src/lib/db/queries.ts`.
- Include tests for rule priority, amount bounds, disabled rules, and manual override preservation.

### 4. Add bulk review actions with per-item preview

**Priority:** P1

**Why:** `generateAiReviewSuggestionsAction` can store suggestions for many review items, but acceptance still appears item-by-item. Bulk accept should be fast but never opaque.

**Acceptance criteria:**

- Review queue has a bulk mode for AI-eligible items with accept-ready suggestions.
- The user can preview proposed merchant, category, intent, recurring, and confidence changes before applying.
- Bulk apply skips peer-to-peer items and any item whose suggestion is missing or stale.
- Results summarize accepted, skipped, and failed items with no partial UI ambiguity.

**Implementation notes:**

- Work in `src/components/finance/review/review-queue-view.tsx`, `review-ai-actions.tsx`, and `actions.ts`.
- Reuse `buildAcceptedReviewSuggestionPatch` for each row.
- Add transactional behavior where Supabase support allows; otherwise make each item auditable and retry-safe.

### 5. Track AI suggestion quality and review savings

**Priority:** P2

**Why:** AI should reduce review work over time. The app needs basic product telemetry in its own database, not external analytics, to show whether suggestions are trusted.

**Acceptance criteria:**

- Accepted, dismissed, and manually edited AI-suggested review items can be counted by reason, category, merchant, and provider.
- Settings or Review shows a compact quality summary: suggestions accepted, suggestions dismissed, and estimated repeated reviews avoided by rules.
- Metrics never include raw Plaid payloads, secrets, or account identifiers.
- Tests cover metric derivation from audit events or a new user-owned summary table.

**Implementation notes:**

- Prefer deriving from `audit_events` first; add a new table only if queries become awkward.
- Keep provider metadata at descriptor/version level from `src/lib/ai/types.ts`.
- Do not add third-party analytics for this issue.

## Milestone: Spending Intelligence

### 6. Add category and merchant spending trends

**Priority:** P0

**Why:** James wants the dashboard to clearly show spending. Current spending logic is trustworthy but thin; trend views should explain where cash is going and what changed.

**Acceptance criteria:**

- Dashboard shows top categories and merchants for the selected period.
- Trends exclude transfers and distinguish open-review amounts from trusted spend.
- Users can click a category or merchant to open matching transactions.
- Tests cover spending totals with splits, shared/reimbursable intents, and open review items.

**Implementation notes:**

- Extend `src/lib/finance/spending.ts` with reusable aggregation helpers.
- Use existing transaction filters in `src/components/finance/transactions/filters.ts`.
- Keep charting lightweight; an accessible table or simple bars are enough for the first pass.

### 7. Add monthly cashflow and recurring runway

**Priority:** P1

**Why:** Recurring detection exists, but the dashboard should translate confirmed recurring costs into a practical monthly view.

**Acceptance criteria:**

- Dashboard shows income, spending, net cashflow, and confirmed recurring monthly load for the current and previous months.
- Pending recurring candidates are shown separately and do not inflate confirmed fixed costs.
- Recurring price changes appear as actionable insights with links to evidence transactions.
- Calculations handle partial months and accounts with stale sync state.

**Implementation notes:**

- Combine `src/lib/recurring/detector.ts`, `src/lib/insights/generator.ts`, and spending helpers.
- Use `recurring_expenses.status` to separate active, pending, paused, and dismissed items.
- Add fixtures for annual, quarterly, monthly, and price-change recurring rows.

### 8. Make reimbursements first-class in review and reporting

**Priority:** P2

**Why:** The schema includes `reimbursement_records`, and peer-to-peer/shared transactions are a core ambiguity. Reporting should know when money is expected back.

**Acceptance criteria:**

- Peer-to-peer split resolution can mark a split as reimbursable and create a reimbursement record.
- Transactions and dashboard summaries show expected/requested/received reimbursement totals.
- Received reimbursements can be linked back to the original split or marked written off.
- Spending totals can show gross spend and net-after-reimbursement views.

**Implementation notes:**

- Extend `PeerToPeerSplitForm` and `resolvePeerToPeerReviewAction`.
- Add query helpers and records for `reimbursement_records`.
- Keep the first version manual; automatic matching can be a later issue.

## Milestone: Plaid/Data Reliability

### 9. Add Plaid item repair and relink flow

**Priority:** P0

**Why:** Sync errors are persisted, but a user needs a clear recovery path for expired consent, item login required, and revoked/error states.

**Acceptance criteria:**

- Settings shows connection-specific repair actions for common Plaid item errors.
- The app can start Plaid Link update mode for an existing item when Plaid requires relink.
- Successful repair clears the persisted error and syncs the repaired item.
- Error copy remains safe and does not expose access tokens, raw secrets, or unsafe provider details.

**Implementation notes:**

- Extend `src/lib/plaid/service.ts`, `src/app/api/plaid/link-token/route.ts`, and `PlaidConnectionPanel`.
- Use Plaid update-mode link token support for existing access tokens.
- Add route/helper tests for item states and safe error mapping.

### 10. Harden pending-to-posted transaction handling

**Priority:** P1

**Why:** Plaid sync currently upserts by Plaid transaction id and deletes removed ids. Pending replacement edge cases can still affect duplicate review work and trusted totals.

**Acceptance criteria:**

- Pending transactions that become posted are reconciled so enriched records, review items, and splits do not duplicate.
- Removed pending rows are preserved or audited enough to explain why a visible transaction disappeared.
- Sync summary reports pending replacements separately from ordinary added/modified/removed counts.
- Tests cover pending id replacement, modified transaction amount/category changes, and existing manual enrichment preservation.

**Implementation notes:**

- Focus on `upsertRawTransactions`, `deleteRemovedTransactions`, and `seedEnrichedTransactions` in `src/lib/plaid/service.ts`.
- Use `pending_transaction_id` and raw/enriched unique constraints carefully.
- Preserve user-reviewed/manual rows unless the user explicitly reopens review.

### 11. Add sync observability and scheduled sync readiness

**Priority:** P2

**Why:** Manual sync works, but future automation and agents need reliable status, last run details, and safe retry behavior.

**Acceptance criteria:**

- Persist per-run sync summaries with start time, finish time, item counts, success/failure status, and safe error codes.
- Settings exposes the latest sync run and per-item status.
- A server route or job-safe function can sync one item without browser coupling.
- Documentation explains how to wire scheduled sync in Vercel or another runner.

**Implementation notes:**

- Consider a `sync_runs` table with `user_id`, `plaid_item_id`, counts, status, and safe error fields.
- Keep current `/api/plaid/sync` behavior but make the core sync callable by scheduled jobs.
- Update `OPERATIONS.md` after implementation.

## Milestone: OpenClaw Agent Integration

### 12. Add an agent-safe finance action manifest

**Priority:** P0

**Why:** James eventually wants OpenClaw/agent workflows. The app needs a narrow contract that lets agents propose work without bypassing user approval.

**Acceptance criteria:**

- The repo defines an agent action manifest for read-only summaries and proposal-only mutations.
- Supported actions include review queue summary, spending summary, stale sync summary, and draft review suggestions.
- Any mutation-capable action returns a proposal object that requires explicit user approval in the Ledger UI.
- The manifest documents auth, user scoping, data minimization, and forbidden fields.

**Implementation notes:**

- Start with a local docs/spec file, then wire route handlers after the contract is stable.
- Use existing domain helpers in `src/lib/db`, `src/lib/finance`, `src/lib/review`, and `src/lib/insights`.
- Do not expose Plaid access tokens, Supabase service keys, raw auth headers, or full raw payloads to agents.

### 13. Create an agent inbox for proposed finance changes

**Priority:** P1

**Why:** Agent workflows need a place to land suggestions safely: merchant rules, review resolutions, recurring confirmations, and reimbursement updates should be inspectable before acceptance.

**Acceptance criteria:**

- Add a user-owned proposal store for agent-generated finance changes.
- UI lists pending proposals with evidence, affected records, confidence, and proposed patch.
- User can accept, dismiss, or edit a proposal before applying it.
- Accepted proposals reuse existing mutation paths and write audit events.

**Implementation notes:**

- Model proposals similarly to `review_items`, but keep them generic enough for transaction, recurring, and rule proposals.
- Reuse `buildUserAcceptedEnrichmentPatch`, recurring payload builders, and audit helpers.
- Start with transaction review proposals before supporting broader agent tasks.

## Suggested Labels

- `milestone:mvp-polish`
- `milestone:ai-review-automation`
- `milestone:spending-intelligence`
- `milestone:plaid-data-reliability`
- `milestone:openclaw-agent-integration`
- `priority:p0`
- `priority:p1`
- `priority:p2`
- `area:dashboard`
- `area:review`
- `area:ai`
- `area:plaid`
- `area:data`
- `area:agents`

## Suggested Milestones

- `MVP Polish`
- `AI Review Automation`
- `Spending Intelligence`
- `Plaid/Data Reliability`
- `OpenClaw Agent Integration`

