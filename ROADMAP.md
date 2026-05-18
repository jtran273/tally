# Tally Roadmap

This roadmap reflects the current codebase. The active backlog only contains work that still needs product or engineering effort; shipped items have been promoted to the recap section so they aren't re-discussed.

## Recently Shipped

- **Dashboard cashflow runway card** (PR #143): current vs previous month income/spending/net, confirmed vs pending recurring load, recurring price-change links, partial-month and stale-sync caveats.
- **AI suggestion quality panel on /review** (PR #144): acceptance rate, accepted/edited/dismissed counts by reason/category/merchant, estimated reviews avoided via AI-derived merchant rules.
- **/audit reporting UI** (PR #140, PR #150): group/date/text filters, keyset pagination, sanitized before/after summaries with redaction of tokens / raw payloads / authorization values.
- **Dashboard deep-links into open reviews** (PR #151): category trend/month rows now land on `/transactions?review=open` when a category has unresolved review impact.
- **Agent inbox audit cross-link** (PR #155): each proposal links to its transaction's audit history.
- **Dashboard typography hardening** (PR #149, PR #156): clipped balance buttons and recent-transaction links; relaxed the design-tokens overflow threshold so narrow-viewport rounding noise no longer turns CI red.

## Shipped Earlier

- Settings simplified to bank-connections + access; review reasons for p2p/large/transfer-pair/new-recurring/low-confidence/missing-category/unclear-transfer/recurring-candidate; seeded demo cases for these.
- Single-item AI suggestions, accept/dismiss, inline review edits, p2p split resolution.
- Merchant rules saved from accepted AI cleanup and from inline edits; applied during Plaid enrichment for future imports.
- Transaction filters for month, range, account, category, intent, review state, review reason, quality, row limit, transfer exclusion; CSV export and merchant cleanup using the active filters.
- Dashboard balance scopes (net worth, cash, liabilities, cash − liabilities) with selectable trend ranges; liabilities-due panel; category spending trend/month views; trusted vs open-review separation in trend rows (PR #142).
- Recurring detection, tracked recurring rows, next-30-day cashflow timeline; Plaid repair via Link update mode and one-item follow-up sync; persisted sync runs with item summaries; scheduled sync route guarded by `CRON_SECRET`.
- Proposal-only finance action manifest and derived agent inbox for sanitized review proposals.

## Active Backlog

### 1. Finish trusted vs unresolved spending in the dashboard

**Priority:** P0 (partial — tracked in issue #133)

**Status:** Trend rows split trusted vs unresolved (#142), and rows with open reviews now deep-link to `/transactions?review=open` (#151). **Remaining:**

- Dashboard balance/summary tiles (Spendable, Net worth) also separate trusted spending from unresolved review impact.
- Unit tests covering split transactions, reimbursable portions, transfers, and open review items at the summary level.
- A `/review` deep link (today only `/transactions?review=open` is supported) for users who want the queue view rather than the transaction list.

### 3. Add bulk review actions with per-item preview

**Priority:** P1

**Why:** Review suggestions can be generated and accepted one item at a time. Bulk acceptance would reduce repetitive cleanup while still requiring transparent user approval. The existing `applyAcceptedReviewSuggestion` helper already accepts a `source: "bulk" | "single"` option, so the heavy lifting is the UI and a small batching action.

**Acceptance criteria:**

- Review queue has a bulk mode for AI-eligible items with accept-ready suggestions.
- Preview current vs proposed merchant, category, intent, recurring, and confidence values before applying.
- Bulk apply skips peer-to-peer items and any stale or missing suggestions.
- Results summarize accepted, skipped, and failed items with audit events for each accepted row.

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

**Why:** The current agent inbox is derived from open review items and stored review suggestions. Broader agent workflows need a user-owned proposal store for recurring, merchant-rule, reimbursement, and review changes. (In flight under `codex/agent-proposal-store`.)

**Acceptance criteria:**

- Add a user-owned proposal table with proposal type, target records, evidence, confidence, proposed patch, and status.
- UI lists pending proposals with enough safe context for approval.
- Users can accept, dismiss, or edit a proposal before applying it.
- Accepted proposals reuse existing mutation paths and write audit events.

### Quality / follow-up debt

- **#145** — replace `merchant_rules.notes` string sniffing with a structured `source` enum (AI quality metrics currently sniff for "ai"/"auto" in notes).
- **#146** — replace `review_items.resolution_note` string sniffing with a structured `resolution_kind` enum (AI quality metrics currently look for the word "edit" in the note).
- **#152** — weekly digest surface pulling cashflow + AI quality + review + reimbursements into one view.
- **#153** — saved/bookmarked transaction filter views.
- **#154** — finish audit cross-links on the review queue and transaction detail page (agent inbox done in #155).

## Suggested Labels

- `priority:p0`, `priority:p1`, `priority:p2`
- `area:dashboard`, `area:review`, `area:ai`, `area:plaid`, `area:data`, `area:agents`, `area:operations`
- `area:transactions`, `area:accounts`, `area:reimbursements`, `area:mobile`
