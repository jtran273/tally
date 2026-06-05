#!/usr/bin/env tsx
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequiredSupabaseConfig } from "../src/lib/supabase/env";
import type { Database } from "../src/lib/db/types";

// Read-only verifier for issue #236. Confirms the deployed Supabase schema
// includes the finance/OpenClaw hardening migrations the app expects:
//   - 20260604000100_add_anomaly_alerts.sql
//   - 20260604000200_add_plaid_pending_replacement_count.sql
//   - 20260604000300_add_review_resolution_kind.sql
//
// Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS for an accurate global check.
// It performs only SELECT / count probes and never prints secrets or row data.
// Safe to run repeatedly. Do NOT wire into CI (it needs the service-role key).

if (process.env.CI) {
  throw new Error("verify-finance-migrations must not run in CI — it needs the service-role key.");
}

const UNDEFINED_TABLE = "42P01";
const UNDEFINED_COLUMN = "42703";

interface CheckResult {
  detail: string;
  name: string;
  ok: boolean;
}

type ProbeClient = SupabaseClient<Database>;

function buildClient(): ProbeClient {
  const config = getRequiredSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY to verify the production schema.");
  }
  return createClient<Database>(config.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function classifyProbeError(name: string, code: string | undefined, message: string): CheckResult {
  if (code === UNDEFINED_TABLE) {
    return { detail: "table missing — migration not applied", name, ok: false };
  }
  if (code === UNDEFINED_COLUMN) {
    return { detail: "column missing — migration not applied", name, ok: false };
  }
  return { detail: `unexpected error ${code ?? "?"}: ${message}`, name, ok: false };
}

async function checkAnomalyAlertsTable(client: ProbeClient): Promise<CheckResult> {
  const name = "anomaly_alerts table (#20260604000100)";
  const { error } = await client.from("anomaly_alerts").select("id").limit(1);
  if (!error) return { detail: "present and selectable", name, ok: true };
  return classifyProbeError(name, error.code, error.message);
}

async function checkPlaidSyncRunsColumn(client: ProbeClient): Promise<CheckResult> {
  const name = "plaid_sync_runs.pending_transactions_replaced (#20260604000200)";
  const { error } = await client.from("plaid_sync_runs").select("pending_transactions_replaced").limit(1);
  if (!error) return { detail: "present", name, ok: true };
  return classifyProbeError(name, error.code, error.message);
}

async function checkPlaidSyncRunItemsColumn(client: ProbeClient): Promise<CheckResult> {
  const name = "plaid_sync_run_items.pending_transactions_replaced (#20260604000200)";
  const { error } = await client.from("plaid_sync_run_items").select("pending_transactions_replaced").limit(1);
  if (!error) return { detail: "present", name, ok: true };
  return classifyProbeError(name, error.code, error.message);
}

async function checkReviewResolutionKindColumn(client: ProbeClient): Promise<CheckResult> {
  const name = "review_items.resolution_kind (#20260604000300)";
  const { error } = await client.from("review_items").select("resolution_kind").limit(1);
  if (!error) return { detail: "present", name, ok: true };
  return classifyProbeError(name, error.code, error.message);
}

async function checkReviewResolutionKindBackfill(client: ProbeClient): Promise<CheckResult> {
  const name = "review_items.resolution_kind backfill (#20260604000300)";
  const { count, error } = await client
    .from("review_items")
    .select("id", { count: "exact", head: true })
    .neq("status", "open")
    .is("resolution_kind", null);
  if (error) return classifyProbeError(name, error.code, error.message);
  if ((count ?? 0) === 0) {
    return { detail: "no resolved/dismissed rows missing a resolution_kind", name, ok: true };
  }
  return { detail: `${count} resolved/dismissed rows still have a null resolution_kind`, name, ok: false };
}

async function main() {
  const client = buildClient();

  const results: CheckResult[] = [
    await checkAnomalyAlertsTable(client),
    await checkPlaidSyncRunsColumn(client),
    await checkPlaidSyncRunItemsColumn(client),
    await checkReviewResolutionKindColumn(client),
    await checkReviewResolutionKindBackfill(client)
  ];

  console.log("Finance migration verification (issue #236)\n");
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name} — ${result.detail}`);
  }

  const failed = results.filter((result) => !result.ok);
  console.log("");
  if (failed.length > 0) {
    console.log(`${failed.length} check(s) failed. Apply the listed migrations, then re-run.`);
    console.log("Note: RLS policy presence on anomaly_alerts is best confirmed with the SQL in");
    console.log("docs/runbooks/verify-supabase-migrations-and-plaid-sync.md (pg_policies query).");
    process.exit(1);
  }
  console.log("All schema checks passed. Verify the live Plaid sync per the runbook to finish #236.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
