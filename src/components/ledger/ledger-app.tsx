"use client";

import { PlaidConnectionPanel } from "@/components/plaid/plaid-connection-panel";
import {
  ArrowRight,
  ArrowUp,
  Bolt,
  Check,
  ChevronDown,
  ChevronRight,
  Flag,
  Inbox,
  LogOut,
  Plus,
  Repeat,
  Search,
  Sparkles,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  BASE_DATE,
  ledgerData,
  type Intent,
  type LedgerAccount,
  type LedgerTransaction,
  type ReviewReason,
  type TransactionSplit
} from "./data";

export type LedgerRoute = "dashboard" | "transactions" | "review" | "recurring" | "accounts" | "settings";
type Period = "week" | "month" | "year";

interface LedgerContext {
  txns: LedgerTransaction[];
  updateTxn: (id: string, patch: Partial<LedgerTransaction>) => void;
  setP2pModal: (txn: LedgerTransaction) => void;
  setSelectedTxn: (id: string) => void;
  setRoute: (route: LedgerRoute) => void;
  reviewItems: LedgerTransaction[];
}

const LedgerDataContext = createContext<LedgerContext | null>(null);

export const ledgerRouteHref: Record<LedgerRoute, string> = {
  dashboard: "/dashboard",
  transactions: "/transactions",
  review: "/review",
  recurring: "/recurring",
  accounts: "/accounts",
  settings: "/settings"
};

const formatMoney = (n: number, opts: { signed?: boolean; compact?: boolean } = {}) => {
  const abs = Math.abs(n);
  const value = opts.compact && abs >= 1000
    ? `${(abs / 1000).toFixed(1)}k`
    : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prefix = opts.signed ? (n >= 0 ? "+$" : "-$") : n < 0 ? "-$" : "$";
  return `${prefix}${value}`;
};

const accountById = (id: string) => ledgerData.accounts.find((account) => account.id === id);

const dayLabel = (iso: string) => {
  const date = new Date(`${iso}T12:00:00`);
  const today = new Date(BASE_DATE);
  today.setHours(0, 0, 0, 0);
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - normalized.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const reasonLabel = (reason: ReviewReason | null) => {
  if (!reason) return "Review";
  return {
    venmo: "Peer-to-peer",
    large: "Large",
    "transfer-pair": "Transfer?",
    "new-recurring": "New recurring?",
    "low-confidence": "Unsure"
  }[reason];
};

const reasonExplanation = (reason: ReviewReason | null) => {
  if (!reason) return "Needs review";
  return {
    venmo: "Peer-to-peer payment. Ledger needs to know what this was actually for.",
    large: "Larger than typical for this category. Confirm the label is right.",
    "transfer-pair": "Looks like a transfer between your accounts. Exclude from spending?",
    "new-recurring": "Charged more than once. Should Ledger track it as recurring?",
    "low-confidence": "The suggestion is low confidence and needs a human check."
  }[reason];
};

export function LedgerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [selectedTxn, setSelectedTxn] = useState<string | null>(null);
  const [p2pModal, setP2pModal] = useState<LedgerTransaction | null>(null);
  const [txns, setTxns] = useState(ledgerData.txns);

  const updateTxn = useCallback((id: string, patch: Partial<LedgerTransaction>) => {
    setTxns((prev) => prev.map((txn) => (txn.id === id ? { ...txn, ...patch } : txn)));
  }, []);

  const setRoute = useCallback((route: LedgerRoute) => {
    router.push(ledgerRouteHref[route]);
  }, [router]);

  const reviewItems = useMemo(
    () => txns
      .filter((txn) => txn.reviewReason)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    [txns]
  );

  const ctx: LedgerContext = {
    txns,
    updateTxn,
    setP2pModal,
    setSelectedTxn,
    reviewItems,
    setRoute
  };

  const selected = selectedTxn ? txns.find((txn) => txn.id === selectedTxn) : null;

  return (
    <LedgerDataContext.Provider value={ctx}>
      {children}
      {p2pModal && <P2PModal txn={p2pModal} onClose={() => setP2pModal(null)} ctx={ctx} />}
      {selected && <TxnDetail txn={selected} onClose={() => setSelectedTxn(null)} ctx={ctx} />}
    </LedgerDataContext.Provider>
  );
}

export function useLedger() {
  const ctx = useContext(LedgerDataContext);

  if (!ctx) {
    throw new Error("useLedger must be used inside LedgerProvider.");
  }

  return ctx;
}

export function LedgerApp({ route }: { route: LedgerRoute }) {
  const ctx = useLedger();

  if (route === "dashboard") return <TodayView ctx={ctx} />;
  if (route === "transactions") return <TransactionsView ctx={ctx} />;
  if (route === "review") return <ReviewView ctx={ctx} />;
  if (route === "recurring") return <RecurringView />;
  if (route === "accounts") return <AccountsView />;
  return <SettingsView ctx={ctx} />;
}

