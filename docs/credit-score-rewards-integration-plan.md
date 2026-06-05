# Credit Score and Rewards Integration Plan

Date: 2026-06-05

This slice answers two product questions:

1. Can Tally show an in-app credit score with trend and improvement guidance?
2. Can Plaid pull card benefits, cashback, points, or unused benefits?

The short answer: Tally can ship grounded credit-health guidance now from connected account and liabilities data, but it should not claim a live bureau score or live rewards inventory until a real provider is added and reviewed.

## Current Grounding

The Credit Optimization v1 deck is mostly shipped:

- #224, "Design credit health and utilization optimizer" - closed.
- #225, "Document credit card optimization product plan" - merged.
- #226, "Reported-balance optimizer MVP" - closed.
- #227, "Statement-close confidence and source labels" - closed.
- #228, "OpenClaw sparse credit utilization nudges" - closed.
- #231, "Account lifecycle lite" - closed.
- #236, "Apply production Supabase finance migrations and verify Plaid sync" - still open and production-blocking for end-to-end confidence.

Existing code already imports and uses Plaid Liabilities for:

- credit limit
- last statement issue date
- last statement balance
- next payment due date
- minimum payment amount

Existing dashboard and OpenClaw surfaces already provide conservative guidance around payment-history safety, utilization, statement timing, and pre-close payments.

## Plaid Capability Read

### Liabilities

Official Plaid Liabilities docs say the product can return credit-card debt data, including balance, next payment date/amount, statement data, and APR information. The installed `plaid@42.2.0` SDK confirms `CreditCardLiability` includes:

- `aprs`
- `is_overdue`
- `last_payment_amount`
- `last_payment_date`
- `last_statement_issue_date`
- `last_statement_balance`
- `minimum_payment_amount`
- `next_payment_due_date`

Tally currently persists only the statement/due/minimum fields from that object. APR import is possible from current SDK types, but it requires a separate data-model slice and coverage handling because Plaid notes APR availability varies by issuer.

Sources:

- https://plaid.com/docs/liabilities/
- https://plaid.com/docs/api/products/liabilities/

### Credit Score

Plaid Check includes LendScore and CRA product types in the current docs and SDK. This is not a consumer credit-score widget for a personal finance dashboard:

- LendScore is a 1-99 credit risk score from banking/network data.
- It is positioned for lending/consumer-report use cases.
- It requires separate Plaid Check setup, user identity/report lifecycle, permissible-purpose handling, and likely compliance review.

Therefore, this repo should not add a live Plaid credit-score integration in this slice. A safe first version can support:

- manual score snapshots entered by the user
- issuer or bureau source labels
- score model labels such as FICO, VantageScore, or unknown
- trend from snapshots
- utilization/payment guidance from existing connected account data

Sources:

- https://plaid.com/docs/check/
- https://plaid.com/docs/api/products/check/
- https://plaid.com/check/lendscore/

### Rewards, Benefits, Cashback, and Points

I did not find a general Plaid endpoint in the current docs or installed SDK that returns issuer card benefits, unused credits, cashback balances, points balances, miles balances, redemption values, or card-specific reward multipliers for connected credit cards.

Plaid does document a Cardlytics Transactions partner flow for personalized cashback offers. That is a separate partner integration using processor tokens and Cardlytics access, not the same as Plaid returning James's issuer rewards balances or unused benefits.

Therefore, Tally should treat rewards/benefits as unavailable from the current production Plaid integration. The app may use transactions for rough spend-category analysis only if the UI says the result is estimated and not exact reward earnings.

Sources:

- https://plaid.com/docs/transactions/partnerships/
- https://plaid.com/docs/transactions/partnerships/cardlytics/

## Implemented In This Slice

Added `src/lib/finance/credit-health.ts`:

- `CreditScoreSnapshotInput` for manual or demo score snapshots.
- `buildCreditScoreSummary()` for current score, delta, trend, and source copy.
- `buildCreditHealthSummary()` for grounded guidance from existing liabilities:
  - payment-history safety
  - utilization tier/action framing
  - statement timing source coverage
- `assessRewardsBenefitsCapability()` for explicit current-capability output:
  - what Tally can analyze now
  - what is unsupported now
  - what a future partner/provider review would need

This first planning slice was deliberately domain-only. It did not add a database table, Plaid API call, or visible score UI that could imply live provider data.

## Manual Credit Health MVP

The next safe MVP adds a persisted manual score surface without adding live bureau or rewards providers:

- `credit_score_snapshots` stores user-entered score, source, model, and as-of date.
- `/credit-health` shows the current manually entered score, source, model, trend, and recent history.
- The page uses existing connected-account liabilities for payment-history, utilization, and statement-timing guidance.
- The page labels that Tally is not connected to a live credit bureau score provider.
- Rewards and benefits remain explicit unsupported/deferred data: no points, cashback, miles, reward multipliers, or unused-benefits detection is inferred from Plaid.

## Product UI Recommendation

When a `/credit-health` page is built, the first viewport should have three compact surfaces:

- Score: "Not connected" until manual snapshots exist. If manual snapshots exist, show score, source, model, as-of date, and trend.
- Utilization: aggregate utilization, highest-card utilization, and the existing best next payment action.
- Data sources: connected account data, Plaid liabilities timing confidence, and missing data.

Use copy like:

- "Score is manually entered from an issuer or bureau source."
- "Tally is not connected to a live credit bureau score provider."
- "This may help reported utilization; it is not a credit-score prediction."
- "Rewards and benefits are not available from the current Plaid integration."

Avoid:

- "Plaid score"
- "Live FICO from Plaid"
- "Earned points"
- "Unused benefits detected"
- "This payment will raise your score"

## Future Slices

1. APR persistence from Plaid Liabilities, guarded by source/coverage labels.
2. Manual card-benefit inventory for known credits and annual fees.
3. Optional partner evaluation for rewards offers, with processor-token isolation and separate consent review.

## Blockers

- No live consumer credit score provider is configured.
- Plaid Check/LendScore is not a drop-in PFM score product and needs compliance review before use.
- Current Plaid integration does not expose card rewards balances, points, cashback balances, or unused benefits.
- #236 production migration/sync verification remains open, so production confidence depends on schema and Plaid sync verification.
