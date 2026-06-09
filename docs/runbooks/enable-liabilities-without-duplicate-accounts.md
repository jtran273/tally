# Runbook: Enable credit-card due dates without creating duplicate accounts (issues #290, #303)

Plaid only returns credit-card due dates / minimums / APRs when the **Liabilities**
product is consented on the item. Items connected before Liabilities was approved
are Transactions-only, so their cards have no due date.

The wrong way to fix this is to **disconnect and re-add** the card: a full
disconnect + re-add makes Plaid mint a brand-new item with brand-new
`account_id`s, so the accounts upsert (`onConflict: user_id,plaid_account_id`)
inserts new rows. Transactions stay on the old `account_id`; liability data lands
on the new one. The result is the split/duplicate rows reported in #303.

> Do not paste real Plaid tokens, service-role keys, database URLs, or provider
> payloads into issues, PRs, or chat.

## The non-destructive path: Link update mode

`createPlaidLinkToken({ itemId })` launches Link in **update mode** against the
existing item (it reuses the stored access token instead of creating a new item).
When `PLAID_ENABLE_LIABILITIES` is on, the link token now adds Liabilities to
`additional_consented_products` — the Plaid-mandated field for granting consent
for a product on an item that already exists. After the user completes update
mode, the next sync's `liabilitiesGet` succeeds and due dates populate **on the
row that already holds the transactions**. No new item, no duplicate rows.

- We only request consent for products the item does not already have
  (`getPlaidUpdateModeConsentProducts`), so `additional_consented_products` never
  overlaps the item's existing products.
- In Settings → Bank connections, update mode runs from either the **Repair**
  button (items in an error/repair state) or the **Enable due dates** button.
  The latter appears when `PLAID_ENABLE_LIABILITIES` is on and the connection
  still has active credit-card accounts without a due date
  (`canEnableLiabilities`). The hint is account-based, so it disappears on its
  own once due dates populate.

### Steps

1. Confirm `PLAID_ENABLE_LIABILITIES=true` is set in production and the deploy is
   live (see [the Plaid sync runbook](./verify-supabase-migrations-and-plaid-sync.md)).
2. In Settings → Bank connections, click **Enable due dates** (or **Repair**) on
   the card's institution. Approve the Liabilities consent screen in Plaid Link.
3. Click **Sync**. Verify the card row now has `next_payment_due_date` /
   `minimum_payment_amount` populated and still has its transactions attached, and
   that the **Enable due dates** button has disappeared for that connection.

## Cleaning up duplicates created by earlier re-adds

If a card was already re-added the destructive way and now has split rows, do not
"keep newest / delete oldest" (destroys transaction history) or "keep oldest"
(loses liability data). Merge instead:

```bash
# Dry run first — prints the planned re-points and deletes, changes nothing.
npx tsx scripts/merge-relinked-accounts.ts --email user@example.com

# Apply after reviewing the dry-run output (irreversible financial data).
npx tsx scripts/merge-relinked-accounts.ts --email user@example.com --execute
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in
`.env.local`.

The script refuses to execute if it would drop duplicate-looking transactions by
default. If the dry run shows confirmed re-link copies that should be deleted,
re-run with `--allow-drop-duplicates`. It also refuses same-day balance snapshot
conflicts unless `--allow-snapshot-conflicts` is passed after review.

The script re-points `raw_transactions` / `enriched_transactions` /
`balance_snapshots` (and other `account_id` FKs) from the stale duplicate onto the
active newest row that carries the liability data, then deletes the empty dupes.
Run it from a trusted operator machine with the production Supabase env loaded,
and take a backup first.

## Probe queries

```text
# Duplicate detection: multiple credit rows sharing a mask
accounts?type=eq.credit&select=mask,plaid_item_id,created_at,next_payment_due_date&order=mask,created_at

# Transaction tables keyed by account_id
raw_transactions / enriched_transactions
```
