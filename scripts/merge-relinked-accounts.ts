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
 *   npx tsx scripts/merge-relinked-accounts.ts --email user@example.com --execute --allow-drop-duplicates
 *   npx tsx scripts/merge-relinked-accounts.ts --email user@example.com --execute --allow-snapshot-conflicts
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
  category_name: string;
  intent: string;
  note: string;
  is_recurring: boolean;
  reviewed_at: string | null;
  source: string;
}

interface SnapshotRow {
  id: string;
  account_id: string;
  snapshot_date: string;
  current_balance: number;
  available_balance: number | null;
  credit_limit: number | null;
}

function loadEnv() {
  const file = path.resolve(process.cwd(), ".env.local");
  const env: Record<string, string | undefined> = { ...process.env };
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i === -1) continue;
      env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
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
const snapshotValuesEqual = (a: SnapshotRow, b: SnapshotRow) =>
  a.current_balance === b.current_balance &&
  a.available_balance === b.available_balance &&
  a.credit_limit === b.credit_limit;
const hasUserEditedEnrichment = (row: EnrichedRow) =>
  Boolean(row.reviewed_at) ||
  row.source === "manual" ||
  (row.note ?? "").trim().length > 0 ||
  row.is_recurring ||
  row.intent !== "personal" ||
  row.category_name !== "Uncategorized";
const multiset = (rows: EnrichedRow[]) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(txnKey(r), (m.get(txnKey(r)) ?? 0) + 1);
  return m;
};
const PAGE_SIZE = 1000;