function TodayView({ ctx }: { ctx: LedgerContext }) {
  const [period, setPeriod] = useState<Period>("month");
  const [periodIdx, setPeriodIdx] = useState(0);
  const { txns, reviewItems, setRoute, setP2pModal } = ctx;

  const cash = sumAccounts("depository");
  const credit = sumAccounts("credit");
  const investments = sumAccounts("investment");
  const retirement = sumAccounts("retirement");
  const netWorth = cash + credit + investments + retirement;

  const currentPeriod = useMemo(() => buildPeriod(period, periodIdx), [period, periodIdx]);
  const previousPeriod = useMemo(() => buildPeriod(period, periodIdx + 1), [period, periodIdx]);

  const periodTxns = useMemo(
    () => spendingTxnsForPeriod(txns, currentPeriod.start, currentPeriod.end),
    [txns, currentPeriod.start, currentPeriod.end]
  );
  const previousTxns = useMemo(
    () => spendingTxnsForPeriod(txns, previousPeriod.start, previousPeriod.end),
    [txns, previousPeriod.start, previousPeriod.end]
  );

  const spent = periodTxns.reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
  const previousSpent = previousTxns.reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
  const delta = previousSpent ? ((spent - previousSpent) / previousSpent) * 100 : 0;
  const categories = categoryTotals(periodTxns);
  const p2pCount = reviewItems.filter((txn) => txn.reviewReason === "venmo").length;

  return (
    <div className="today">
      <section className="hero">
        <div className="hero-left">
          <div className="label">Net worth</div>
          <div className="hero-amount mono">{formatMoney(netWorth)}</div>
          <div className="hero-delta up">
            <ArrowUp size={13} /> $3,247 this month +3.2%
          </div>
        </div>
        <NetWorthSpark />
        <div className="hero-stats">
          <Stat label="Cash" value={cash} />
          <Stat label="Investments" value={investments} />
          <Stat label="Retirement" value={retirement} />
          <Stat label="Credit" value={credit} negative />
        </div>
      </section>

      {reviewItems.length > 0 && (
        <section className="card review-nudge">
          <div className="review-nudge-head">
            <div>
              <div className="card-eyebrow">
                <Inbox size={13} /> Review queue
              </div>
              <div className="card-title">{reviewItems.length} transactions need attention</div>
              <div className="card-sub">Peer-to-peer payments, large charges, and new recurring candidates stay unresolved until you confirm them.</div>
            </div>
            <button className="btn btn-primary" onClick={() => setRoute("review")}>
              Open queue <ArrowRight size={13} />
            </button>
          </div>
          <div className="review-preview">
            {reviewItems.slice(0, 4).map((txn) => (
              <button
                key={txn.id}
                className="review-pill"
                onClick={() => (txn.reviewReason === "venmo" ? setP2pModal(txn) : setRoute("review"))}
              >
                <span className={`reason-dot reason-${txn.reviewReason}`} />
                <span className="rp-merchant">{txn.merchant}</span>
                <span className="rp-reason">{reasonLabel(txn.reviewReason)}</span>
                <span className="rp-amount mono">{formatMoney(txn.amount)}</span>
              </button>
            ))}
            {reviewItems.length > 4 ? <div className="review-pill more">+{reviewItems.length - 4} more</div> : null}
          </div>
        </section>
      )}

      <div className="today-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-eyebrow">Spending - {currentPeriod.label}</div>
              <div className="card-title mono">{formatMoney(spent)}</div>
              <div className="card-sub">
                {previousSpent > 0 ? (
                  <>
                    <span className={delta >= 0 ? "delta-up" : "delta-down"}>
                      {delta >= 0 ? "Up" : "Down"} {Math.abs(delta).toFixed(0)}%
                    </span>{" "}
                    vs. {previousPeriod.shortLabel} ({formatMoney(previousSpent)}) - excluding transfers
                  </>
                ) : (
                  "Excluding transfers and credit card payments"
                )}
              </div>
            </div>
            <PeriodPicker
              period={period}
              setPeriod={(next) => {
                setPeriod(next);
                setPeriodIdx(0);
              }}
              periodIdx={periodIdx}
              setPeriodIdx={setPeriodIdx}
            />
          </div>
          <SpendBars txns={periodTxns} period={period} start={currentPeriod.start} end={currentPeriod.end} />
          <div className="cat-list">
            {categories.length === 0 ? <div className="empty-mini">No spending in this period.</div> : null}
            {categories.slice(0, 6).map(([category, value]) => (
              <div className="cat-row" key={category}>
                <div className="cat-bar">
                  <div className="cat-bar-fill" style={{ width: `${(value / categories[0][1]) * 100}%` }} />
                </div>
                <div className="cat-name">{category}</div>
                <div className="cat-amt mono">{formatMoney(value)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-eyebrow">
              <Sparkles size={13} /> Insights
            </div>
          </div>
          <div className="insights">
            <Insight tone="warn" title="Substack looks like a new subscription" body="Charged $8.00 in April and May. Confirm it as recurring." action="Mark recurring" />
            <Insight tone="info" title="Software costs are up 18%" body="Anthropic, Cursor, OpenAI, Vercel, Linear, GitHub, Notion, and Figma are clustered in one spend bucket." action="See breakdown" />
            <Insight tone="warn" title={`${p2pCount} peer-to-peer payments need explanation`} body="Explain the real category before these totals become trusted." action="Resolve" />
            <Insight tone="ok" title="Food is below the usual run rate" body="$214 spent against a $400 typical month." />
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div className="card-title-sm">Recent activity</div>
          <button className="btn-ghost" onClick={() => setRoute("transactions")}>
            See all <ChevronRight size={13} />
          </button>
        </div>
        <TxnList txns={txns.slice(0, 8)} ctx={ctx} compact />
      </section>
    </div>
  );
}

function sumAccounts(type: LedgerAccount["type"]) {
  return ledgerData.accounts.filter((account) => account.type === type).reduce((sum, account) => sum + account.balance, 0);
}

function spendingTxnsForPeriod(txns: LedgerTransaction[], start: Date, end: Date) {
  return txns.filter((txn) => {
    const date = new Date(`${txn.date}T12:00:00`);
    return date >= start && date < end && txn.amount < 0 && txn.intent !== "transfer";
  });
}

function categoryTotals(txns: LedgerTransaction[]) {
  const totals = new Map<string, number>();
  txns.forEach((txn) => {
    const category = txn.category.split(" / ")[0];
    totals.set(category, (totals.get(category) ?? 0) + Math.abs(txn.amount));
  });
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function buildPeriod(period: Period, idx: number) {
  const now = new Date(BASE_DATE);
  if (period === "week") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay() - idx * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const finalDay = new Date(end.getTime() - 86_400_000);
    const label = idx === 0 ? "This week" : idx === 1 ? "Last week" : `Week of ${formatShortDate(start)}`;
    return { start, end, label, shortLabel: `${formatShortDate(start)}-${formatShortDate(finalDay)}` };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth() - idx, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const label = start.toLocaleDateString("en-US", { month: "long", year: start.getFullYear() === now.getFullYear() ? undefined : "numeric" });
    return { start, end, label, shortLabel: start.toLocaleDateString("en-US", { month: "short", year: "numeric" }) };
  }
  const start = new Date(now.getFullYear() - idx, 0, 1);
  const end = new Date(start.getFullYear() + 1, 0, 1);
  const label = idx === 0 ? `${start.getFullYear()} YTD` : `${start.getFullYear()}`;
  return { start, end, label, shortLabel: `${start.getFullYear()}` };
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function PeriodPicker({
  period,
  setPeriod,
  periodIdx,
  setPeriodIdx
}: {
  period: Period;
  setPeriod: (period: Period) => void;
  periodIdx: number;
  setPeriodIdx: (idx: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const options = useMemo(() => {
    const count = period === "year" ? 4 : 12;
    return Array.from({ length: count }, (_, idx) => {
      const built = buildPeriod(period, idx);
      return {
        idx,
        label: built.label,
        sub: period === "week" ? built.shortLabel : period === "year" && idx === 0 ? "Year to date" : built.shortLabel
      };
    });
  }, [period]);
  const current = options.find((option) => option.idx === periodIdx) ?? options[0];

  return (
    <div className="period-picker" ref={ref}>
      <div className="seg" role="tablist" aria-label="Spending period">
        {(["week", "month", "year"] as const).map((option) => (
          <button key={option} className={`seg-btn ${period === option ? "active" : ""}`} onClick={() => setPeriod(option)}>
            {option}
          </button>
        ))}
      </div>
      <div className="period-nav">
        <button className="period-step prev" onClick={() => setPeriodIdx(Math.min(options.length - 1, periodIdx + 1))} title="Previous period">
          <ChevronRight size={13} />
        </button>
        <button className={`period-current ${open ? "open" : ""}`} onClick={() => setOpen((value) => !value)}>
          {current.label}
          <ChevronDown size={12} />
        </button>
        <button className="period-step next" onClick={() => setPeriodIdx(Math.max(0, periodIdx - 1))} disabled={periodIdx === 0} title="Next period">
          <ChevronRight size={13} />
        </button>
        {open ? (
          <div className="period-dropdown">
            {options.map((option) => (
              <button
                key={option.idx}
                className={`period-opt ${option.idx === periodIdx ? "active" : ""}`}
                onClick={() => {
                  setPeriodIdx(option.idx);
                  setOpen(false);
                }}
              >
                <span className="po-label">{option.label}</span>
                <span className="po-sub">{option.sub}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-val mono ${negative ? "neg" : ""}`}>{formatMoney(value, { compact: true })}</div>
    </div>
  );
}

function NetWorthSpark() {
  const trend = ledgerData.trend;
  const max = Math.max(...trend.map((point) => point.v));
  const min = Math.min(...trend.map((point) => point.v));
  const width = 540;
  const height = 100;
  const points = trend.map((point, index) => {
    const x = (index / (trend.length - 1)) * width;
    const y = height - ((point.v - min) / (max - min)) * height;
    return [x, y] as const;
  });
  const line = points.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <div className="spark">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Net worth trend">
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ink)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--ink)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkFill)" />
        <path d={line} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      </svg>
      <div className="spark-axis">
        <span>90d ago</span>
        <span>60d</span>
        <span>30d</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function SpendBars({ txns, period, start, end }: { txns: LedgerTransaction[]; period: Period; start: Date; end: Date }) {
  const buckets = useMemo(() => {
    if (period === "week") {
      return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        return { key: date.toISOString().slice(0, 10), label: date.toLocaleDateString("en-US", { weekday: "short" }), value: 0 };
      });
    }
    if (period === "month") {
      const days = new Date(end.getTime() - 86_400_000).getDate();
      return Array.from({ length: days }, (_, index) => {
        const date = new Date(start.getFullYear(), start.getMonth(), index + 1);
        return { key: date.toISOString().slice(0, 10), label: String(index + 1), value: 0 };
      });
    }
    return Array.from({ length: 12 }, (_, index) => ({ key: String(index), label: new Date(start.getFullYear(), index, 1).toLocaleDateString("en-US", { month: "short" }), value: 0 }));
  }, [period, start, end]);

  txns.forEach((txn) => {
    const key = period === "year" ? String(new Date(`${txn.date}T12:00:00`).getMonth()) : txn.date;
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) bucket.value += Math.abs(txn.amount);
  });

  const max = Math.max(...buckets.map((bucket) => bucket.value), 100);

  return (
    <div className={`bars period-${period}`}>
      {buckets.map((bucket) => (
        <div key={bucket.key} className="bar-wrap" title={`${bucket.label}: ${formatMoney(bucket.value)}`}>
          <div className="bar" style={{ height: `${(bucket.value / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

function Insight({ tone, title, body, action }: { tone: "warn" | "info" | "ok"; title: string; body: string; action?: string }) {
  const Icon = tone === "warn" ? Flag : tone === "info" ? Bolt : Check;
  return (
    <div className={`insight tone-${tone}`}>
      <div className="insight-icon">
        <Icon size={15} />
      </div>
      <div className="insight-body">
        <div className="insight-title">{title}</div>
        <div className="insight-text">{body}</div>
        {action ? <button className="insight-action">{action}</button> : null}
      </div>
    </div>
  );
}

function TransactionsView({ ctx }: { ctx: LedgerContext }) {
  const { txns } = ctx;
  const [filter, setFilter] = useState({ q: "", account: "all", intent: "all", cat: "all" });
  const categories = useMemo(() => [...new Set(txns.map((txn) => txn.category.split(" / ")[0]))].sort(), [txns]);

  const filtered = useMemo(() => txns.filter((txn) => {
    if (filter.q && !`${txn.merchant} ${txn.note}`.toLowerCase().includes(filter.q.toLowerCase())) return false;
    if (filter.account !== "all" && txn.account !== filter.account) return false;
    if (filter.intent !== "all" && txn.intent !== filter.intent) return false;
    if (filter.cat !== "all" && !txn.category.startsWith(filter.cat)) return false;
    return true;
  }), [txns, filter]);

  const totalOut = filtered.filter((txn) => txn.amount < 0 && txn.intent !== "transfer").reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
  const totalIn = filtered.filter((txn) => txn.amount > 0 && txn.intent !== "transfer").reduce((sum, txn) => sum + txn.amount, 0);

  return (
    <div className="txns-view">
      <div className="filter-bar">
        <label className="search inline">
          <Search size={14} />
          <input placeholder="Search merchant or note..." value={filter.q} onChange={(event) => setFilter({ ...filter, q: event.target.value })} />
        </label>
        <Select value={filter.account} onChange={(account) => setFilter({ ...filter, account })} options={[["all", "All accounts"], ...ledgerData.accounts.map((account) => [account.id, account.name] as [string, string])]} />
        <Select value={filter.intent} onChange={(intent) => setFilter({ ...filter, intent })} options={[["all", "All intents"], ["personal", "Personal"], ["business", "Business"], ["shared", "Shared"], ["reimbursable", "Reimbursable"], ["transfer", "Transfer"]]} />
        <Select value={filter.cat} onChange={(cat) => setFilter({ ...filter, cat })} options={[["all", "All categories"], ...categories.map((category) => [category, category] as [string, string])]} />
        <div className="spacer" />
        <div className="totals">
          <span className="totals-out mono">{formatMoney(totalOut)}</span>
          <span className="totals-divider">/</span>
          <span className="totals-in mono">{formatMoney(totalIn, { signed: true })}</span>
        </div>
      </div>

      <div className="txn-table card-flush">
        <div className="txn-th">
          <div>Date</div>
          <div>Merchant</div>
          <div>Category</div>
          <div>Account</div>
          <div>Intent</div>
          <div className="ta-right">Amount</div>
        </div>
        <TxnList txns={filtered} ctx={ctx} />
      </div>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="select">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>{label}</option>
        ))}
      </select>
      <ChevronDown size={13} />
    </label>
  );
}

function TxnList({ txns, ctx, compact }: { txns: LedgerTransaction[]; ctx: LedgerContext; compact?: boolean }) {
  const groups = useMemo(() => {
    const map = new Map<string, LedgerTransaction[]>();
    txns.forEach((txn) => {
      map.set(txn.date, [...(map.get(txn.date) ?? []), txn]);
    });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [txns]);

  return (
    <div className={`txn-list ${compact ? "compact" : ""}`}>
      {groups.map(([date, items]) => (
        <div className="txn-date-group" key={date}>
          <div className="txn-date-row">
            <span>{dayLabel(date)}</span>
            <span className="txn-date-iso">{new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
          </div>
          {items.map((txn) => <TxnRow key={txn.id} txn={txn} ctx={ctx} />)}
        </div>
      ))}
      {txns.length === 0 ? <div className="empty">No transactions match your filters.</div> : null}
    </div>
  );
}

function TxnRow({ txn, ctx }: { txn: LedgerTransaction; ctx: LedgerContext }) {
  const account = accountById(txn.account);
  const isReview = Boolean(txn.reviewReason);
  return (
    <button
      className={`txn-row ${isReview ? "is-review" : ""}`}
      onClick={() => (txn.reviewReason === "venmo" ? ctx.setP2pModal(txn) : ctx.setSelectedTxn(txn.id))}
    >
      <div className="txn-icon">
        <MerchantGlyph merchant={txn.merchant} />
      </div>
      <div className="txn-merchant">
        <div className="txn-name">
          {txn.merchant}
          {txn.recurring ? <span className="tag tag-recur"><Repeat size={10} /> recurring</span> : null}
          {isReview ? <span className={`tag tag-review reason-${txn.reviewReason}`}>{reasonLabel(txn.reviewReason)}</span> : null}
        </div>
        <div className="txn-sub">
          {txn.plaidMerchant !== txn.merchant ? <span className="txn-plaid">{txn.plaidMerchant}</span> : null}
          {txn.note ? <span className="txn-note">{txn.note}</span> : null}
        </div>
      </div>
      <div className="txn-cat">
        <div className="txn-cat-name">{txn.category}</div>
        {txn.aiSuggested?.category ? <div className="ai-diff"><Sparkles size={10} /> suggested</div> : null}
      </div>
      <div className="txn-account"><span className="acc-mask">{account?.name} - {account?.mask}</span></div>
      <div className="txn-intent"><IntentChip intent={txn.intent} /></div>
      <div className={`txn-amount mono ${txn.amount >= 0 ? "pos" : ""}`}>{formatMoney(txn.amount, { signed: txn.amount >= 0 })}</div>
    </button>
  );
}

function MerchantGlyph({ merchant }: { merchant: string }) {
  const peer = /^(Venmo|Zelle|Cash App)/.test(merchant);
  const letter = peer ? merchant[0] : merchant.trim()[0] ?? "?";
  const hue = [...merchant].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0);
  return (
    <div
      className={`mglyph ${peer ? "peer" : ""}`}
      style={peer ? undefined : { background: `oklch(0.92 0.02 ${hue})`, color: `oklch(0.35 0.04 ${hue})` }}
    >
      {letter.toUpperCase()}
    </div>
  );
}

function IntentChip({ intent }: { intent?: Intent }) {
  if (!intent) return <span className="chip chip-empty">set</span>;
  return <span className={`chip chip-${intent}`}>{intent}</span>;
}

function ReviewView({ ctx }: { ctx: LedgerContext }) {
  const { reviewItems, updateTxn } = ctx;
  const [activeId, setActiveId] = useState<string | null>(reviewItems[0]?.id ?? null);
  const active = reviewItems.find((txn) => txn.id === activeId) ?? reviewItems[0] ?? null;

  const groups = useMemo(() => {
    const map = new Map<ReviewReason, LedgerTransaction[]>();
    reviewItems.forEach((txn) => {
      if (!txn.reviewReason) return;
      map.set(txn.reviewReason, [...(map.get(txn.reviewReason) ?? []), txn]);
    });
    return [...map.entries()];
  }, [reviewItems]);

  const dismiss = (txn: LedgerTransaction) => updateTxn(txn.id, { reviewReason: null });
  const acceptAI = (txn: LedgerTransaction) => {
    updateTxn(txn.id, {
      reviewReason: null,
      category: txn.aiSuggested?.category ?? txn.category,
      intent: txn.aiSuggested?.intent ?? txn.intent,
      recurring: txn.aiSuggested?.recurring ?? txn.recurring
    });
  };

  return (
    <div className="review-view">
      <aside className="review-list">
        <div className="review-list-head">
          <span>{reviewItems.length} items</span>
          <span className="review-shortcuts">Review inbox</span>
        </div>
        {groups.map(([reason, items]) => (
          <div className="review-group" key={reason}>
            <div className="review-group-head">
              <span className={`reason-dot reason-${reason}`} />
              {reasonLabel(reason)} - {items.length}
            </div>
            {items.map((txn) => (
              <button key={txn.id} className={`review-item ${active?.id === txn.id ? "active" : ""}`} onClick={() => setActiveId(txn.id)}>
                <span className="ri-top">
                  <span className="ri-merchant">{txn.merchant}</span>
                  <span className="ri-amt mono">{formatMoney(txn.amount)}</span>
                </span>
                <span className="ri-bottom">
                  <span>{dayLabel(txn.date)}</span>
                  <span className="ri-conf">
                    <span className="conf-bar"><span className="conf-fill" style={{ width: `${txn.confidence * 100}%` }} /></span>
                    <span>{Math.round(txn.confidence * 100)}%</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
        {reviewItems.length === 0 ? (
          <div className="review-done">
            <div className="rd-mark">OK</div>
            <div className="rd-title">Inbox zero</div>
            <div className="rd-sub">Every transaction has been reviewed. Your dashboard totals are trusted.</div>
          </div>
        ) : null}
      </aside>
      <section className="review-detail">
        {active ? <ReviewDetail txn={active} onDismiss={dismiss} onAccept={acceptAI} ctx={ctx} /> : <div className="empty-state">Select a transaction</div>}
      </section>
    </div>
  );
}

function ReviewDetail({
  txn,
  onDismiss,
  onAccept,
  ctx
}: {
  txn: LedgerTransaction;
  onDismiss: (txn: LedgerTransaction) => void;
  onAccept: (txn: LedgerTransaction) => void;
  ctx: LedgerContext;
}) {
  const account = accountById(txn.account);
  return (
    <div className="rd">
      <div className="rd-head">
        <div className={`reason-banner reason-${txn.reviewReason}`}>
          <Flag size={13} />
          <span>{reasonExplanation(txn.reviewReason)}</span>
        </div>
      </div>
      <div className="rd-merchant">
        <MerchantGlyph merchant={txn.merchant} />
        <div>
          <div className="rd-name">{txn.merchant}</div>
          <div className="rd-meta">
            <span>{new Date(`${txn.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
            <span>{account?.name} - {account?.mask}</span>
          </div>
        </div>
        <div className="rd-amount mono">{formatMoney(txn.amount)}</div>
      </div>
      <div className="rd-diff">
        <div className="rd-diff-col">
          <div className="rd-diff-label">Raw from {account?.institution}</div>
          <DiffRow label="Merchant" value={txn.plaidMerchant} />
          <DiffRow label="Category" value={txn.plaidCategory} />
          <DiffRow label="Amount" value={formatMoney(txn.amount)} mono />
        </div>
        <div className="rd-diff-arrow"><ArrowRight size={15} /></div>
        <div className="rd-diff-col enriched">
          <div className="rd-diff-label"><Sparkles size={12} /> Suggested</div>
          <DiffRow label="Merchant" value={txn.merchant} />
          <DiffRow label="Category" value={txn.aiSuggested?.category ?? txn.category} />
          <div className="rd-diff-row">
            <span className="dl">Intent</span>
            <span className="dv"><IntentChip intent={txn.aiSuggested?.intent ?? txn.intent} /></span>
          </div>
          {txn.aiSuggested?.recurring !== undefined ? <DiffRow label="Recurring" value="Yes - monthly" /> : null}
        </div>
      </div>
      {txn.aiSuggested?.reason ? (
        <div className="rd-reason">
          <Sparkles size={13} /> {txn.aiSuggested.reason}
        </div>
      ) : null}
      <div className="rd-actions">
        {txn.reviewReason === "venmo" ? (
          <>
            <button className="btn btn-primary" onClick={() => ctx.setP2pModal(txn)}>
              <Sparkles size={14} /> Explain and split
            </button>
            <button className="btn" onClick={() => onDismiss(txn)}>Skip</button>
          </>
        ) : (
          <>
            <button className="btn btn-primary" onClick={() => onAccept(txn)}>
              <Check size={14} /> Accept suggestion
            </button>
            <button className="btn" onClick={() => ctx.setSelectedTxn(txn.id)}>Edit manually</button>
            <button className="btn-ghost" onClick={() => onDismiss(txn)}>Dismiss</button>
          </>
        )}
      </div>
      <div className="rd-history">
        <div className="rh-label">History at {txn.merchant}</div>
        <div className="rh-rows">
          <div className="rh-row"><span>Recent amounts</span><span className="mono">$20.00 / $20.00 / $20.00</span></div>
          <div className="rh-row"><span>Usual category</span><span>{txn.category}</span></div>
          <div className="rh-row"><span>Usual intent</span><span><IntentChip intent={txn.intent} /></span></div>
        </div>
      </div>
    </div>
  );
}

function DiffRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rd-diff-row">
      <span className="dl">{label}</span>
      <span className={`dv ${mono ? "mono" : ""}`}>{value}</span>
    </div>
  );
}

function P2PModal({ txn, onClose, ctx }: { txn: LedgerTransaction; onClose: () => void; ctx: LedgerContext }) {
  const [explanation, setExplanation] = useState(txn.note || "");
  const [parsed, setParsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const total = Math.abs(txn.amount);
  const [splits, setSplits] = useState<TransactionSplit[]>([
    { id: "s1", label: "My share", intent: "personal", category: "Uncategorized", amount: total }
  ]);
  const allocated = splits.reduce((sum, split) => sum + split.amount, 0);
  const remaining = total - allocated;

  const parseExplanation = () => {
    setLoading(true);
    window.setTimeout(() => {
      const text = explanation.toLowerCase();
      const reimbMatch = text.match(/reimbursed\s+\$?(\d+(\.\d+)?)/);
      if (text.includes("dinner") || text.includes("food") || text.includes("lunch")) {
        const reimbursed = reimbMatch ? Number.parseFloat(reimbMatch[1]) : Math.round((total * 0.62) * 100) / 100;
        setSplits([
          { id: "s1", label: "My share - food", intent: "personal", category: "Food / Restaurants", amount: Math.max(0, total - reimbursed) },
          { id: "s2", label: "Covered for friends", intent: "reimbursable", category: "Food / Restaurants", amount: reimbursed }
        ]);
      } else if (text.includes("uber") || text.includes("lyft") || text.includes("ride")) {
        setSplits([{ id: "s1", label: "Shared ride", intent: "shared", category: "Transport / Rideshare", amount: total }]);
      } else if (text.includes("rent")) {
        setSplits([{ id: "s1", label: "Rent", intent: "personal", category: "Housing", amount: total }]);
      } else {
        setSplits([{ id: "s1", label: "Personal", intent: "personal", category: "Uncategorized", amount: total }]);
      }
      setParsed(true);
      setLoading(false);
    }, 500);
  };

  const updateSplit = (id: string, patch: Partial<TransactionSplit>) => {
    setSplits((prev) => prev.map((split) => (split.id === id ? { ...split, ...patch } : split)));
  };
  const addSplit = () => {
    setSplits((prev) => [...prev, { id: `s${Date.now()}`, label: "New portion", intent: "personal", category: "Uncategorized", amount: Math.max(0, remaining) }]);
  };
  const removeSplit = (id: string) => setSplits((prev) => prev.filter((split) => split.id !== id));
  const save = () => {
    ctx.updateTxn(txn.id, {
      reviewReason: null,
      note: explanation,
      split: splits,
      intent: splits[0]?.intent ?? txn.intent,
      category: splits[0]?.category ?? txn.category
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p2p-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-eyebrow"><Sparkles size={12} /> Resolve peer-to-peer</div>
            <div className="modal-title">{txn.merchant}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
        <div className="modal-body">
          <div className="vm-summary">
            <div>
              <div className="vm-label">Date</div>
              <div className="vm-val">{new Date(`${txn.date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</div>
            </div>
            <div>
              <div className="vm-label">Amount</div>
              <div className="vm-val mono big">{formatMoney(txn.amount)}</div>
            </div>
            <div>
              <div className="vm-label">Raw merchant</div>
              <div className="vm-val">{txn.plaidMerchant}</div>
            </div>
          </div>
          <div className="vm-section">
            <label className="vm-section-label" htmlFor="p2p-explanation">
              <Sparkles size={12} /> What was this for?
            </label>
            <textarea
              id="p2p-explanation"
              className="vm-textarea"
              placeholder="Example: Dinner with friends, I paid $90 and was reimbursed $60"
              rows={3}
              value={explanation}
              onChange={(event) => {
                setExplanation(event.target.value);
                setParsed(false);
              }}
            />
            <div className="vm-input-row">
              <div className="vm-hint">Plain language fills the structured split below.</div>
              <button className="btn btn-primary" onClick={parseExplanation} disabled={!explanation || loading}>
                {loading ? "Parsing..." : parsed ? "Re-parse" : "Parse"} <Sparkles size={12} />
              </button>
            </div>
          </div>
          <div className="vm-section">
            <div className="vm-section-label-row">
              <span className="vm-section-label">Split into portions</span>
              <span className={`vm-remaining ${Math.abs(remaining) < 0.01 ? "ok" : "warn"}`}>
                {Math.abs(remaining) < 0.01 ? "Fully allocated" : `${formatMoney(remaining)} unallocated`}
              </span>
            </div>
            <div className="splits">
              {splits.map((split) => (
                <div className="split-row" key={split.id}>
                  <input className="split-label" value={split.label} onChange={(event) => updateSplit(split.id, { label: event.target.value })} />
                  <Select value={split.intent} onChange={(value) => updateSplit(split.id, { intent: value as Intent })} options={[["personal", "Personal"], ["shared", "Shared"], ["reimbursable", "Reimbursable"], ["business", "Business"], ["transfer", "Transfer"]]} />
                  <input className="split-cat" value={split.category} onChange={(event) => updateSplit(split.id, { category: event.target.value })} />
                  <label className="split-amount">
                    <span className="split-currency">$</span>
                    <input className="mono" type="number" step="0.01" value={split.amount} onChange={(event) => updateSplit(split.id, { amount: Number.parseFloat(event.target.value) || 0 })} />
                  </label>
                  {splits.length > 1 ? <button className="icon-btn" onClick={() => removeSplit(split.id)}><X size={14} /></button> : null}
                </div>
              ))}
            </div>
            <button className="btn-ghost vm-add" onClick={addSplit}><Plus size={13} /> Add another portion</button>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={Math.abs(remaining) > 0.01}>
            <Check size={14} /> Save and resolve
          </button>
        </div>
      </div>
    </div>
  );
}

function TxnDetail({ txn, onClose, ctx }: { txn: LedgerTransaction; onClose: () => void; ctx: LedgerContext }) {
  const account = accountById(txn.account);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal txn-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-eyebrow">Transaction</div>
            <div className="modal-title">{txn.merchant}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
        <div className="modal-body">
          <div className="td-amount mono">{formatMoney(txn.amount)}</div>
          <div className="td-meta">
            <span>{new Date(`${txn.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
            <span>{account?.name}</span>
          </div>
          <div className="td-grid">
            <label className="td-field">
              <span>Category</span>
              <input value={txn.category} onChange={(event) => ctx.updateTxn(txn.id, { category: event.target.value })} />
            </label>
            <label className="td-field">
              <span>Intent</span>
              <Select value={txn.intent} onChange={(value) => ctx.updateTxn(txn.id, { intent: value as Intent })} options={[["personal", "Personal"], ["business", "Business"], ["shared", "Shared"], ["reimbursable", "Reimbursable"], ["transfer", "Transfer"]]} />
            </label>
            <label className="td-field full">
              <span>Note</span>
              <input value={txn.note} onChange={(event) => ctx.updateTxn(txn.id, { note: event.target.value })} placeholder="Add a note..." />
            </label>
          </div>
          <div className="td-raw">
            <div className="td-raw-label">Raw data - Plaid</div>
            <div className="td-raw-rows">
              <div><span>Merchant</span><span>{txn.plaidMerchant}</span></div>
              <div><span>Category</span><span>{txn.plaidCategory}</span></div>
              <div><span>Status</span><span>{txn.status}</span></div>
            </div>
            <div className="td-raw-foot">Original bank data is preserved separately from editable labels.</div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function RecurringView() {
  const active = ledgerData.recurring.filter((item) => item.status === "active");
  const total = active.reduce((sum, item) => sum + item.amount, 0);
  const softwareTotal = ledgerData.recurring
    .filter((item) => item.category.startsWith("Software"))
    .reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="recurring-view">
      <div className="rec-summary">
        <div className="rec-summary-card">
          <div className="rec-eyebrow">Monthly recurring</div>
          <div className="rec-amount mono">{formatMoney(total)}</div>
          <div className="rec-sub">{active.length} active subscriptions</div>
        </div>
        <div className="rec-summary-card">
          <div className="rec-eyebrow">Software / AI tools</div>
          <div className="rec-amount mono">{formatMoney(softwareTotal)}</div>
          <div className="rec-sub">Your largest recurring category</div>
        </div>
        <div className="rec-summary-card warn">
          <div className="rec-eyebrow"><Flag size={12} /> New this month</div>
          <div className="rec-amount mono">$8.00</div>
          <div className="rec-sub">Substack needs confirmation</div>
        </div>
      </div>
      <div className="rec-table card-flush">
        <div className="rec-th">
          <div>Merchant</div>
          <div>Category</div>
          <div>Cadence</div>
          <div>Next charge</div>
          <div className="ta-right">Amount</div>
        </div>
        {ledgerData.recurring.map((item) => {
          const next = new Date(BASE_DATE);
          next.setDate(next.getDate() + item.nextDate);
          return (
            <div key={item.id} className={`rec-row ${item.status === "pending" ? "pending" : ""}`}>
              <div className="rec-merchant">
                <MerchantGlyph merchant={item.merchant} />
                <div>
                  <div className="rec-name">{item.merchant}</div>
                  {item.new ? <span className="tag tag-new">new - needs confirmation</span> : null}
                </div>
              </div>
              <div>{item.category}</div>
              <div className="rec-cad">{item.cadence}</div>
              <div className="rec-next">in {item.nextDate}d <span className="muted">{next.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>
              <div className="ta-right mono">{formatMoney(item.amount)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccountsView() {
  const groups: Array<[string, LedgerAccount[]]> = [
    ["Cash", ledgerData.accounts.filter((account) => account.type === "depository")],
    ["Credit cards", ledgerData.accounts.filter((account) => account.type === "credit")],
    ["Investments", ledgerData.accounts.filter((account) => account.type === "investment")],
    ["Retirement", ledgerData.accounts.filter((account) => account.type === "retirement")]
  ];

  return (
    <div className="accounts-view">
      {groups.map(([label, accounts]) => {
        const total = accounts.reduce((sum, account) => sum + account.balance, 0);
        return (
          <section className="acc-group" key={label}>
            <div className="acc-group-head">
              <h2>{label}</h2>
              <div className="mono">{formatMoney(total)}</div>
            </div>
            <div className="acc-cards">
              {accounts.map((account) => (
                <div className="acc-card" key={account.id}>
                  <div className="acc-head">
                    <div>{account.institution}</div>
                    <div className="acc-mask">....{account.mask}</div>
                  </div>
                  <div className="acc-name">{account.name}</div>
                  <div className={`acc-balance mono ${account.balance < 0 ? "neg" : ""}`}>{formatMoney(account.balance)}</div>
                  {account.limit ? <div className="acc-limit">of {formatMoney(account.limit)} limit - {Math.round(Math.abs(account.balance) / account.limit * 100)}% utilized</div> : null}
                  <div className="acc-foot">Synced 2m ago</div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SettingsView({ ctx }: { ctx: LedgerContext }) {
  const connectedCount = ledgerData.accounts.length;
  const recurringCount = ledgerData.recurring.filter((item) => item.status === "active").length;
  const pendingReviewCount = ctx.reviewItems.length;
  const spendingTxns = ctx.txns.filter((txn) => txn.amount < 0 && txn.intent !== "transfer").length;

  return (
    <div className="settings-view">
      <section className="settings-panel">
        <div className="settings-panel-head">
          <div>
            <div className="card-eyebrow">Workspace</div>
            <div className="settings-title">Personal Ledger</div>
          </div>
          <span className="settings-pill">Mock data</span>
        </div>
        <div className="settings-grid">
          <SettingMetric label="Connected accounts" value={String(connectedCount)} />
          <SettingMetric label="Recurring items" value={String(recurringCount)} />
          <SettingMetric label="Review queue" value={String(pendingReviewCount)} />
          <SettingMetric label="Spend records" value={String(spendingTxns)} />
        </div>
      </section>

      <PlaidConnectionPanel />

      <section className="settings-panel">
        <div className="settings-panel-head">
          <div>
            <div className="card-eyebrow">Review rules</div>
            <div className="settings-title">Navigation guardrails</div>
          </div>
        </div>
        <div className="settings-list">
          <SettingToggle label="Flag peer-to-peer transfers" detail="Venmo, Zelle, and Cash App stay in review until explained." checked />
          <SettingToggle label="Flag large charges" detail="Unusual transaction amounts are held out of trusted totals." checked />
          <SettingToggle label="Detect new recurring charges" detail="Repeated merchants can be confirmed before joining the recurring list." checked />
        </div>
      </section>

      <section className="settings-panel">
        <div className="settings-panel-head">
          <div>
            <div className="card-eyebrow">Session</div>
            <div className="settings-title">Access</div>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Supabase Auth</div>
            <div className="settings-row-sub">The app shell is protected by the existing proxy middleware.</div>
          </div>
          <form action="/login/logout" method="post">
            <button className="btn" type="submit">
              <LogOut size={14} /> Sign out
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function SettingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="setting-metric">
      <div className="stat-label">{label}</div>
      <div className="setting-metric-value mono">{value}</div>
    </div>
  );
}

function SettingToggle({ label, detail, checked }: { label: string; detail: string; checked?: boolean }) {
  return (
    <label className="setting-toggle">
      <span className="setting-toggle-copy">
        <span className="settings-row-title">{label}</span>
        <span className="settings-row-sub">{detail}</span>
      </span>
      <span className="switch" aria-hidden>
        <input defaultChecked={checked} disabled type="checkbox" />
        <span />
      </span>
    </label>
  );
}
