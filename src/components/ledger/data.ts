export type AccountType = "depository" | "credit" | "investment" | "retirement";
export type Intent = "personal" | "business" | "shared" | "reimbursable" | "transfer";
export type ReviewReason =
  | "venmo"
  | "large"
  | "transfer-pair"
  | "new-recurring"
  | "low-confidence"
  | "missing-category"
  | "unclear-transfer"
  | "recurring-candidate";
export type RecurringStatus = "active" | "pending";

export interface LedgerAccount {
  id: string;
  name: string;
  type: AccountType;
  mask: string;
  institution: string;
  balance: number;
  limit?: number;
  color: string;
}

export interface AiSuggestion {
  category?: string;
  intent?: Intent;
  recurring?: boolean;
  confidence?: number;
  reason?: string;
  from?: string;
}

export interface TransactionSplit {
  id: string;
  label: string;
  intent: Intent;
  category: string;
  amount: number;
}

export interface LedgerTransaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  account: string;
  category: string;
  intent: Intent;
  plaidCategory: string;
  plaidMerchant: string;
  status: "posted" | "pending";
  confidence: number;
  reviewReason: ReviewReason | null;
  aiSuggested?: AiSuggestion;
  note: string;
  recurring: boolean;
  split?: TransactionSplit[] | null;
}

export interface RecurringExpense {
  id: string;
  merchant: string;
  amount: number;
  cadence: "weekly" | "monthly" | "annual";
  category: string;
  nextDate: number;
  lastAmount: number;
  status: RecurringStatus;
  new?: boolean;
}

export interface NetWorthPoint {
  d: number;
  v: number;
}

export interface LedgerData {
  accounts: LedgerAccount[];
  txns: LedgerTransaction[];
  recurring: RecurringExpense[];
  trend: NetWorthPoint[];
}

const DAY_MS = 86_400_000;
export const BASE_DATE = new Date("2026-05-06T12:00:00-07:00");

