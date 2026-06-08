import type { AccountRecord, AccountType, BalanceSnapshotRecord, TransactionIntent, TransactionStatus } from "@/lib/db";

export type AccountGroupKey = "cash" | "credit" | "loans" | "investments" | "retirement";
export type BalanceTrendScope = "netWorth" | "cash" | "liabilities" | "cashMinusLiabilities";
export type TrendSource = "current" | "snapshot" | "transaction";
export type SyncState = "fresh" | "stale" | "never";

export interface AccountBalanceTotals {
  cash: number;
  credit: number;
  investments: number;
  retirement: number;
  loans: number;
  assets: number;
  liabilities: number;
  netWorth: number;
}

export interface AccountGroup {
  key: AccountGroupKey;
  label: string;
  description: string;
  accounts: AccountRecord[];
  total: number;
}

export interface BalanceTrendPoint {
  date: string;
  netWorth: number;
  source: TrendSource;
}

export interface SyncSummary {
  latestSyncedAt: string | null;
  freshCount: number;
  staleCount: number;
  neverSyncedCount: number;
  status: "empty" | SyncState;
}

interface BalanceLike {
  type: AccountType;
  balance: number;
}

interface BalanceTrendTransaction {
  accountId?: string;
  amount: number;
  date: string;
  intent: TransactionIntent;
  status: TransactionStatus;
}

const MIN_SNAPSHOT_TREND_DAYS = 45;
const DEFAULT_TRANSACTION_LOOKBACK_DAYS = 366;

const GROUP_ORDER: AccountGroupKey[] = ["cash", "credit", "loans", "investments", "retirement"];

const GROUP_META: Record<AccountGroupKey, Pick<AccountGroup, "description" | "label">> = {
  cash: {
    description: "Checking, savings, and other depository balances.",
    label: "Cash"
  },
  credit: {
    description: "Credit cards and revolving liabilities.",
    label: "Credit / liabilities"
  },
  loans: {
    description: "Student loans, mortgages, and other installment liabilities.",
    label: "Loans"
  },
  investments: {
    description: "Taxable brokerage and investment accounts.",
    label: "Investments"
  },
  retirement: {
    description: "Retirement accounts and tax-advantaged investments.",
    label: "Retirement"
  }
};

export function accountGroupKey(type: AccountType): AccountGroupKey {
  if (type === "depository") return "cash";
  if (type === "credit") return "credit";
  if (type === "loan") return "loans";
  if (type === "investment") return "investments";
  return "retirement";
}

export function balanceContribution({ balance, type }: BalanceLike): number {
  if (type === "credit" || type === "loan") {
    return -Math.abs(balance);
  }

  return balance;
}

export function accountIncludedInBalanceScope(account: Pick<BalanceLike, "type">, scope: BalanceTrendScope) {
  if (scope === "netWorth") return true;
  if (scope === "cash") return account.type === "depository";
  if (scope === "liabilities") return account.type === "credit" || account.type === "loan";
  return account.type === "depository" || account.type === "credit" || account.type === "loan";
}

export function balanceContributionForScope(account: BalanceLike, scope: BalanceTrendScope): number {
  if (!accountIncludedInBalanceScope(account, scope)) return 0;

  if (scope === "liabilities") return Math.abs(account.balance);
  if (scope === "cashMinusLiabilities" && (account.type === "credit" || account.type === "loan")) {
    return -Math.abs(account.balance);
  }

  return scope === "netWorth" ? balanceContribution(account) : account.balance;
}

export function calculateAccountScopeTotal(
  accounts: readonly AccountRecord[],
  scope: BalanceTrendScope
) {
  return accounts.reduce((sum, account) => sum + balanceContributionForScope(account, scope), 0);
}

export function calculateAccountTotals(accounts: readonly AccountRecord[]): AccountBalanceTotals {
  const totals = accounts.reduce(
    (sum, account) => {
      const value = balanceContribution(account);
      const key = accountGroupKey(account.type);
      sum[key] += value;

      if (key === "credit" || key === "loans") {
        sum.liabilities += Math.abs(value);
      } else {
        sum.assets += value;
      }

      sum.netWorth += value;
      return sum;
    },
    {
      assets: 0,
      cash: 0,
      credit: 0,
      investments: 0,
      liabilities: 0,
      loans: 0,
      netWorth: 0,
      retirement: 0
    }
  );

  return totals;
}

