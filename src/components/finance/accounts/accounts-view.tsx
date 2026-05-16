import type { AccountRecord, BalanceSnapshotRecord } from "@/lib/db";
import type { AccountBalanceTotals, AccountGroup, SyncSummary } from "@/lib/finance/balances";
import { accountSyncState, balanceContribution } from "@/lib/finance/balances";
import type { PlaidConnectionSummary } from "@/lib/plaid/service";
import { Clock3, CreditCard, Database, Landmark, TriangleAlert, type LucideIcon } from "lucide-react";
import styles from "./accounts.module.css";

interface AccountsViewProps {
  accounts: AccountRecord[];
  dataError?: string;
  groups: AccountGroup[];
  isConfigured: boolean;
  isSignedIn: boolean;
  plaidConnections: PlaidConnectionSummary[];
  snapshots: BalanceSnapshotRecord[];
  syncSummary: SyncSummary;
  totals: AccountBalanceTotals;
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric"
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatRelativeTime(value: string | null) {
  if (!value) return "Never synced";

  const syncedAt = new Date(value);
  if (Number.isNaN(syncedAt.getTime())) return "Never synced";

  const diffMs = Math.max(0, Date.now() - syncedAt.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return syncedAt.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function latestSnapshotsByAccount(snapshots: readonly BalanceSnapshotRecord[]) {
  return snapshots.reduce((map, snapshot) => {
    const current = map.get(snapshot.accountId);
    if (!current || current.snapshotDate < snapshot.snapshotDate) {
      map.set(snapshot.accountId, snapshot);
    }
    return map;
  }, new Map<string, BalanceSnapshotRecord>());
}

function syncSummaryText(summary: SyncSummary) {
  if (summary.status === "empty") return "No account rows";
  if (summary.status === "never") return "No account has synced";
  if (summary.status === "stale") return `${summary.staleCount + summary.neverSyncedCount} accounts need sync`;
  return "All accounts fresh";
}

function SummaryCard({
  detail,
  icon: Icon,
  label,
  tone,
  value
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  tone?: "negative" | "positive";
  value: string;
}) {
  return (
    <div className={styles.summaryCard}>
      <span className={styles.summaryLabel}>
        <Icon size={13} aria-hidden />
        {label}
      </span>
      <strong className={tone ? styles[tone] : undefined}>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}

function AccountCard({
  account,
  connection,
  latestSnapshot
}: {
  account: AccountRecord;
  connection?: PlaidConnectionSummary;
  latestSnapshot?: BalanceSnapshotRecord;
}) {
  const displayBalance = balanceContribution(account);
  const syncState = accountSyncState(account);
  const utilization = account.type === "credit" && account.creditLimit
    ? Math.min(100, Math.round((Math.abs(displayBalance) / account.creditLimit) * 100))
    : null;
  const secondaryLabel = account.type === "credit" ? "Limit" : "Type";
  const secondaryValue = account.type === "credit"
    ? account.creditLimit === null ? "Not reported" : formatMoney(account.creditLimit)
    : account.subtype ?? account.type;

  return (
    <article className={`${styles.accountCard} ${!account.isActive ? styles.inactiveCard : ""}`}>
      <div className={styles.accountHead}>
        <span className={styles.institution}>
          <span className={styles.swatch} style={{ background: account.color ?? "var(--ink)" }} />
          {account.institutionName}
        </span>
        <span className={`${styles.syncPill} ${styles[`sync-${syncState}`]}`}>
          {syncState}
        </span>
      </div>

      <div className={styles.accountName}>
        <strong>{account.name}</strong>
        <span>{account.mask ? `...${account.mask}` : account.subtype ?? account.type}</span>
      </div>

      <div className={`${styles.balance} ${displayBalance < 0 ? styles.negative : ""}`}>
        {formatMoney(displayBalance)}
      </div>

      <div className={styles.detailGrid}>
        <div>
          <span>{account.type === "credit" ? "Available credit" : "Available"}</span>
          <strong>{account.availableBalance === null ? "Not reported" : formatMoney(account.availableBalance)}</strong>
        </div>
        <div>
          <span>{secondaryLabel}</span>
          <strong>{secondaryValue}</strong>
        </div>
      </div>

      {utilization !== null ? (
        <div className={styles.utilization}>
          <div>
            <span style={{ width: `${utilization}%` }} />
          </div>
          <strong>{utilization}% utilized</strong>
        </div>
      ) : null}

      <div className={styles.accountFoot}>
        <span>
          <Clock3 size={12} aria-hidden />
          {formatRelativeTime(account.lastSyncedAt)}
        </span>
        <span>
          {latestSnapshot ? `Snapshot ${formatDate(latestSnapshot.snapshotDate)}` : "No snapshot"}
        </span>
      </div>

      {connection?.issue ? (
        <div className={styles.accountFoot}>
          <span>
            <TriangleAlert size={12} aria-hidden />
            {connection.issue.title}
          </span>
          <span>{connection.issue.detail}</span>
        </div>
      ) : null}
    </article>
  );
}

export function AccountsView({
  accounts,
  dataError,
  groups,
  isConfigured,
  isSignedIn,
  plaidConnections,
  snapshots,
  syncSummary,
  totals
}: AccountsViewProps) {
  const latestSnapshotByAccount = latestSnapshotsByAccount(snapshots);
  const connectionByInstitutionId = new Map(plaidConnections.map((connection) => [connection.institutionId, connection]));

  return (
    <div className={styles.shell}>
      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so persisted account data cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in with Supabase Auth to load your persisted accounts.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <div className={styles.emptyState}>
          <Database size={24} aria-hidden />
          <div>
            <strong>No persisted accounts yet</strong>
            <span>Connected accounts will appear here with balances, snapshots, and sync status.</span>
          </div>
        </div>
      ) : (
        <>
          <section className={styles.summaryGrid} aria-label="Account summary">
            <SummaryCard detail={`${accounts.length} persisted account rows`} icon={Landmark} label="Net worth" value={formatMoney(totals.netWorth)} />
            <SummaryCard detail="Cash plus investments and retirement" icon={Database} label="Assets" value={formatMoney(totals.assets)} />
            <SummaryCard detail="Credit cards reduce net worth" icon={CreditCard} label="Liabilities" tone="negative" value={formatMoney(totals.credit)} />
            <SummaryCard
              detail={formatRelativeTime(syncSummary.latestSyncedAt)}
              icon={syncSummary.status === "stale" || syncSummary.status === "never" ? TriangleAlert : Clock3}
              label="Sync"
              tone={syncSummary.status === "fresh" ? "positive" : undefined}
              value={syncSummaryText(syncSummary)}
            />
          </section>

          <div className={styles.groupStack}>
            {groups.map((group) => (
              <section className={styles.group} key={group.key}>
                <div className={styles.groupHead}>
                  <div>
                    <span className={styles.eyebrow}>{group.accounts.length} accounts</span>
                    <h2>{group.label}</h2>
                    <p>{group.description}</p>
                  </div>
                  <strong className={`${styles.groupTotal} ${group.total < 0 ? styles.negative : ""}`}>
                    {formatMoney(group.total)}
                  </strong>
                </div>

                {group.accounts.length === 0 ? (
                  <div className={styles.emptyMini}>No persisted rows in this group.</div>
                ) : (
                  <div className={styles.accountGrid}>
                    {group.accounts.map((account) => (
                      <AccountCard
                        account={account}
                        connection={connectionByInstitutionId.get(account.institutionId)}
                        key={account.id}
                        latestSnapshot={latestSnapshotByAccount.get(account.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