function seededRandom(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function isoDaysAgo(daysAgo: number) {
  return new Date(BASE_DATE.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

function money(n: number) {
  return Math.round(n * 100) / 100;
}

export const ledgerData: LedgerData = (() => {
  const accounts: LedgerAccount[] = [
    { id: "a1", name: "Schools First Checking", type: "depository", mask: "4412", institution: "Schools First FCU", balance: 6840.22, color: "#0a4d8c" },
    { id: "a2", name: "Charles Schwab Checking", type: "depository", mask: "7720", institution: "Charles Schwab", balance: 4203.87, color: "#00a0df" },
    { id: "a3", name: "Marcus Savings (Apple)", type: "depository", mask: "2210", institution: "Goldman Sachs", balance: 28450, color: "#7a5c2e" },
    { id: "a5", name: "Chase Sapphire", type: "credit", mask: "4421", institution: "Chase", balance: -2847.32, limit: 15000, color: "#1f3a5f" },
    { id: "a6", name: "Apple Card", type: "credit", mask: "0042", institution: "Apple", balance: -612.4, limit: 8000, color: "#222222" },
    { id: "a7", name: "Discover It", type: "credit", mask: "8830", institution: "Discover", balance: -421.8, limit: 6500, color: "#ff6000" },
    { id: "a8", name: "Amex Blue Cash", type: "credit", mask: "1006", institution: "American Express", balance: -1284.5, limit: 12000, color: "#006fcf" },
    { id: "a10", name: "Fidelity Brokerage", type: "investment", mask: "7711", institution: "Fidelity", balance: 42890.55, color: "#3a7a3a" },
    { id: "a11", name: "Vanguard Roth IRA", type: "retirement", mask: "5523", institution: "Vanguard", balance: 18420.1, color: "#96151d" }
  ];

  const txn = (
    id: string,
    daysAgo: number,
    merchant: string,
    amount: number,
    account: string,
    category: string,
    intent: Intent,
    opts: Partial<Omit<LedgerTransaction, "id" | "date" | "merchant" | "amount" | "account" | "category" | "intent">> = {}
  ): LedgerTransaction => ({
    id,
    date: isoDaysAgo(daysAgo),
    merchant,
    amount,
    account,
    category,
    intent,
    plaidCategory: opts.plaidCategory ?? category,
    plaidMerchant: opts.plaidMerchant ?? merchant,
    status: opts.status ?? "posted",
    confidence: opts.confidence ?? 0.95,
    reviewReason: opts.reviewReason ?? null,
    aiSuggested: opts.aiSuggested,
    note: opts.note ?? "",
    recurring: opts.recurring ?? false,
    split: opts.split ?? null
  });

  const txns: LedgerTransaction[] = [
    txn("t1", 0, "Sweetgreen", -16.45, "a5", "Food / Restaurants", "personal", { plaidMerchant: "SWEETGREEN #0421 NEW YORK" }),
    txn("t2", 0, "Anthropic", -20, "a5", "Software / AI Tools", "business", {
      plaidCategory: "Service",
      plaidMerchant: "ANTHROPIC PBC SAN FRANC",
      recurring: true,
      aiSuggested: { category: "Software / AI Tools", from: "Service", confidence: 0.97 }
    }),
    txn("t3", 1, "Venmo - Maya R.", -92.4, "a5", "Uncategorized", "shared", {
      plaidCategory: "Transfer",
      plaidMerchant: "VENMO CASHOUT MAYA R",
      reviewReason: "venmo",
      confidence: 0.42,
      aiSuggested: { category: "Food / Restaurants", intent: "shared", confidence: 0.72, reason: "Peer-to-peer payment with a weekend dinner-size amount." }
    }),
    txn("t4", 1, "Cursor", -20, "a5", "Software / AI Tools", "business", {
      recurring: true,
      plaidCategory: "Service",
      aiSuggested: { category: "Software / AI Tools", from: "Service", confidence: 0.96 }
    }),
    txn("t5", 2, "Equinox", -260, "a5", "Health / Fitness", "personal", { recurring: true }),
    txn("t6", 2, "Uber", -23.4, "a5", "Transport / Rideshare", "personal"),
    txn("t7", 3, "Sweetgreen", -18.2, "a5", "Food / Restaurants", "personal"),
    txn("t8", 3, "Linear", -16, "a5", "Software / SaaS", "business", { recurring: true }),
    txn("t9", 4, "Delta Air Lines", -487.2, "a5", "Travel / Flights", "business", {
      reviewReason: "large",
      confidence: 0.71,
      aiSuggested: { intent: "business", from: "personal", confidence: 0.71, reason: "Looks like work travel based on similar past trips." }
    }),
    txn("t10", 4, "Whole Foods", -82.14, "a5", "Groceries", "personal"),
    txn("t11", 5, "Vercel", -20, "a5", "Software / Hosting", "business", { recurring: true }),
    txn("t12", 5, "Zelle - Alex K.", -68, "a5", "Uncategorized", "shared", {
      plaidCategory: "Transfer",
      plaidMerchant: "ZELLE PAYMENT TO ALEX K",
      reviewReason: "venmo",
      confidence: 0.48,
      aiSuggested: { category: "Transport / Rideshare", intent: "shared", confidence: 0.63, reason: "Peer-to-peer transfer. Explain it before Tally trusts the spend bucket." }
    }),
    txn("t13", 6, "Joe's Pizza", -14.5, "a5", "Food / Restaurants", "personal"),
    txn("t14", 7, "CHASE PMT THANK YOU", 1200, "a1", "Transfer", "transfer", { plaidCategory: "Payment", reviewReason: "transfer-pair", confidence: 0.6 }),
    txn("t15", 7, "CHASE CARD PAYMENT", -1200, "a5", "Transfer", "transfer", { plaidCategory: "Payment" }),
    txn("t16", 8, "Sweetgreen", -17.2, "a5", "Food / Restaurants", "personal"),
    txn("t17", 8, "Spotify", -11.99, "a5", "Software / SaaS", "personal", { recurring: true }),
    txn("t18", 9, "Cash App - Jordan", -47.5, "a5", "Uncategorized", "shared", {
      plaidCategory: "Transfer",
      plaidMerchant: "CASH APP JORDAN",
      reviewReason: "venmo",
      confidence: 0.45,
      aiSuggested: { category: "Food / Restaurants", intent: "shared", confidence: 0.7, reason: "Peer-to-peer payment likely hides the real category." }
    }),
    txn("t19", 10, "Equinox", -260, "a5", "Health / Fitness", "personal", { recurring: true, plaidCategory: "Health" }),
    txn("t20", 10, "Amazon", -127.83, "a5", "Shopping", "personal"),
    txn("t21", 11, "OpenAI", -20, "a5", "Software / AI Tools", "business", { recurring: true }),
    txn("t22", 12, "Sweetgreen", -16.45, "a5", "Food / Restaurants", "personal"),
    txn("t23", 12, "Lyft", -18.7, "a5", "Transport / Rideshare", "personal"),
    txn("t24", 13, "Notion", -10, "a5", "Software / SaaS", "business", { recurring: true }),
    txn("t25", 14, "PAYROLL DEPOSIT", 6850, "a1", "Income", "personal", { plaidCategory: "Deposit", recurring: true }),
    txn("t26", 15, "Trader Joe's", -64.22, "a5", "Groceries", "personal"),
    txn("t27", 16, "Figma", -15, "a5", "Software / SaaS", "business", { recurring: true }),
    txn("t28", 17, "Venmo - Chris L.", -121.35, "a5", "Uncategorized", "shared", {
      plaidCategory: "Transfer",
      plaidMerchant: "VENMO PAYMENT CHRIS L",
      reviewReason: "venmo",
      confidence: 0.39,
      aiSuggested: { category: "Food / Restaurants", intent: "reimbursable", confidence: 0.66, reason: "Amount resembles a group dinner from past peer-to-peer payments." }
    }),
    txn("t29", 18, "United Airlines", -612.8, "a5", "Travel / Flights", "personal", { reviewReason: "large", confidence: 0.74 }),
    txn("t30", 19, "Equinox", -260, "a5", "Health / Fitness", "personal", { recurring: true }),
    txn("t31", 20, "GitHub", -4, "a5", "Software / SaaS", "business", { recurring: true }),
    txn("t32", 21, "Sweetgreen", -18.2, "a5", "Food / Restaurants", "personal"),
    txn("t33", 22, "Anthropic", -20, "a5", "Software / AI Tools", "business", { recurring: true }),
    txn("t34", 23, "Brooklyn Bagel", -8.5, "a5", "Food / Restaurants", "personal"),
    txn("t35", 24, "NYC Rent", -2400, "a1", "Housing", "personal", { recurring: true }),
    txn("t36", 25, "CVS Pharmacy", -23.4, "a5", "Health / Pharmacy", "personal"),
    txn("t37", 27, "Cursor", -20, "a5", "Software / AI Tools", "business", { recurring: true }),
    txn("t38", 28, "PAYROLL DEPOSIT", 6850, "a1", "Income", "personal", { recurring: true }),
    txn("t39", 30, "Substack", -8, "a5", "Software / SaaS", "personal", {
      recurring: true,
      reviewReason: "new-recurring",
      confidence: 0.65,
      aiSuggested: { recurring: true, confidence: 0.78, reason: "Charged 2 months in a row at $8." }
    }),
    txn("t40", 32, "Equinox", -260, "a5", "Health / Fitness", "personal", { recurring: true }),
    txn("t41", 6, "Retail Wash", -18.5, "a5", "Uncategorized", "personal", {
      plaidCategory: "Service",
      plaidMerchant: "RETAIL WASH IRVINE CA",
      reviewReason: "missing-category",
      confidence: 0.25,
      aiSuggested: {
        category: "Auto / Car Maintenance",
        intent: "personal",
        confidence: 0.72,
        reason: "Car wash merchant needs confirmation before trusting the category."
      }
    }),
    txn("t42", 13, "Retail Wash", -21, "a6", "Auto / Car Maintenance", "personal", {
      plaidCategory: "Service",
      plaidMerchant: "RETAIL WASH #102",
      reviewReason: "low-confidence",
      confidence: 0.65,
      aiSuggested: {
        category: "Auto / Car Maintenance",
        intent: "personal",
        confidence: 0.7,
        reason: "Similar Retail Wash rows usually belong in car maintenance."
      }
    }),
    txn("t43", 16, "ACH TRANSFER UNKNOWN", -350, "a1", "Transfer", "transfer", {
      plaidCategory: "Transfer",
      plaidMerchant: "ACH WEB TRANSFER",
      reviewReason: "unclear-transfer",
      confidence: 0.52,
      aiSuggested: {
        intent: "transfer",
        confidence: 0.58,
        reason: "Transfer wording is present, but there is no obvious matching account pair yet."
      }
    }),
    txn("t44", 26, "Apple iCloud", -2.99, "a6", "Software / SaaS", "personal", {
      plaidCategory: "Service",
      plaidMerchant: "APPLE.COM/BILL ICLOUD",
      reviewReason: "recurring-candidate",
      confidence: 0.68,
      aiSuggested: {
        recurring: true,
        confidence: 0.75,
        reason: "Small repeat Apple charge looks like a subscription candidate."
      }
    }),
    txn("t45", 16, "Venmo - Chris L.", 60, "a1", "Transfer", "personal", {
      plaidCategory: "Transfer",
      plaidMerchant: "VENMO CASHOUT CHRIS L",
      confidence: 0.91
    })
  ];

  const rng = seededRandom(273);
  const merchants: Array<[string, number, string, Intent]> = [
    ["Sweetgreen", -17, "Food / Restaurants", "personal"],
    ["Anthropic", -20, "Software / AI Tools", "business"],
    ["Cursor", -20, "Software / AI Tools", "business"],
    ["Equinox", -260, "Health / Fitness", "personal"],
    ["Uber", -22, "Transport / Rideshare", "personal"],
    ["Spotify", -11.99, "Software / SaaS", "personal"],
    ["Trader Joe's", -68, "Groceries", "personal"],
    ["Whole Foods", -94, "Groceries", "personal"],
    ["OpenAI", -20, "Software / AI Tools", "business"],
    ["Vercel", -20, "Software / Hosting", "business"],
    ["Linear", -16, "Software / SaaS", "business"],
    ["Figma", -15, "Software / SaaS", "business"],
    ["Notion", -10, "Software / SaaS", "business"],
    ["GitHub", -4, "Software / SaaS", "business"],
    ["Amazon", -45, "Shopping", "personal"],
    ["Joe's Pizza", -16, "Food / Restaurants", "personal"],
    ["Lyft", -19, "Transport / Rideshare", "personal"],
    ["CVS Pharmacy", -22, "Health / Pharmacy", "personal"],
    ["Retail Wash", -19, "Auto / Car Maintenance", "personal"],
    ["Brooklyn Bagel", -9, "Food / Restaurants", "personal"],
    ["PAYROLL DEPOSIT", 6850, "Income", "personal"],
    ["NYC Rent", -2400, "Housing", "personal"]
  ];

  let nextId = 46;
  for (let day = 35; day <= 360; day += 1) {
    if (rng() < 0.57) continue;
    const [merchant, base, category, intent] = merchants[Math.floor(rng() * merchants.length)];
    const jitter = (rng() - 0.5) * Math.abs(base) * 0.22;
    const amount = money(base + jitter);
    const account = merchant === "PAYROLL DEPOSIT" || merchant === "NYC Rent"
      ? "a1"
      : rng() < 0.68
        ? "a5"
        : (["a6", "a7", "a8"] as const)[Math.floor(rng() * 3)];
    txns.push(txn(`t${nextId++}`, day, merchant, amount, account, category, intent, {
      recurring: ["Anthropic", "Cursor", "Equinox", "Spotify", "OpenAI", "Vercel", "Linear", "Figma", "Notion", "GitHub", "PAYROLL DEPOSIT", "NYC Rent"].includes(merchant)
    }));
  }

  const recurring: RecurringExpense[] = [
    { id: "r1", merchant: "Equinox", amount: 260, cadence: "monthly", category: "Health / Fitness", nextDate: 8, lastAmount: 260, status: "active" },
    { id: "r2", merchant: "Anthropic", amount: 20, cadence: "monthly", category: "Software / AI Tools", nextDate: 8, lastAmount: 20, status: "active" },
    { id: "r3", merchant: "Cursor", amount: 20, cadence: "monthly", category: "Software / AI Tools", nextDate: 6, lastAmount: 20, status: "active" },
    { id: "r4", merchant: "Vercel", amount: 20, cadence: "monthly", category: "Software / Hosting", nextDate: 5, lastAmount: 20, status: "active" },
    { id: "r5", merchant: "Linear", amount: 16, cadence: "monthly", category: "Software / SaaS", nextDate: 7, lastAmount: 16, status: "active" },
    { id: "r6", merchant: "OpenAI", amount: 20, cadence: "monthly", category: "Software / AI Tools", nextDate: 11, lastAmount: 20, status: "active" },
    { id: "r7", merchant: "Spotify", amount: 11.99, cadence: "monthly", category: "Software / SaaS", nextDate: 8, lastAmount: 11.99, status: "active" },
    { id: "r8", merchant: "Notion", amount: 10, cadence: "monthly", category: "Software / SaaS", nextDate: 12, lastAmount: 10, status: "active" },
    { id: "r9", merchant: "Figma", amount: 15, cadence: "monthly", category: "Software / SaaS", nextDate: 17, lastAmount: 15, status: "active" },
    { id: "r10", merchant: "GitHub", amount: 4, cadence: "monthly", category: "Software / SaaS", nextDate: 20, lastAmount: 4, status: "active" },
    { id: "r11", merchant: "Substack", amount: 8, cadence: "monthly", category: "Software / SaaS", nextDate: 30, lastAmount: 8, status: "pending", new: true }
  ];

  const trend: NetWorthPoint[] = [];
  let netWorth = 78000;
  const trendRng = seededRandom(971);
  for (let i = 365; i >= 0; i -= 1) {
    netWorth += (trendRng() - 0.45) * 500 + 65;
    trend.push({ d: i, v: Math.round(netWorth) });
  }
  trend[trend.length - 1].v = Math.round(accounts.reduce((sum, account) => sum + account.balance, 0));

  return {
    accounts,
    txns: txns.sort((a, b) => b.date.localeCompare(a.date)),
    recurring,
    trend
  };
})();
