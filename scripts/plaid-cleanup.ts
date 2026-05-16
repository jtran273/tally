#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";
import {
  describePlaidCleanupScope,
  executePlaidItemCleanup,
  getPlaidCleanupCounts,
  PLAID_CLEANUP_CONFIRMATION,
  type PlaidCleanupCounts,
  type PlaidCleanupOptions
} from "../src/lib/admin/plaid-cleanup";
import type { Database } from "../src/lib/db/types";

function readValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function parseArgs(args: string[]): PlaidCleanupOptions {
  return {
    confirm: readValue(args, "--confirm"),
    execute: args.includes("--execute"),
    institutionId: readValue(args, "--institution-id"),
    institutionName: readValue(args, "--institution-name"),
    itemId: readValue(args, "--item-id"),
    plaidInstitutionId: readValue(args, "--plaid-institution-id"),
    userId: readValue(args, "--user-id") ?? ""
  };
}

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.");
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function printCounts(label: string, counts: PlaidCleanupCounts) {
  console.log(label);
  console.table({
    accounts: counts.accounts,
    balance_snapshots: counts.balanceSnapshots,
    enriched_transactions: counts.enrichedTransactions,
    plaid_items: counts.plaidItems,
    plaid_sync_run_items: counts.plaidSyncRunItems,
    raw_transactions: counts.rawTransactions,
    reimbursement_received_refs_to_null: counts.reimbursementReceivedRefsToNull,
    reimbursement_records: counts.reimbursementRecords,
    reimbursement_split_refs_to_null: counts.reimbursementSplitRefsToNull,
    recurring_account_refs_to_null: counts.recurringAccountRefsToNull,
    recurring_last_transaction_refs_to_null: counts.recurringLastTransactionRefsToNull,
    review_items: counts.reviewItems,
    transaction_splits: counts.transactionSplits
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = getClient();

  console.log(`Scope: ${describePlaidCleanupScope(options)}`);

  if (!options.execute) {
    printCounts("Dry run: rows that would be deleted or unlinked", await getPlaidCleanupCounts(client, options));
    console.log(`No data was changed. To delete, rerun with --execute --confirm ${PLAID_CLEANUP_CONFIRMATION}.`);
    return;
  }

  const result = await executePlaidItemCleanup(client, options);
  printCounts("Before cleanup", result.before);
  printCounts("After cleanup", result.after);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

