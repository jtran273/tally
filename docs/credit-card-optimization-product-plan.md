# Credit Card Optimization Product Plan

This is the repo-facing supplement for the credit-card optimization source-of-truth doc James shared on 2026-06-04. It translates the broader research into a minimal, Tally-specific roadmap.

## Product Read

Tally should not become a generic credit-score simulator. The useful wedge is narrower:

> Help James make the right card payment before the deadline that matters.

The app already has the foundation:

- Plaid liabilities fields on `accounts`: `last_statement_issue_date`, `last_statement_balance`, `next_payment_due_date`, and `minimum_payment_amount`.
- `src/lib/finance/liabilities.ts` builds due-date and utilization summaries from credit accounts, cash, and likely payment transactions.
- `src/components/finance/dashboard/dashboard-view.tsx` shows liabilities, utilization, and a credit-card action panel driven by `liabilities.ts`. (The earlier `payoff-plan.ts` cash-allocator was removed once the simplified dashboard shipped — the reported-balance optimizer below replaces that surface from scratch.)
- OpenClaw reads/outbox patterns already exist for proactive but bounded nudges.

The best next features should sharpen that existing system instead of adding a large credit-monitoring product.

## Build Principles

- Payment safety beats score optimization.
- Interest avoidance beats utilization polishing.
- Reported-balance optimization is useful only when timing confidence is clear enough.
- Show exact actions: amount, card, deadline, and reason.
- Never promise exact score movement.
- Never imply carrying interest-bearing debt is good.
- Degrade gracefully when Plaid liabilities data is missing.
- Prefer OpenClaw for rare high-value reminders; avoid noisy app notifications.

## Recommended Feature Stack

### 1. Reported-Balance Optimizer MVP

Upgrade the current payoff plan into a clearer "reported balance" action engine.

Core jobs:

- Separate due-date safety from statement-close/reporting optimization.
- Show aggregate utilization and highest individual-card utilization.
- Compute payment needed to reach 30% and 10% per card.
- Recommend a pay-by date with a processing buffer.
- Explain source confidence: actual Plaid liability date, inferred cycle, or unknown.
- Keep copy conservative: "estimated", "likely", "may help", and "not a score prediction".

Why this is first:

- It uses data Tally already imports.
- It improves the current dashboard without requiring credit bureau data.
- It is directly useful to James before large purchases, apartment checks, loan/card applications, or high reported balances.

Avoid in this phase:

- AZEO automation.
- Exact FICO/VantageScore predictions.
- New credit bureau providers.
- Automated payments.

### 2. Pre-Close Credit Nudge Through OpenClaw

Add a small OpenClaw packet only when the optimizer finds a high-confidence, high-value action.

Trigger examples:

- A card is projected above 50% utilization near statement close.
- A card can be brought under 30% with a cash-safe payment.
- Application mode is enabled and a card is above 10%.
- Due date risk exists and no likely payment is detected.

Why this is second:

- Tally already separates finance records from OpenClaw delivery.
- James prefers proactive but sparse reminders.
- The value is timing-sensitive, so a dashboard-only feature can be missed.

Guardrails:

- No raw Plaid ids, masks beyond existing safe display labels, provider payloads, or direct write authority.
- No more than one concise credit nudge per poll unless critical.
- Include a stable packet id for dedupe.

### 3. Large Purchase Planner

Add a simple scenario tool: amount, card, date, and optional target mode.

Outputs:

- Projected individual-card utilization.
- Projected aggregate utilization.
- Whether buying before or after close is safer.
- Suggested prepayment amount and deadline if cash allows.
- Warning if the chosen card would become the highest-utilization card.

Why this is third:

- It is high-value for a responsible transactor.
- It is easy to make manual-first before building forecasted spend.
- It fits Tally's planning surface without needing payment initiation.

### 4. Debt Payoff Planner, But Only After APR Data Exists

The source doc's avalanche/snowball/hybrid plan is valuable, but Tally currently lacks reliable APR fields. Do not build a fake payoff planner that assumes balances are equal-cost.

Next step:

- Add optional manual APR/promo APR fields or verify Plaid liabilities support for APR data in the current integration.
- Then implement avalanche as default, with snowball/hybrid as user-selected alternatives.

### 5. Account Lifecycle Lite

Do not build a full credit lifecycle manager yet. Start with one low-noise guardrail:

- Flag old, no-fee credit cards as "keep open unless there is a reason".
- Add an inactivity reminder only when the app has enough evidence of no usage.
- Add a closure simulator later, after account open date and annual fee are reliable.

## Defer Explicitly

- AZEO autopilot. Useful but too easy to misunderstand.
- Dispute/fraud center. Workflow-heavy and legally sensitive.
- Credit-bureau score ingestion. Provider/compliance overhead is high.
- Credit limit increase automation. Issuer rules vary and hard-pull risk is easy to mishandle.
- Full account closure simulator. Needs better account-age, annual-fee, and user-intent data.

## Issue Map

Use GitHub issue #224 as the umbrella. Recommended child issues:

1. Reported-balance optimizer MVP.
2. Statement-close confidence and source labeling.
3. OpenClaw credit utilization nudges.
4. Large purchase planner.
5. APR-aware debt payoff data foundation.
6. Account lifecycle lite.

These are intentionally small enough for separate PRs and safe Codex runs.

## Current Code References

- Domain calculations: `src/lib/finance/liabilities.ts`.
- Dashboard UI: `src/components/finance/dashboard/dashboard-view.tsx`, `src/components/finance/dashboard/dashboard.module.css`.
- Account/liability schema: `src/lib/db/types.ts`, `supabase/migrations/20260601000100_add_credit_liability_fields.sql`.
- Plaid liability import: `src/lib/plaid/service.ts`.
- OpenClaw delivery: `src/lib/openclaw/outbox.ts`, `src/lib/openclaw/signals.ts`, `src/app/api/openclaw/outbox/route.ts`.
- Safety contracts: `src/lib/agents/assistant-contract.ts`, `docs/openclaw-tally-assistant-contract.md`.

## Product Copy Rules

Use:

- "Pay $X by DATE to keep CARD under 30% utilization before it may report."
- "This estimate uses Plaid's last statement date."
- "This may help reported utilization; it is not a credit-score prediction."
- "Paying by the due date protects payment history. Paying before statement close can lower the balance that may be reported."

Avoid:

- "This will raise your score by X points."
- "Carry a balance to build credit."
- "Always use AZEO."
- "Close this card" without a simulator and safer alternatives.

## PM Recommendation

Build the reported-balance optimizer first, then OpenClaw nudges. Those two features match Tally's existing architecture, James's preference for proactive sparse reminders, and the current data model. The other ideas should stay as follow-on issues until the app has better APR, account-age, issuer-rule, and credit-report data.