async function expect<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, ctx: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${ctx}: ${error.message}`);
  return data as T;
}

async function expectPaged<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ctx: string
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await expect<T[]>(fetchPage(from, from + PAGE_SIZE - 1), ctx);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function main() {
  const email = arg("--email");
  const execute = process.argv.includes("--execute");
  const allowDropDuplicates = process.argv.includes("--allow-drop-duplicates");
  const allowSnapshotConflicts = process.argv.includes("--allow-snapshot-conflicts");
  if (!email) throw new Error("Pass --email <user email>");

  const env = loadEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
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
    protectedDropIds: string[];
    snapshotConflicts: Array<{ sourceId: string; targetId: string; snapshotDate: string }>;
  }> = [];

  const enrichedByAccount = new Map<string, EnrichedRow[]>();
  const snapshotsByAccount = new Map<string, SnapshotRow[]>();

  async function loadEnriched(accountId: string) {
    if (!enrichedByAccount.has(accountId)) {
      enrichedByAccount.set(
        accountId,
        await expectPaged<EnrichedRow>(
          (from, to) => sb.from("enriched_transactions").select("id,account_id,raw_transaction_id,date,amount,merchant_name,category_name,intent,note,is_recurring,reviewed_at,source").eq("user_id", uid).eq("account_id", accountId).range(from, to),
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
        await expectPaged<SnapshotRow>(
          (from, to) => sb.from("balance_snapshots").select("id,account_id,snapshot_date,current_balance,available_balance,credit_limit").eq("user_id", uid).eq("account_id", accountId).range(from, to),
          "load snapshots"
        )
      );
    }
    return snapshotsByAccount.get(accountId)!;
  }
  async function childCountsByEnrichedId(enrichedIds: string[]) {
    const counts = new Map(enrichedIds.map((id) => [id, 0]));
    if (enrichedIds.length === 0) return counts;

    const [reviews, splits, reimbursements, proposals] = await Promise.all([
      expectPaged<{ enriched_transaction_id: string }>(
        (from, to) => sb.from("review_items").select("enriched_transaction_id").eq("user_id", uid).in("enriched_transaction_id", enrichedIds).range(from, to),
        "load review child counts"
      ),
      expectPaged<{ enriched_transaction_id: string }>(
        (from, to) => sb.from("transaction_splits").select("enriched_transaction_id").eq("user_id", uid).in("enriched_transaction_id", enrichedIds).range(from, to),
        "load split child counts"
      ),
      expectPaged<{ enriched_transaction_id: string | null; received_transaction_id: string | null }>(
        (from, to) => sb.from("reimbursement_records").select("enriched_transaction_id,received_transaction_id").eq("user_id", uid).or(`enriched_transaction_id.in.(${enrichedIds.join(",")}),received_transaction_id.in.(${enrichedIds.join(",")})`).range(from, to),
        "load reimbursement child counts"
      ),
      expectPaged<{ target_id: string }>(
        (from, to) => sb.from("agent_proposals").select("target_id").eq("user_id", uid).eq("target_kind", "enriched_transaction").in("target_id", enrichedIds).range(from, to),
        "load proposal child counts"
      )
    ]);

    for (const row of reviews) counts.set(row.enriched_transaction_id, (counts.get(row.enriched_transaction_id) ?? 0) + 1);
    for (const row of splits) counts.set(row.enriched_transaction_id, (counts.get(row.enriched_transaction_id) ?? 0) + 1);
    for (const row of reimbursements) {
      if (row.enriched_transaction_id) counts.set(row.enriched_transaction_id, (counts.get(row.enriched_transaction_id) ?? 0) + 1);
      if (row.received_transaction_id) counts.set(row.received_transaction_id, (counts.get(row.received_transaction_id) ?? 0) + 1);
    }
    for (const row of proposals) counts.set(row.target_id, (counts.get(row.target_id) ?? 0) + 1);
    return counts;
  }

  for (const [, group] of groups) {
    if (group.some((a) => !a.mask)) {
      if (group.length > 1) {
        console.log(`SKIP group ${group[0].type}/${group[0].name}: missing mask; refusing to infer account identity.`);
      }
      continue;
    }
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
    const targetSnapshots = await loadSnapshots(target.id);
    const targetSnapshotByDate = new Map(targetSnapshots.map((s) => [s.snapshot_date, s]));
    const targetDates = new Set(targetSnapshots.map((s) => s.snapshot_date));
    let moveSnapshotCount = 0;
    const snapshotConflicts: Array<{ sourceId: string; targetId: string; snapshotDate: string }> = [];
    for (const r of revoked) {
      for (const s of await loadSnapshots(r.id)) {
        const targetSnapshot = targetSnapshotByDate.get(s.snapshot_date);
        if (targetSnapshot) {
          if (!snapshotValuesEqual(s, targetSnapshot)) {
            snapshotConflicts.push({
              snapshotDate: s.snapshot_date,
              sourceId: s.id,
              targetId: targetSnapshot.id
            });
          }
        } else {
          targetSnapshotByDate.set(s.snapshot_date, s);
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
    const dropRows = perAccount
      .flatMap(({ rows }) => rows)
      .filter((r) => !keepSet.has(r.id));
    const childCounts = await childCountsByEnrichedId(dropEnrichedIds);
    const protectedDropIds = dropRows
      .filter((row) => (childCounts.get(row.id) ?? 0) > 0 || hasUserEditedEnrichment(row))
      .map((row) => row.id);

    plan.push({
      label: `${target.type} ${target.name} (mask ${target.mask})`,
      target,
      sources: revoked,
      keepEnrichedIds,
      dropEnrichedIds,
      dropCount,
      moveSnapshotCount,
      protectedDropIds,
      snapshotConflicts
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
    console.log(`    transactions moved: ${p.keepEnrichedIds.length} | duplicates dropped: ${p.dropCount} | protected drops: ${p.protectedDropIds.length} | snapshots moved: ${p.moveSnapshotCount} | snapshot conflicts: ${p.snapshotConflicts.length}`);
  }

  const totalDroppedTransactions = plan.reduce((sum, p) => sum + p.dropCount, 0);
  const protectedDropIds = plan.flatMap((p) => p.protectedDropIds);
  const snapshotConflicts = plan.flatMap((p) => p.snapshotConflicts);
  if (protectedDropIds.length > 0) {
    console.log("\nRefusing to execute because duplicate-looking transactions have child rows or user-edited enrichment.");
    console.log(`Protected transaction ids: ${protectedDropIds.join(", ")}`);
    if (execute) process.exit(1);
  }
  if (totalDroppedTransactions > 0 && !allowDropDuplicates) {
    console.log("\nRefusing to execute by default because the plan would drop duplicate-looking transactions.");
    console.log("Review the dry-run output and re-run with --allow-drop-duplicates if those rows are confirmed re-link copies.");
    if (execute) process.exit(1);
  }
  if (snapshotConflicts.length > 0 && !allowSnapshotConflicts) {
    console.log("\nRefusing to execute by default because same-day balance snapshots disagree across duplicate accounts.");
    console.log("Review the conflicting rows and re-run with --allow-snapshot-conflicts only if the survivor values should win.");
    if (execute) process.exit(1);
  }

  if (!execute) {
    console.log("\nDry run only. Re-run with --execute to apply.\n");
    return;
  }

  // Backup every row we are about to touch or cascade-delete.
  const sourceIds = plan.flatMap((p) => p.sources.map((s) => s.id));
  const affectedAccountIds = [...new Set([...sourceIds, ...plan.map((p) => p.target.id)])];
  const affectedEnrichedIds = [...new Set(plan.flatMap((p) => [...p.keepEnrichedIds, ...p.dropEnrichedIds]))];
  const affectedEnriched = affectedEnrichedIds.length > 0
    ? await expectPaged<EnrichedRow & Record<string, unknown>>(
      (from, to) => sb.from("enriched_transactions").select("*").eq("user_id", uid).in("id", affectedEnrichedIds).range(from, to),
      "backup affected enriched"
    )
    : [];
  const affectedRawIds = [...new Set(affectedEnriched.map((row) => row.raw_transaction_id))];
  const sourceRawRows = await expectPaged<{ id: string } & Record<string, unknown>>(
    (from, to) => sb.from("raw_transactions").select("*").eq("user_id", uid).in("account_id", sourceIds).range(from, to),
    "backup source raw"
  );
  const affectedRawRows = affectedRawIds.length > 0
    ? await expectPaged<{ id: string } & Record<string, unknown>>(
      (from, to) => sb.from("raw_transactions").select("*").eq("user_id", uid).in("id", affectedRawIds).range(from, to),
      "backup affected raw"
    )
    : [];
  const rawBackupRows = [...new Map([...sourceRawRows, ...affectedRawRows].map((row) => [row.id, row])).values()];
  const affectedReviewItems = affectedEnrichedIds.length > 0
    ? await expectPaged<{ id: string } & Record<string, unknown>>(
      (from, to) => sb.from("review_items").select("*").eq("user_id", uid).in("enriched_transaction_id", affectedEnrichedIds).range(from, to),
      "backup affected review items"
    )
    : [];
  const affectedReviewItemIds = affectedReviewItems.map((row) => row.id);
  const affectedSplits = affectedEnrichedIds.length > 0
    ? await expectPaged<{ id: string } & Record<string, unknown>>(
      (from, to) => sb.from("transaction_splits").select("*").eq("user_id", uid).in("enriched_transaction_id", affectedEnrichedIds).range(from, to),
      "backup affected splits"
    )
    : [];
  const affectedSplitIds = affectedSplits.map((row) => row.id);
  const affectedReimbursements = affectedEnrichedIds.length > 0
    ? await expectPaged<{ id: string } & Record<string, unknown>>(
      (from, to) => sb.from("reimbursement_records").select("*").eq("user_id", uid).or(`enriched_transaction_id.in.(${affectedEnrichedIds.join(",")}),received_transaction_id.in.(${affectedEnrichedIds.join(",")})`).range(from, to),
      "backup affected reimbursements"
    )
    : [];
  const splitReimbursements = affectedSplitIds.length > 0
    ? await expectPaged<{ id: string } & Record<string, unknown>>(
      (from, to) => sb.from("reimbursement_records").select("*").eq("user_id", uid).in("split_id", affectedSplitIds).range(from, to),
      "backup affected split reimbursements"
    )
    : [];
  const affectedReimbursementById = new Map([...affectedReimbursements, ...splitReimbursements].map((row) => [row.id, row]));
  const affectedReimbursementIds = [...affectedReimbursementById.keys()];
  async function agentProposalsFor(targetKind: string, ids: string[]) {
    return ids.length > 0
      ? await expectPaged<Record<string, unknown>>(
        (from, to) => sb.from("agent_proposals").select("*").eq("user_id", uid).eq("target_kind", targetKind).in("target_id", ids).range(from, to),
        `backup agent proposals for ${targetKind}`
      )
      : [];
  }
  async function auditEventsFor(entityTable: string, ids: string[]) {
    return ids.length > 0
      ? await expectPaged<Record<string, unknown>>(
        (from, to) => sb.from("audit_events").select("*").eq("user_id", uid).eq("entity_table", entityTable).in("entity_id", ids).range(from, to),
        `backup audit events for ${entityTable}`
      )
      : [];
  }
  const backup = {
    generatedAt: new Date().toISOString(),
    email,
    allowDropDuplicates,
    allowSnapshotConflicts,
    plan,
    accounts: accounts.filter((a) => affectedAccountIds.includes(a.id)),
    enriched: affectedEnriched,
    raw: rawBackupRows,
    snapshots: await expectPaged<Record<string, unknown>>(
      (from, to) => sb.from("balance_snapshots").select("*").eq("user_id", uid).in("account_id", affectedAccountIds).range(from, to),
      "backup snapshots"
    ),
    reviewItems: affectedReviewItems,
    transactionSplits: affectedSplits,
    reimbursementRecords: [...affectedReimbursementById.values()],
    recurringExpenses: await expectPaged<Record<string, unknown>>(
      (from, to) => sb.from("recurring_expenses").select("*").in("account_id", sourceIds).range(from, to),
      "backup recurring expenses"
    ),
    agentProposals: [
      ...await agentProposalsFor("enriched_transaction", affectedEnrichedIds),
      ...await agentProposalsFor("review_item", affectedReviewItemIds),
      ...await agentProposalsFor("reimbursement_record", affectedReimbursementIds)
    ],
    auditEvents: [
      ...await auditEventsFor("accounts", sourceIds),
      ...await auditEventsFor("enriched_transactions", affectedEnrichedIds),
      ...await auditEventsFor("raw_transactions", affectedRawIds),
      ...await auditEventsFor("review_items", affectedReviewItemIds),
      ...await auditEventsFor("transaction_splits", affectedSplitIds),
      ...await auditEventsFor("reimbursement_records", affectedReimbursementIds)
    ],
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
      const movedRaw = await expect<Array<{ id: string }>>(sb.from("raw_transactions").update({ account_id: p.target.id, plaid_item_id: p.target.plaid_item_id }).eq("id", r.raw_transaction_id).eq("user_id", uid).select("id"), "move raw");
      if (movedRaw.length !== 1) throw new Error(`move raw ${r.raw_transaction_id}: expected 1 row, got ${movedRaw.length}`);
      const movedEnriched = await expect<Array<{ id: string }>>(sb.from("enriched_transactions").update({ account_id: p.target.id }).eq("id", r.id).eq("user_id", uid).select("id"), "move enriched");
      if (movedEnriched.length !== 1) throw new Error(`move enriched ${r.id}: expected 1 row, got ${movedEnriched.length}`);
    }
    // 2. Move deduped snapshots to the survivor.
    const targetDates = new Set((snapshotsByAccount.get(p.target.id) ?? []).map((s) => s.snapshot_date));
    for (const s of p.sources.flatMap((src) => snapshotsByAccount.get(src.id) ?? [])) {
      if (targetDates.has(s.snapshot_date)) continue;
      targetDates.add(s.snapshot_date);
      const movedSnapshot = await expect<Array<{ id: string }>>(sb.from("balance_snapshots").update({ account_id: p.target.id }).eq("id", s.id).eq("user_id", uid).select("id"), "move snapshot");
      if (movedSnapshot.length !== 1) throw new Error(`move snapshot ${s.id}: expected 1 row, got ${movedSnapshot.length}`);
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
      const sourceRows = enrichedByAccount.get(s.id) ?? [];
      const plannedDropCount = p.dropEnrichedIds.filter((id) =>
        sourceRows.some((row) => row.id === id)
      ).length;
      const plannedDropRawIds = new Set(
        sourceRows
          .filter((row) => p.dropEnrichedIds.includes(row.id))
          .map((row) => row.raw_transaction_id)
      );
      const remainingEnriched = await expectPaged<{ id: string }>(
        (from, to) => sb.from("enriched_transactions").select("id").eq("user_id", uid).eq("account_id", s.id).range(from, to),
        "verify source enriched before delete"
      );
      if (remainingEnriched.length !== plannedDropCount) {
        throw new Error(`delete source account ${s.id}: expected ${plannedDropCount} remaining duplicate enriched rows, found ${remainingEnriched.length}`);
      }
      const remainingRaw = await expectPaged<{ id: string }>(
        (from, to) => sb.from("raw_transactions").select("id").eq("user_id", uid).eq("account_id", s.id).range(from, to),
        "verify source raw before delete"
      );
      const unexpectedRaw = remainingRaw.filter((row) => !plannedDropRawIds.has(row.id));
      if (unexpectedRaw.length > 0) {
        throw new Error(`delete source account ${s.id}: found raw rows with no planned duplicate enriched delete: ${unexpectedRaw.map((row) => row.id).join(", ")}`);
      }
      const deletedAccount = await expect<Array<{ id: string }>>(sb.from("accounts").delete().eq("id", s.id).eq("user_id", uid).select("id"), "delete source account");
      if (deletedAccount.length !== 1) throw new Error(`delete source account ${s.id}: expected 1 row, got ${deletedAccount.length}`);
    }
    console.log(`✓ merged ${p.label}`);
  }

  // 5. Delete revoked Plaid items that no longer have any accounts.
  const remaining = await expectPaged<{ plaid_item_id: string }>(
    (from, to) => sb.from("accounts").select("plaid_item_id").eq("user_id", uid).range(from, to),
    "reload accounts"
  );
  const referenced = new Set(remaining.map((a) => a.plaid_item_id));
  const plannedSourceItemIds = new Set(plan.flatMap((p) => p.sources.map((source) => source.plaid_item_id)));
  for (const item of items) {
    if (!plannedSourceItemIds.has(item.id)) continue;
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