export function groupAccounts(accounts: readonly AccountRecord[]): AccountGroup[] {
  return GROUP_ORDER.map((key) => {
    const groupedAccounts = accounts.filter((account) => accountGroupKey(account.type) === key);

    return {
      ...GROUP_META[key],
      accounts: groupedAccounts,
      key,
      total: groupedAccounts.reduce((sum, account) => sum + balanceContribution(account), 0)
    };
  });
}

export function buildBalanceTrend(
  accounts: readonly AccountRecord[],
  snapshots: readonly BalanceSnapshotRecord[],
  options: {
    asOfDate?: string;
    maxPoints?: number;
    minSnapshotTrendDays?: number;
    scope?: BalanceTrendScope;
    transactionLookbackDays?: number;
    transactions?: readonly BalanceTrendTransaction[];
  } = {}
): BalanceTrendPoint[] {
  const scope = options.scope ?? "netWorth";
  const scopedAccounts = accounts.filter((account) => accountIncludedInBalanceScope(account, scope));

  if (scopedAccounts.length === 0) return [];

  const accountById = new Map(scopedAccounts.map((account) => [account.id, account]));
  const totalsByDate = new Map<string, number>();
  const asOfDate = options.asOfDate ?? new Date().toISOString().slice(0, 10);
  const maxPoints = options.maxPoints ?? 366;

  snapshots.forEach((snapshot) => {
    const account = accountById.get(snapshot.accountId);
    if (!account) return;

    totalsByDate.set(
      snapshot.snapshotDate,
      (totalsByDate.get(snapshot.snapshotDate) ?? 0) +
        balanceContributionForScope({ balance: snapshot.currentBalance, type: account.type }, scope)
    );
  });

  const points: BalanceTrendPoint[] = [...totalsByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, netWorth]) => ({ date, netWorth, source: "snapshot" as const }));

  const transactionTrend = buildTransactionDerivedTrend(scopedAccounts, options.transactions ?? [], {
    asOfDate,
    lookbackDays: options.transactionLookbackDays ?? DEFAULT_TRANSACTION_LOOKBACK_DAYS,
    maxPoints,
    scope
  });

  if (points.length > 0) {
    const snapshotSpanDays = trendSpanDays(points);
    const minSnapshotTrendDays = options.minSnapshotTrendDays ?? MIN_SNAPSHOT_TREND_DAYS;

    if (asOfDate && points[points.length - 1].date < asOfDate) {
      points.push({
        date: asOfDate,
        netWorth: calculateAccountScopeTotal(scopedAccounts, scope),
        source: "current"
      });
    }

    if (points.length >= 4 && snapshotSpanDays >= minSnapshotTrendDays) {
      return points.slice(-maxPoints);
    }

    if (transactionTrend.length > points.length) {
      return transactionTrend;
    }

    return points.slice(-maxPoints);
  }

  if (transactionTrend.length > 0) return transactionTrend;

  return [
    {
      date: asOfDate,
      netWorth: calculateAccountScopeTotal(scopedAccounts, scope),
      source: "current"
    }
  ];
}

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`).getTime();
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function trendSpanDays(points: readonly BalanceTrendPoint[]) {
  if (points.length < 2) return 0;

  const first = points[0];
  const latest = points[points.length - 1];
  return Math.max(0, Math.round((parseDate(latest.date) - parseDate(first.date)) / 86_400_000));
}

function buildTransactionDerivedTrend(
  accounts: readonly AccountRecord[],
  transactions: readonly BalanceTrendTransaction[],
  options: { asOfDate: string; lookbackDays: number; maxPoints: number; scope: BalanceTrendScope }
) {
  const currentNetWorth = calculateAccountScopeTotal(accounts, options.scope);
  const cutoffDate = addDays(options.asOfDate, -options.lookbackDays);
  const deltasByDate = new Map<string, number>();
  const accountTypeById = new Map(accounts.map((account) => [account.id, account.type]));

  transactions.forEach((transaction) => {
    if (transaction.status === "pending" || transaction.intent === "transfer") return;
    if (transaction.date < cutoffDate || transaction.date > options.asOfDate) return;

    const accountType = transaction.accountId ? accountTypeById.get(transaction.accountId) : undefined;
    let delta = 0;

    if (options.scope === "netWorth") {
      // All accounts contribute with normal sign. Missing accountId still
      // counts (preserves legacy behavior where transactions without an
      // account just contribute to net worth).
      delta = transaction.amount;
    } else if (options.scope === "cash") {
      if (accountType !== "depository") return;
      delta = transaction.amount;
    } else if (options.scope === "liabilities") {
      if (accountType !== "credit") return;
      // Liabilities are a positive "amount owed"; a charge (negative
      // transaction amount) makes you owe more.
      delta = -transaction.amount;
    } else if (options.scope === "cashMinusLiabilities") {
      if (accountType !== "depository" && accountType !== "credit") return;
      delta = transaction.amount;
    }

    if (delta === 0) return;
    deltasByDate.set(
      transaction.date,
      (deltasByDate.get(transaction.date) ?? 0) + delta
    );
  });

  const dates = [...deltasByDate.keys()].sort((left, right) => left.localeCompare(right));
  if (dates.length === 0) return [];

  let runningNetWorth = currentNetWorth - [...deltasByDate.values()].reduce((sum, amount) => sum + amount, 0);
  const points: BalanceTrendPoint[] = [{
    date: cutoffDate < dates[0] ? cutoffDate : dates[0],
    netWorth: runningNetWorth,
    source: "transaction"
  }];

  dates.forEach((date) => {
    runningNetWorth += deltasByDate.get(date) ?? 0;
    points.push({
      date,
      netWorth: runningNetWorth,
      source: "transaction"
    });
  });

  if (points[points.length - 1].date < options.asOfDate) {
    points.push({
      date: options.asOfDate,
      netWorth: currentNetWorth,
      source: "current"
    });
  }

  return points.slice(-options.maxPoints);
}

export function accountSyncState(
  account: Pick<AccountRecord, "lastSyncedAt">,
  options: { now?: Date; staleAfterHours?: number } = {}
): SyncState {
  if (!account.lastSyncedAt) return "never";

  const syncedAt = parseValidDate(account.lastSyncedAt);
  if (!syncedAt) return "never";

  const now = options.now ?? new Date();
  const staleAfterMs = (options.staleAfterHours ?? 24) * 60 * 60 * 1000;
  return now.getTime() - syncedAt.getTime() > staleAfterMs ? "stale" : "fresh";
}

function parseValidDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function summarizeSync(
  accounts: readonly Pick<AccountRecord, "lastSyncedAt">[],
  options: { now?: Date; staleAfterHours?: number } = {}
): SyncSummary {
  if (accounts.length === 0) {
    return {
      freshCount: 0,
      latestSyncedAt: null,
      neverSyncedCount: 0,
      staleCount: 0,
      status: "empty"
    };
  }

  let latestSyncedAt: string | null = null;
  let latestSyncedAtTime = Number.NEGATIVE_INFINITY;

  const counts = accounts.reduce(
    (sum, account) => {
      const state = accountSyncState(account, options);
      if (state === "fresh") sum.freshCount += 1;
      if (state === "stale") sum.staleCount += 1;
      if (state === "never") sum.neverSyncedCount += 1;

      const syncedAt = account.lastSyncedAt ? parseValidDate(account.lastSyncedAt) : null;
      if (syncedAt && syncedAt.getTime() > latestSyncedAtTime) {
        latestSyncedAt = account.lastSyncedAt;
        latestSyncedAtTime = syncedAt.getTime();
      }

      return sum;
    },
    { freshCount: 0, neverSyncedCount: 0, staleCount: 0 }
  );

  return {
    ...counts,
    latestSyncedAt,
    status: counts.neverSyncedCount === accounts.length ? "never" : counts.staleCount > 0 ? "stale" : "fresh"
  };
}
