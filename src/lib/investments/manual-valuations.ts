import type { AccountRecord, ManualInvestmentHoldingRecord, ManualInvestmentValuationRecord } from "@/lib/db";
import { listAccounts } from "@/lib/db/queries";

type SnapshotWriterClient = Parameters<typeof listAccounts>[0];

type HoldingConfig = {
  accountId?: string;
  accountName?: string;
  cash: number;
  holdings: {
    shares: number;
    symbol: string;
  }[];
  institutionName?: string;
};

type Quote = {
  asOf: string;
  price: number;
  symbol: string;
};

type QuoteProvider = (symbol: string) => Promise<Quote | null>;
type ManualInvestmentEnv = Partial<Record<"FIDELITY_HOLDINGS" | "MANUAL_INVESTMENT_HOLDINGS", string>>;

const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const quoteCache = new Map<string, { expiresAt: number; quote: Quote | null }>();

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSymbol(value: unknown) {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9.-]{1,15}$/.test(symbol) ? symbol : null;
}

function mergeDuplicateHoldings(holdings: HoldingConfig["holdings"]) {
  const merged = new Map<string, HoldingConfig["holdings"][number]>();

  for (const holding of holdings) {
    const current = merged.get(holding.symbol);
    if (current) {
      current.shares += holding.shares;
      continue;
    }

    merged.set(holding.symbol, { ...holding });
  }

  return [...merged.values()];
}

function parseJsonHoldingConfig(value: string): HoldingConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const data = row as Record<string, unknown>;
    const nestedHoldings = Array.isArray(data.holdings) ? data.holdings : [data];
    const holdings = nestedHoldings.flatMap((holding) => {
      if (!holding || typeof holding !== "object") return [];
      const holdingData = holding as Record<string, unknown>;
      const symbol = normalizeSymbol(holdingData.symbol ?? holdingData.ticker);
      const shares = parseNumber(holdingData.shares ?? holdingData.quantity);
      return symbol && shares !== null && shares > 0 ? [{ shares, symbol }] : [];
    });
    const mergedHoldings = mergeDuplicateHoldings(holdings);

    if (mergedHoldings.length === 0) return [];

    return [{
      accountId: typeof data.accountId === "string" ? data.accountId : undefined,
      accountName: typeof data.accountName === "string" ? data.accountName : undefined,
      cash: parseNumber(data.cash) ?? 0,
      holdings: mergedHoldings,
      institutionName: typeof data.institutionName === "string" ? data.institutionName : undefined
    }];
  });
}

function parseFidelityHoldingConfig(value: string): HoldingConfig[] {
  const tokens = value.split(",").map((token) => token.trim()).filter(Boolean);
  const holdings: HoldingConfig["holdings"] = [];
  let cash = 0;

  for (const token of tokens) {
    const [rawKey, rawValue] = token.split(/[:=]/, 2);
    const key = rawKey?.trim();
    const amount = parseNumber(rawValue);

    if (!key || amount === null) continue;
    if (key.toLowerCase() === "cash") {
      cash = amount;
      continue;
    }

    const symbol = normalizeSymbol(key);
    if (symbol && amount > 0) {
      holdings.push({ shares: amount, symbol });
    }
  }

  return holdings.length > 0
    ? [{ cash, holdings: mergeDuplicateHoldings(holdings), institutionName: "Fidelity" }]
    : [];
}

function defaultManualInvestmentEnv(): ManualInvestmentEnv {
  return {
    FIDELITY_HOLDINGS: process.env.FIDELITY_HOLDINGS,
    MANUAL_INVESTMENT_HOLDINGS: process.env.MANUAL_INVESTMENT_HOLDINGS
  };
}

export function parseManualInvestmentHoldings(env: ManualInvestmentEnv = defaultManualInvestmentEnv()): HoldingConfig[] {
  const configs: HoldingConfig[] = [];
  const rawManualConfig = env.MANUAL_INVESTMENT_HOLDINGS?.trim();
  const rawFidelityConfig = env.FIDELITY_HOLDINGS?.trim();

  if (rawManualConfig) {
    try {
      configs.push(...parseJsonHoldingConfig(rawManualConfig));
    } catch {
      // Ignore malformed manual config and keep any simpler account-specific config available.
    }
  }

  if (rawFidelityConfig) {
    configs.push(...parseFidelityHoldingConfig(rawFidelityConfig));
  }

  return configs;
}

function accountMatchesConfig(account: AccountRecord, config: HoldingConfig) {
  if (config.accountId && account.id === config.accountId) return true;
  if (config.accountName && account.name.toLowerCase() === config.accountName.toLowerCase()) return true;
  if (config.institutionName && account.institutionName.toLowerCase().includes(config.institutionName.toLowerCase())) return true;
  return false;
}

