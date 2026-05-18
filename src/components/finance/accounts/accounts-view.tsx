import type { AccountRecord, BalanceSnapshotRecord, TransactionRecord } from "@/lib/db";
import { LinkButton, Notice } from "@/components/ui/primitives";
import { balanceContribution } from "@/lib/finance/balances";
import {
  ArrowUpRight,
  Database,
  Settings,
  TrendingUp,
  TriangleAlert,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import styles from "./accounts.module.css";

interface AccountsViewProps {
  accounts: AccountRecord[];
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
  recentTransactionsByAccount: Record<string, TransactionRecord[]>;
  snapshots: BalanceSnapshotRecord[];
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

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short"
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatShortDate(value: string) {
  return shortDateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatRelativeTime(value: string | null) {
  if (!value) return "No date";

  const syncedAt = new Date(value);
  if (Number.isNaN(syncedAt.getTime())) return "No date";

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

function formatAbsoluteTime(value: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatAccountKind(account: AccountRecord) {
  return account.subtype ?? account.type;
}

function isValuationOnlyAccount(account: AccountRecord) {
  return account.type === "investment" || account.type === "retirement";
}

function latestRecentTransactionDate(transactions: readonly TransactionRecord[]) {
  return transactions.reduce<string | null>((latestDate, transaction) => {
    if (!latestDate || transaction.date > latestDate) return transaction.date;
    return latestDate;
  }, null);
}

function sortAccountsForCards(
  accounts: readonly AccountRecord[],
  recentTransactionsByAccount: Readonly<Record<string, readonly TransactionRecord[]>>
) {
  return [...accounts].sort((a, b) => {
    const aLatestDate = latestRecentTransactionDate(recentTransactionsByAccount[a.id] ?? []);
    const bLatestDate = latestRecentTransactionDate(recentTransactionsByAccount[b.id] ?? []);
    if (aLatestDate && !bLatestDate) return -1;
    if (!aLatestDate && bLatestDate) return 1;

    const recentTransactionDelta = (bLatestDate ?? "").localeCompare(aLatestDate ?? "");
    if (recentTransactionDelta !== 0) return recentTransactionDelta;

    const institutionDelta = a.institutionName.localeCompare(b.institutionName);
    if (institutionDelta !== 0) return institutionDelta;

    return a.name.localeCompare(b.name);
  });
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

function formatHoldingSummary(account: AccountRecord) {
  const valuation = account.manualValuation;
  if (!valuation) return null;

  const symbols = valuation.holdings.map((holding) => `${holding.symbol} ${holding.shares.toLocaleString("en-US")} sh`);
  const stale = valuation.staleSymbols.length > 0 ? `; ${valuation.staleSymbols.join(", ")} not priced` : "";
  const summary = `${symbols.join(", ")}${stale}`;
  return summary || null;
}

interface AccountDetailRow {
  label: string;
  mono?: boolean;
  title?: string;
  value: string;
  wide?: boolean;
}

function accountDetailRows(account: AccountRecord, latestSnapshot?: BalanceSnapshotRecord): AccountDetailRow[] {
  const valuation = account.manualValuation;
  const valuationOnly = isValuationOnlyAccount(account);

  if (valuation) {
    const holdingsSummary = formatHoldingSummary(account);
    return [
      ...(holdingsSummary ? [{
        label: "Holdings",
        title: holdingsSummary,
        value: holdingsSummary,
        wide: true
      }] : []),
      {
        label: "Cash",
        mono: true,
        value: formatMoney(valuation.cash)
      }
    ];
  }

  if (account.type === "credit") {
    return [
      {
        label: "Available credit",
        mono: true,
        value: account.availableBalance === null ? "Not reported" : formatMoney(account.availableBalance)
      },
      {
        label: "Limit",
        mono: true,
        value: account.creditLimit === null ? "Not reported" : formatMoney(account.creditLimit)
      }
    ];
  }

  if (valuationOnly) {
    return latestSnapshot ? [{
      label: "Latest snapshot",
      mono: true,
      value: formatDate(latestSnapshot.snapshotDate)
    }] : [];
  }

  if (account.availableBalance !== null && Math.abs(account.availableBalance - account.balance) > 0.01) {
    return [{
      label: "Available",
      mono: true,
      value: formatMoney(account.availableBalance)
    }];
  }

  return [];
}

function RecentTransactions({
  account,
  transactions
}: {
  account: AccountRecord;
  transactions: TransactionRecord[];
}) {
  if (transactions.length === 0) return null;

  const accountHref = `/transactions?account=${encodeURIComponent(account.id)}`;

  return (
    <div className={styles.recentBlock} aria-label={`Recent transactions for ${account.name || account.institutionName}`}>
      <div className={styles.recentHead}>
        <span>Recent</span>
        <Link href={accountHref}>View all</Link>
      </div>
      <div className={styles.recentList}>
        {transactions.map((transaction) => (
          <Link className={styles.recentRow} href={`/transactions/${transaction.id}`} key={transaction.id}>
            <span className={styles.recentMerchant}>
              <strong>{transaction.merchant}</strong>
              <span>{formatShortDate(transaction.date)} · {transaction.category}</span>
            </span>
            <span className={`tabular-nums ${transaction.amount < 0 ? styles.negative : styles.positive}`.trim()}>
              {formatMoney(transaction.amount)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function AccountCard({
  account,
  latestSnapshot,
  recentTransactions
}: {
  account: AccountRecord;
  latestSnapshot?: BalanceSnapshotRecord;
  recentTransactions: TransactionRecord[];
}) {
  const displayBalance = balanceContribution(account);
  const marketValuation = account.manualValuation;
  const displayName = account.name || account.institutionName;
  const utilization = account.type === "credit" && account.creditLimit
    ? Math.min(100, Math.round((Math.abs(displayBalance) / account.creditLimit) * 100))
    : null;
  const needsRepair = !account.isActive;
  const href = `/transactions?account=${encodeURIComponent(account.id)}`;
  const detailRows = accountDetailRows(account, latestSnapshot);
  const footItems: Array<{ icon: LucideIcon; label: string; title?: string }> = [];

  if (marketValuation) {
    footItems.push({
      icon: TrendingUp,
      label: `Quote ${formatRelativeTime(marketValuation.asOf)}`,
      title: `Quote ${formatAbsoluteTime(marketValuation.asOf)}`
    });
    if (marketValuation.staleSymbols.length > 0) {
      footItems.push({
        icon: TriangleAlert,
        label: `${marketValuation.staleSymbols.join(", ")} not priced`
      });
    }
  }

  return (
    <article className={`${styles.accountCard} ${needsRepair ? styles.inactiveCard : ""}`}>
      <div className={styles.accountHead}>
        <div className={styles.accountTitle}>
          <span className={styles.swatch} style={{ background: account.color ?? "var(--ink)" }} aria-hidden />
          <div className={styles.accountName}>
            <Link aria-label={`View transactions for ${displayName}`} className={styles.accountPrimaryLink} href={href}>
              {displayName}
              <ArrowUpRight size={13} aria-hidden />
            </Link>
            <span>
              {account.institutionName}
              {" · "}
              {account.mask ? `•••• ${account.mask}` : formatAccountKind(account)}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.balanceRow}>
        <div className={`${styles.balance} tabular-nums ${displayBalance < 0 ? styles.negative : ""}`}>
          {formatMoney(displayBalance)}
        </div>
        <span className={styles.kind}>{formatAccountKind(account)}</span>
      </div>

      {detailRows.length > 0 ? (
        <div className={styles.detailGrid}>
          {detailRows.map((row) => (
            <div className={row.wide ? styles.detailWide : undefined} key={row.label}>
              <span>{row.label}</span>
              <strong
                className={row.mono ? "tabular-nums" : styles.detailTextValue}
                title={row.title}
              >
                {row.value}
              </strong>
            </div>
          ))}
        </div>
      ) : null}

      {utilization !== null ? (
        <div className={styles.utilization}>
          <div>
            <span style={{ width: `${utilization}%` }} />
          </div>
          <strong className="tabular-nums">{utilization}% utilized</strong>
        </div>
      ) : null}

      {needsRepair ? (
        <div className={styles.repairBanner} role="status">
          <TriangleAlert size={13} aria-hidden />
          <span>Needs repair in Settings</span>
        </div>
      ) : null}

      {footItems.length > 0 ? (
        <div className={styles.accountFoot}>
          {footItems.map((item) => {
            const FootIcon = item.icon;
            return (
              <span key={item.label} title={item.title}>
                <FootIcon size={12} aria-hidden />
                {item.label}
              </span>
            );
          })}
        </div>
      ) : null}

      <RecentTransactions account={account} transactions={recentTransactions} />
    </article>
  );
}

export function AccountsView({
  accounts,
  dataError,
  isConfigured,
  isDemo,
  isSignedIn,
  recentTransactionsByAccount,
  snapshots
}: AccountsViewProps) {
  const latestSnapshotByAccount = latestSnapshotsByAccount(snapshots);
  const sortedAccounts = sortAccountsForCards(accounts, recentTransactionsByAccount);

  return (
    <div className={styles.shell}>
      {!isConfigured ? (
        <Notice role="status">
          Supabase is not configured for this environment, so persisted account data cannot be loaded.
        </Notice>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <Notice role="status">
          Sign in with Supabase Auth to load your persisted accounts.
        </Notice>
      ) : null}

      {dataError ? (
        <Notice role="alert" tone="error">
          {dataError}
        </Notice>
      ) : null}

      {isDemo ? (
        <Notice role="status">
          Demo accounts use seeded balances. Connect or repair real institutions from a signed-in workspace.
        </Notice>
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
          <section className={styles.accountListSection} aria-label="Connected accounts">
            <div className={styles.accountListHead}>
              <div>
                <h2>Connected accounts</h2>
                <p>Accounts with the newest recent transactions appear first.</p>
              </div>
              <LinkButton href="/settings">
                <Settings size={13} aria-hidden />
                Manage connections
              </LinkButton>
            </div>

            <div className={styles.accountGrid}>
              {sortedAccounts.map((account) => (
                <AccountCard
                  account={account}
                  key={account.id}
                  latestSnapshot={latestSnapshotByAccount.get(account.id)}
                  recentTransactions={recentTransactionsByAccount[account.id] ?? []}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
