/**
 * Merge re-linked duplicate Plaid accounts.
 *
 * When a user re-links a card through Plaid Link (instead of update mode), Plaid
 * creates a brand-new item + account rows and the previous item is revoked. The
 * old account keeps all of the transaction/snapshot history, but every analytics
 * surface (dashboard, net worth, spending-by-category) hides revoked-item
 * accounts. The result: the user's history "disappears" even though it is still
 * in the database.
 *
 * This script finds identity groups — accounts that share
 * (institution, type, mask, normalized name) where exactly one account lives on a
 * non-revoked Plaid item — and merges every revoked duplicate into that survivor:
 *
 *   - enriched_transactions + their raw_transactions are repointed to the
 *     survivor (account_id, and plaid_item_id on the raw), deduped against the
 *     survivor by (date | amount | merchant_name) using max-multiset semantics so
 *     genuine same-day/same-amount repeats are preserved while re-link copies are
 *     dropped.
 *   - balance_snapshots are repointed, deduped by snapshot_date.
 *   - the now-empty revoked accounts (and any orphaned revoked items) are deleted,
 *     letting ON DELETE CASCADE clean up the dropped duplicates.
 *
 * Splits, review_items and reimbursement_records reference the enriched
 * transaction id (which never changes for kept rows), so they follow
 * automatically.
 *
 * Usage:
 *   npx tsx scripts/merge-relinked-accounts.ts --email user@example.com           # dry run
 *   npx tsx scripts/merge-relinked-accounts.ts --email user@example.com --execute # apply
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

interface AccountRow {
  id: string;
  name: string | null;
  type: string;
  mask: string | null;
  institution_id: string;
  plaid_item_id: string;
  current_balance: number | null;
}

interface EnrichedRow {
  id: string;
  account_id: string;
  raw_transaction_id: string;
  date: string;
  amount: number;
  merchant_name: string | null;
}

interface SnapshotRow {
  id: string;
  account_id: string;
  snapshot_date: string;
}

function loadEnv() {
  const file = path.resolve(process.cwd(), ".env.local");
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i === -1) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

const normalize = (value: string | null) =>
  (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const txnKey = (t: EnrichedRow) =>
  `${t.date}|${t.amount}|${(t.merchant_name ?? "").toLowerCase()}`;
const multiset = (rows: EnrichedRow[]) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(txnKey(r), (m.get(txnKey(r)) ?? 0) + 1);
  return m;
};

async function expect<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, ctx: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${ctx}: ${error.message}`);
  return data as T;
}

async function main() {
  const email = arg("--email");
  const execute = process.argv.includes("--execute");
  if (!email) throw new Error("Pass --email <user email>");

  const env = loadEnv();
  const sb: SupabaseClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: usersData } = await sb.auth.admin.listUsers();
  const user = usersData.users.find((u) => u.email === email);
  if (!user) throw new Error(`No user with email ${email}`);
  const uid = user.id;

  const accounts = await expect<AccountRow[]>(
    sb.from("accounts").select("id,name,type,mask,institution_id,plaid_item_id,current_balance").eq("user_id", uid),
    "load accounts"
  );
  const items = await expect<Array<{ id: string; status: string }>>(
    sb.from("plaid_items").select("id,status").eq("user_id", uid),
    "load items"
  );
  const itemStatus = new Map(items.map((i) => [i.id, i.status]));
  const isRevoked = (a: AccountRow) => itemStatus.get(a.plaid_item_id) === "revoked";

  // Build identity groups.
  const groups = new Map<string, AccountRow[]>();
  for (const a of accounts) {
    const key = `${a.institution_id}|${a.type}|${a.mask}|${normalize(a.name)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }

  const plan: Array<{
    label: string;
    target: AccountRow;
    sources: AccountRow[];
    keepEnrichedIds: string[];
    dropEnrichedIds: string[];
    dropCount: number;
    moveSnapshotCount: number;
  }> = [];

  const enrichedByAccount = new Map<string, EnrichedRow[]>();
  const snapshotsByAccount = new Map<string, SnapshotRow[]>();

  async function loadEnriched(accountId: string) {
    if (!enrichedByAccount.has(accountId)) {
      enrichedByAccount.set(
        accountId,
        await expect<EnrichedRow[]>(
          sb.from("enriched_transactions").select("id,account_id,raw_transaction_id,date,amount,merchant_name").eq("user_id", uid).eq("account_id", accountId),
          "load enriched"
        )
      );
    }
    return enrichedByAccount.get(accountId)!;
  }
  async function loadSnapshots(accountId: string) {
    if (!snapshotsByAccount.has(accountId)) {
      snapshotsByAccount.set(
        accountId,
        await expect<SnapshotRow[]>(
          sb.from("balance_snapshots").select("id,account_id,snapshot_date").eq("user_id", uid).eq("account_id", accountId),
          "load snapshots"
        )
      );
    }
    return snapshotsByAccount.get(accountId)!;
  }

  for (const [, group] of groups) {
    const actives = group.filter((a) => !isRevoked(a));
    const revoked = group.filter(isRevoked);
    if (revoked.length === 0) continue; // nothing to merge
    if (actives.length !== 1) {
      if (group.length > 1) {
        console.log(`SKIP group ${group[0].type}/${group[0].mask}/${group[0].name}: ${actives.length} active-item accounts (expected exactly 1).`);
      }
      continue;
    }
    const target = actives[0];

    // Dedup: max-multiset across the whole group, survivor = target.
    const targetRows = await loadEnriched(target.id);
    const perAccount: Array<{ acct: AccountRow; rows: EnrichedRow[]; ms: Map<string, number> }> = [];
    for (const r of revoked) {
      const rows = await loadEnriched(r.id);
      perAccount.push({ acct: r, rows, ms: multiset(rows) });
    }
    const targetMs = multiset(targetRows);
    const desired = new Map<string, number>(targetMs);
    for (const { ms } of perAccount) {
      for (const [k, c] of ms) desired.set(k, Math.max(desired.get(k) ?? 0, c));
    }

    const kept = new Map<string, number>(targetMs); // already covered by survivor
    const keepEnrichedIds: string[] = [];
    let dropCount = 0;
    // Prefer sources with the widest history first (earliest min date).
    perAccount.sort((a, b) => {
      const am = a.rows.reduce((min, r) => (r.date < min ? r.date : min), "9999");
      const bm = b.rows.reduce((min, r) => (r.date < min ? r.date : min), "9999");
      return am.localeCompare(bm);
    });
    for (const { rows } of perAccount) {
      for (const r of rows) {
        const k = txnKey(r);
        const have = kept.get(k) ?? 0;
        if (have < (desired.get(k) ?? 0)) {
          kept.set(k, have + 1);
          keepEnrichedIds.push(r.id);
        } else {
          dropCount += 1;
        }
      }
    }

    // Snapshots to move: source snapshot dates not already on the target.
    const targetDates = new Set((await loadSnapshots(target.id)).map((s) => s.snapshot_date));
    let moveSnapshotCount = 0;
    for (const r of revoked) {
      for (const s of await loadSnapshots(r.id)) {
        if (!targetDates.has(s.snapshot_date)) {
          targetDates.add(s.snapshot_date);
          moveSnapshotCount += 1;
        }
      }
    }

    const keepSet = new Set(keepEnrichedIds);
    const dropEnrichedIds = perAccount
      .flatMap(({ rows }) => rows)
      .filter((r) => !keepSet.has(r.id))
      .map((r) => r.id);

    plan.push({
      label: `${target.type} ${target.name} (mask ${target.mask})`,
      target,
      sources: revoked,
      keepEnrichedIds,
      dropEnrichedIds,
      dropCount,
      moveSnapshotCount
    });
  }

  if (plan.length === 0) {
    console.log("No re-linked duplicate accounts found. Nothing to do.");
    return;
  }

  console.log(`\n=== Merge plan for ${email} (${execute ? "EXECUTE" : "DRY RUN"}) ===\n`);
  for (const p of plan) {
    console.log(`• ${p.label}`);
    console.log(`    survivor: ${p.target.id}`);
    console.log(`    merging from: ${p.sources.map((s) => s.id.slice(0, 8)).join(", ")}`);
    console.log(`    transactions moved: ${p.keepEnrichedIds.length} | duplicates dropped: ${p.dropCount} | snapshots moved: ${p.moveSnapshotCount}`);
  }

  if (!execute) {
    console.log("\nDry run only. Re-run with --execute to apply.\n");
    return;
  }

  // Backup every row we are about to touch or cascade-delete.
  const sourceIds = plan.flatMap((p) => p.sources.map((s) => s.id));
  const backup = {
    generatedAt: new Date().toISOString(),
    email,
    accounts: accounts.filter((a) => sourceIds.includes(a.id)),
    enriched: await expect(sb.from("enriched_transactions").select("*").eq("user_id", uid).in("account_id", sourceIds), "backup enriched"),
    raw: await expect(sb.from("raw_transactions").select("*").eq("user_id", uid).in("account_id", sourceIds), "backup raw"),
    snapshots: await expect(sb.from("balance_snapshots").select("*").eq("user_id", uid).in("account_id", sourceIds), "backup snapshots"),
    recurringExpenses: await expect(sb.from("recurring_expenses").select("*").in("account_id", sourceIds), "backup recurring expenses"),
    plaidItems: items.filter((item) => plan.some((p) => p.sources.some((source) => source.plaid_item_id === item.id)))
  };
  const backupPath = path.resolve(process.cwd(), `tmp/merge-backup-${uid}-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBackup written to ${backupPath}`);

  for (const p of plan) {
    const keepSet = new Set(p.keepEnrichedIds);
    // 1. Move kept enriched + their raws to the survivor (must happen before
    //    deleting the source account so cascade does not remove them).
    const keepEnriched = p.sources
      .flatMap((s) => enrichedByAccount.get(s.id) ?? [])
      .filter((r) => keepSet.has(r.id));
    for (const r of keepEnriched) {
      await expect(sb.from("enriched_transactions").update({ account_id: p.target.id }).eq("id", r.id).eq("user_id", uid).select("id"), "move enriched");
      await expect(sb.from("raw_transactions").update({ account_id: p.target.id, plaid_item_id: p.target.plaid_item_id }).eq("id", r.raw_transaction_id).eq("user_id", uid).select("id"), "move raw");
    }
    // 2. Move deduped snapshots to the survivor.
    const targetDates = new Set((snapshotsByAccount.get(p.target.id) ?? []).map((s) => s.snapshot_date));
    for (const s of p.sources.flatMap((src) => snapshotsByAccount.get(src.id) ?? [])) {
      if (targetDates.has(s.snapshot_date)) continue;
      targetDates.add(s.snapshot_date);
      await expect(sb.from("balance_snapshots").update({ account_id: p.target.id }).eq("id", s.id).eq("user_id", uid).select("id"), "move snapshot");
    }
    // 3. Repoint recurring_expenses off the source accounts (non-cascade FK):
    //    move account_id to the survivor, and null last_transaction_id when it
    //    points at a duplicate that is about to be cascade-deleted.
    for (const s of p.sources) {
      await expect(sb.from("recurring_expenses").update({ account_id: p.target.id }).eq("account_id", s.id).eq("user_id", uid).select("id"), "repoint recurring account");
    }
    if (p.dropEnrichedIds.length > 0) {
      await expect(sb.from("recurring_expenses").update({ last_transaction_id: null }).in("last_transaction_id", p.dropEnrichedIds).eq("user_id", uid).select("id"), "clear recurring last_transaction");
    }
    // 4. Delete the now-stripped source accounts; cascade clears dropped dups.
    for (const s of p.sources) {
      await expect(sb.from("accounts").delete().eq("id", s.id).eq("user_id", uid).select("id"), "delete source account");
    }
    console.log(`✓ merged ${p.label}`);
  }

  // 5. Delete revoked Plaid items that no longer have any accounts.
  const remaining = await expect<Array<{ plaid_item_id: string }>>(
    sb.from("accounts").select("plaid_item_id").eq("user_id", uid),
    "reload accounts"
  );
  const referenced = new Set(remaining.map((a) => a.plaid_item_id));
  for (const item of items) {
    if (item.status === "revoked" && !referenced.has(item.id)) {
      await expect(sb.from("plaid_items").delete().eq("id", item.id).eq("user_id", uid).select("id"), "delete orphan item");
      console.log(`✓ removed orphaned revoked item ${item.id.slice(0, 8)}`);
    }
  }

  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