async function fetchYahooQuote(symbol: string): Promise<Quote | null> {
  const cacheKey = symbol.toUpperCase();
  const cached = quoteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.quote;

  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cacheKey)}?range=1d&interval=1d`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000)
  });

  if (!response.ok) {
    quoteCache.set(cacheKey, { expiresAt: Date.now() + QUOTE_CACHE_TTL_MS, quote: null });
    return null;
  }

  const payload = await response.json() as {
    chart?: {
      result?: {
        meta?: {
          regularMarketPrice?: number;
          regularMarketTime?: number;
          symbol?: string;
        };
      }[];
    };
  };
  const meta = payload.chart?.result?.[0]?.meta;
  const price = typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : null;

  if (price === null || !Number.isFinite(price) || price <= 0) {
    quoteCache.set(cacheKey, { expiresAt: Date.now() + QUOTE_CACHE_TTL_MS, quote: null });
    return null;
  }

  const asOf = typeof meta?.regularMarketTime === "number"
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : new Date().toISOString();
  const quote = {
    asOf,
    price,
    symbol: normalizeSymbol(meta?.symbol) ?? cacheKey
  };

  quoteCache.set(cacheKey, { expiresAt: Date.now() + QUOTE_CACHE_TTL_MS, quote });
  return quote;
}

async function buildValuation(
  account: AccountRecord,
  config: HoldingConfig,
  quoteProvider: QuoteProvider
): Promise<ManualInvestmentValuationRecord | null> {
  const pricedHoldings: ManualInvestmentHoldingRecord[] = [];
  const staleSymbols: string[] = [];
  let asOf = "";

  for (const holding of config.holdings) {
    const quote = await quoteProvider(holding.symbol);
    if (!quote) {
      staleSymbols.push(holding.symbol);
      continue;
    }

    asOf = quote.asOf > asOf ? quote.asOf : asOf;
    pricedHoldings.push({
      price: roundMoney(quote.price),
      shares: holding.shares,
      symbol: holding.symbol,
      value: roundMoney(holding.shares * quote.price)
    });
  }

  if (pricedHoldings.length === 0) return null;

  const holdingsValue = pricedHoldings.reduce((sum, holding) => sum + holding.value, 0);
  const cash = roundMoney(config.cash);
  const totalValue = roundMoney(holdingsValue + cash);

  return {
    accountId: account.id,
    asOf: asOf || new Date().toISOString(),
    cash,
    holdings: pricedHoldings,
    source: "manual_holdings",
    staleSymbols,
    totalValue
  };
}

export async function applyManualInvestmentValuations(
  accounts: readonly AccountRecord[],
  options: {
    env?: ManualInvestmentEnv;
    quoteProvider?: QuoteProvider;
  } = {}
) {
  const configs = parseManualInvestmentHoldings(options.env);
  if (configs.length === 0) return [...accounts];

  const quoteProvider = options.quoteProvider ?? fetchYahooQuote;
  const valuations = new Map<string, ManualInvestmentValuationRecord>();

  await Promise.all(configs.map(async (config) => {
    const account = accounts.find((candidate) => (
      (candidate.type === "investment" || candidate.type === "retirement") &&
      accountMatchesConfig(candidate, config)
    ));
    if (!account) return;

    const valuation = await buildValuation(account, config, quoteProvider);
    if (valuation) valuations.set(account.id, valuation);
  }));

  return accounts.map((account) => {
    const valuation = valuations.get(account.id);
    if (!valuation) return account;

    return {
      ...account,
      availableBalance: valuation.cash,
      balance: valuation.totalValue,
      manualValuation: valuation
    };
  });
}

export function buildManualInvestmentSnapshotRows(
  accounts: readonly AccountRecord[],
  userId: string,
  snapshotDate: string
) {
  return accounts
    .filter((account) => account.manualValuation)
    .map((account) => ({
      account_id: account.id,
      available_balance: account.manualValuation!.cash,
      credit_limit: null,
      current_balance: account.manualValuation!.totalValue,
      iso_currency_code: account.currency,
      snapshot_date: snapshotDate,
      source: "manual" as const,
      user_id: userId
    }));
}

export async function recordManualInvestmentSnapshots(
  client: SnapshotWriterClient,
  userId: string,
  snapshotDate: string,
  options: { env?: ManualInvestmentEnv; quoteProvider?: QuoteProvider } = {}
): Promise<{ snapshotsWritten: number }> {
  const baseAccounts = await listAccounts(client, userId);
  const priced = await applyManualInvestmentValuations(baseAccounts, options);
  const rows: Record<string, unknown>[] = buildManualInvestmentSnapshotRows(priced, userId, snapshotDate);

  if (rows.length === 0) return { snapshotsWritten: 0 };

  const result = await (client.from("balance_snapshots") as unknown as {
    upsert: (rows: unknown, options: { onConflict: string }) => {
      select: (columns: string) => Promise<{ data: { id: string }[] | null; error: { message: string } | null }>;
    };
  })
    .upsert(rows, { onConflict: "user_id,account_id,snapshot_date" })
    .select("id");

  if (result.error) {
    throw new Error(`Upsert manual investment snapshots: ${result.error.message}`);
  }

  return { snapshotsWritten: result.data?.length ?? 0 };
}
