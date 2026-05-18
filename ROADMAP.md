# Tally Roadmap

This roadmap reflects the current codebase after the May 2026 buildout. Earlier roadmap items that are now implemented are listed as shipped so the active backlog only contains work that still needs product or engineering effort.

## Shipped Since The Original Roadmap

- Earlier Settings setup panels were removed in favor of a minimal bank-connections and access page.
- Review reasons for peer-to-peer, large, transfer pair, new recurring, low confidence, missing category, unclear transfer, and recurring candidate.
- Seeded demo review cases for missing-category, unclear-transfer, recurring-candidate, and merchant cleanup workflows.
- Single-item AI suggestions, accept/dismiss actions, inline review edits, and peer-to-peer split resolution.
- Merchant rules saved from accepted AI cleanup, review inline edits, and transaction merchant cleanup.
- Merchant-rule application during Plaid enrichment for future imports.
- Transaction filters for month, date range, account, category, intent, review state, review reason, quality, row limit, and transfer exclusion.
- Transaction merchant cleanup and CSV export using the active filters.
- Dashboard balance scopes for net worth, cash, liabilities, and cash minus liabilities with selectable trend ranges.
- Dashboard liabilities-due panel and category spending trend/month views.
- Recurring detection, tracked recurring rows, and next-30-day cashflow timeline.
- Plaid repair flow through Link update mode and one-item follow-up sync.
- Persisted Plaid sync runs and sync-run item summaries.
- Scheduled sync route at `/api/plaid/sync/scheduled` guarded by `CRON_SECRET`.
- Proposal-only finance action manifest and derived agent inbox for sanitized review proposals.

## Active Backlog

### 1. Bring trusted vs unresolved spending into the dashboard

**Priority:** P0

**Why:** Review already separates trusted spending from unresolved review impact. The dashboard should make that distinction visible where category and balance decisions are made.

**Acceptance criteria:**

- Dashboard spending panels separate trusted spending from unresolved review spending.
- Category trend/month rows show review impact without treating open review items as final truth.
- Links from unresolved dashboard amounts open matching `/review` or `/transactions` filters.
- Unit tests cover split transactions, reimbursable portions, transfers, and open review items.

### 2. Add dashboard cashflow runway

**Priority:** P1

**Why:** The recurring page already builds an upcoming cashflow timeline. The dashboard should expose a compact cashflow view alongside balances, liabilities, and category trends.

**Acceptance criteria:**

- Dashboard shows income, spending, net cashflow, and confirmed recurring monthly load for the current and previous months.
- Pending recurring candidates are shown separately and do not inflate confirmed fixed costs.
- Recurring price changes appear as actionable insights with links to evidence transactions.
- Calculations handle partial months and accounts with stale sync state.

### 3. Add bulk review actions with per-item preview

**Priority:** P1

**Why:** Review suggestions can be generated and accepted one item at a time. Bulk acceptance would reduce repetitive cleanup while still requiring transparent user approval.

**Acceptance criteria:**

- Review queue has a bulk mode for AI-eligible items with accept-ready suggestions.
- The user can preview current versus proposed merchant, category, intent, recurring, and confidence values before applying.
- Bulk apply skips peer-to-peer items and any stale or missing suggestions.
- Results summarize accepted, skipped, and failed items with audit events for each accepted row.

### 4. Track AI suggestion quality and review savings

**Priority:** P2

**Why:** Merchant rules and AI suggestions should reduce review work over time. Tally needs first-party metrics to show whether automation is trusted.

**Acceptance criteria:**

- Accepted, dismissed, and manually edited AI-suggested review items can be counted by reason, category, merchant, and provider.
- Review shows a compact quality summary.
- Metrics include estimated repeated reviews avoided by merchant rules.
- Metrics never include raw Plaid payloads, secrets, auth headers, or account identifiers.

### 5. Harden pending-to-posted transaction handling

**Priority:** P1

**Why:** Plaid pending replacement behavior can create duplicate review work or confusing changes if pending rows become posted rows with different ids.

**Acceptance criteria:**

- Pending transactions that become posted are reconciled so enriched records, review items, and splits do not duplicate.
- Removed pending rows are preserved or audited enough to explain visible changes.
- Sync summaries report pending replacements separately from ordinary added/modified/removed counts.
- Tests cover pending id replacement, modified transaction amount/category changes, and manual enrichment preservation.

### 6. Make reimbursements first-class beyond reporting

**Priority:** P2

**Why:** Reimbursable splits and reimbursement reporting exist, but the app still needs a full lifecycle for expected, requested, received, and written-off reimbursements.

**Acceptance criteria:**

- Reimbursable split portions can create or update reimbursement records from the review workflow.
- Users can mark reimbursements requested, received, or written off.
- Received reimbursements can be linked to the original split or marked as unmatched.
- Dashboard and Transactions can switch between gross spend and net-after-reimbursement views.

### 7. Add a persistent generic agent proposal store

**Priority:** P1

**Why:** The current agent inbox is derived from open review items and stored review suggestions. Broader agent workflows need a user-owned proposal store for recurring, merchant-rule, reimbursement, and review changes.

**Acceptance criteria:**

- Add a user-owned proposal table with proposal type, target records, evidence, confidence, proposed patch, and status.
- UI lists pending proposals with enough safe context for approval.
- Users can accept, dismiss, or edit a proposal before applying it.
- Accepted proposals reuse existing mutation paths and write audit events.

### 8. Add audit reporting UI

**Priority:** P2

**Status:** Shipped. `/audit` lists recent events with group/date filters and sanitized before/after summaries. Raw Plaid payloads, tokens, and auth headers are dropped before rendering.

## Suggested Labels

- `priority:p0`
- `priority:p1`
- `priority:p2`
- `area:dashboard`
- `area:review`
- `area:ai`
- `area:plaid`
- `area:data`
- `area:agents`
- `area:security`
- `area:operations`
