import { PlaidConnectionPanel } from "@/components/plaid/plaid-connection-panel";
import type {
  AccountRecord,
  CategoryRecord,
  MerchantRuleRow,
  RecurringExpenseRecord,
  ReviewQueueItem,
  TransactionRecord
} from "@/lib/db";
import type { AiProviderStatus } from "@/lib/ai/server";
import type { PlaidConnectionSummary, PlaidPersistedSyncRunSummary } from "@/lib/plaid/service";
import { buildSpendingInsightSummary, transactionSpendingAmount } from "@/lib/finance/spending";
import { buildFirstRunChecklist, type FirstRunChecklistItem } from "@/lib/settings/first-run-checklist";
import { ArrowRight, BrainCircuit, CheckCircle2, Circle, Clock3, Database, GitBranch, LogOut, Repeat, ShieldCheck, SlidersHorizontal, TriangleAlert, WalletCards, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { CategoryManager, type CategorySpendingRow } from "./category-manager";
import styles from "./settings.module.css";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

interface SettingsViewProps {
  accounts: AccountRecord[];
  aiProviderStatus: AiProviderStatus;
  categories: CategoryRecord[];
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
  latestPlaidSyncRun: PlaidPersistedSyncRunSummary | null;
  merchantRules: MerchantRuleRow[];
  plaidConnections: PlaidConnectionSummary[];
  recurringExpenses: RecurringExpenseRecord[];
  reviewItems: ReviewQueueItem[];
  transactions: TransactionRecord[];
}

function SettingMetric({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className={styles.metric}>
      <span>
        <Icon size={13} aria-hidden />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingToggle({ checked, detail, label }: { checked: boolean; detail: string; label: string }) {
  return (
    <div className={styles.settingRow}>
      <div>
        <div className={styles.settingTitle}>{label}</div>
        <div className={styles.settingSub}>{detail}</div>
      </div>
      <span className={`${styles.toggle} ${checked ? styles.toggleOn : ""}`} aria-hidden>
        <span />
      </span>
    </div>
  );
}

function formatSyncDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  });
}

function formatSource(source: PlaidPersistedSyncRunSummary["source"]) {
  if (source === "initial") return "Initial";
  if (source === "scheduled") return "Scheduled";
  return "Manual";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function categoryTransactionsHref(categoryId: string | null, categoryName: string) {
  const params = new URLSearchParams({ exclude_transfers: "1" });
  if (categoryId) {
    params.set("category", categoryId);
  } else {
    params.set("q", categoryName);
  }
  return `/transactions?${params.toString()}`;
}

function buildCategorySpendingRows(
  categories: CategoryRecord[],
  transactions: TransactionRecord[],
  fromDate: string,
  toDate: string
): CategorySpendingRow[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const rowsByKey = new Map<string, CategorySpendingRow>();

  categories.forEach((category) => {
    rowsByKey.set(category.id, {
      amount: 0,
      categoryId: category.id,
      categoryName: category.name,
      color: category.color,
      count: 0,
      href: categoryTransactionsHref(category.id, category.name)
    });
  });

  transactions.forEach((transaction) => {
    if (transaction.date < fromDate || transaction.date > toDate) return;
    const amount = transactionSpendingAmount(transaction);
    if (amount <= 0) return;

    const category = transaction.categoryId ? categoryById.get(transaction.categoryId) : null;
    const categoryName = category?.name ?? transaction.category;
    const categoryId = category?.id ?? transaction.categoryId;
    const key = categoryId ?? categoryName;
    const current = rowsByKey.get(key) ?? {
      amount: 0,
      categoryId,
      categoryName,
      color: category?.color ?? null,
      count: 0,
      href: categoryTransactionsHref(categoryId, categoryName)
    };

    current.amount = roundMoney(current.amount + amount);
    current.count += 1;
    rowsByKey.set(key, current);
  });

  return [...rowsByKey.values()]
    .sort((left, right) => right.amount - left.amount || left.categoryName.localeCompare(right.categoryName));
}

function SyncObservabilityPanel({
  connections,
  latestRun
}: {
  connections: PlaidConnectionSummary[];
  latestRun: PlaidPersistedSyncRunSummary | null;
}) {
  const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
  const latestRunStatus = latestRun ? latestRun.status : "never";
  const latestRunTone = latestRun?.status === "succeeded" ? styles.statusReady : styles.statusFallback;
  const totalChangedRows = latestRun
    ? latestRun.rawTransactionsUpserted + latestRun.enrichedTransactionsInserted + latestRun.enrichedTransactionsUpdated + latestRun.transactionsRemoved
    : 0;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.eyebrow}>Sync observability</div>
          <h2>Latest Plaid run</h2>
        </div>
        <span className={`${styles.statusPill} ${latestRunTone}`}>
          <Clock3 size={13} aria-hidden />
          {latestRun ? latestRunStatus : "No run"}
        </span>
      </div>
      <div className={styles.metricGrid}>
        <SettingMetric icon={Clock3} label="Completed" value={formatSyncDate(latestRun?.completedAt ?? null)} />
        <SettingMetric icon={Database} label="Changed rows" value={totalChangedRows.toLocaleString("en-US")} />
        <SettingMetric icon={CheckCircle2} label="Succeeded items" value={(latestRun?.succeeded ?? 0).toLocaleString("en-US")} />
        <SettingMetric icon={TriangleAlert} label="Failed items" value={(latestRun?.failed ?? 0).toLocaleString("en-US")} />
      </div>
      {latestRun ? (
        <div className={styles.settingList}>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingTitle}>{formatSource(latestRun.source)} sync run</div>
              <div className={styles.settingSub}>
                {latestRun.totalItems.toLocaleString("en-US")} items, {latestRun.rawTransactionsUpserted.toLocaleString("en-US")} raw upserts, {latestRun.rawTransactionsSkipped.toLocaleString("en-US")} skipped raw rows.
              </div>
            </div>
            <span className={styles.providerMeta}>{latestRun.errorCode ?? "No safe error"}</span>
          </div>
          {latestRun.items.map((item) => {
            const connection = connectionById.get(item.id);
            return (
              <div className={styles.settingRow} key={item.id}>
                <div>
                  <div className={styles.settingTitle}>{connection?.institutionName ?? "Plaid item"}</div>
                  <div className={styles.settingSub}>
                    {item.rawTransactionsUpserted.toLocaleString("en-US")} raw, {(item.enrichedTransactionsInserted + item.enrichedTransactionsUpdated).toLocaleString("en-US")} enriched, {item.transactionsRemoved.toLocaleString("en-US")} removed
                    {item.errorCode ? ` | ${item.errorCode}` : ""}
                  </div>
                </div>
                <span className={`${styles.statusPill} ${item.status === "succeeded" ? styles.statusReady : styles.statusFallback}`}>
                  {item.status}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.settingList}>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingTitle}>No persisted sync run yet</div>
              <div className={styles.settingSub}>Manual, initial, and scheduled Plaid syncs will write safe per-run summaries here.</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}


function formatRuleIntent(intent: MerchantRuleRow["intent"]) {
  return intent ? intent[0].toUpperCase() + intent.slice(1) : "Any intent";
}

function formatRuleAmount(rule: MerchantRuleRow) {
  if (rule.min_amount === null && rule.max_amount === null) return "Any amount";
  if (rule.min_amount !== null && rule.max_amount !== null) {
    return `${moneyFormatter.format(rule.min_amount)} - ${moneyFormatter.format(rule.max_amount)}`;
  }
  if (rule.min_amount !== null) return `Min ${moneyFormatter.format(rule.min_amount)}`;
  return `Max ${moneyFormatter.format(rule.max_amount ?? 0)}`;
}

function MerchantRulesPanel({
  categories,
  merchantRules
}: {
  categories: CategoryRecord[];
  merchantRules: MerchantRuleRow[];
}) {
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const activeRules = merchantRules.filter((rule) => rule.enabled);
  const recentRules = [...activeRules]
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, 6);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.eyebrow}>Merchant rules</div>
          <h2>Saved category automation</h2>
        </div>
        <span className={`${styles.statusPill} ${activeRules.length > 0 ? styles.statusReady : styles.statusFallback}`}>
          <GitBranch size={13} aria-hidden />
          {activeRules.length.toLocaleString("en-US")} active
        </span>
      </div>
      <div className={styles.settingList}>
        {recentRules.length === 0 ? (
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingTitle}>No active merchant rules yet</div>
              <div className={styles.settingSub}>Accept AI cleanup suggestions from Review to save reusable merchant/category rules for future Plaid imports.</div>
            </div>
            <Link className={styles.checkAction} href="/review">
              Open review
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        ) : (
          recentRules.map((rule) => {
            const categoryName = rule.category_id ? categoryById.get(rule.category_id) ?? "Unknown category" : "Any category";
            const merchantLabel = rule.normalized_merchant_name ?? rule.merchant_pattern;

            return (
              <div className={styles.ruleRow} key={rule.id}>
                <span className={styles.ruleIcon}>
                  <SlidersHorizontal size={14} aria-hidden />
                </span>
                <div className={styles.ruleCopy}>
                  <div className={styles.settingTitle}>{merchantLabel}</div>
                  <div className={styles.settingSub}>
                    Matches <strong>{rule.merchant_pattern}</strong> → {categoryName} / {formatRuleIntent(rule.intent)}
                    {rule.is_recurring !== null ? ` / ${rule.is_recurring ? "recurring" : "not recurring"}` : ""}
                  </div>
                  {rule.notes ? <div className={styles.ruleNote}>{rule.notes}</div> : null}
                </div>
                <span className={styles.providerMeta}>{formatRuleAmount(rule)}</span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function checklistStatusIcon(item: FirstRunChecklistItem) {
  if (item.status === "complete") return CheckCircle2;
  if (item.status === "blocked") return Circle;
  return Clock3;
}

function SetupChecklist({ checklist }: { checklist: ReturnType<typeof buildFirstRunChecklist> }) {
  const progressLabel = `${checklist.completedFinanceItems} of ${checklist.financeItems} finance steps complete`;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.eyebrow}>First run</div>
          <h2>Setup checklist</h2>
        </div>
        <span className={styles.progressPill}>{progressLabel}</span>
      </div>
      <div className={styles.checklist}>
        {checklist.items.map((item) => {
          const Icon = checklistStatusIcon(item);
          return (
            <div className={styles.checklistItem} key={item.id}>
              <span className={`${styles.checkIcon} ${styles[`checkIcon${item.status}`]}`}>
                <Icon size={15} aria-hidden />
              </span>
              <div className={styles.checkCopy}>
                <div className={styles.checkTitleRow}>
                  <span className={styles.settingTitle}>{item.title}</span>
                  <span className={`${styles.checkBadge} ${styles[`checkBadge${item.status}`]}`}>
                    {item.group === "optional" ? "Optional" : item.status}
                  </span>
                </div>
                <div className={styles.settingSub}>{item.detail}</div>
              </div>
              <Link className={styles.checkAction} href={item.actionHref}>
                {item.actionLabel}
                <ArrowRight size={13} aria-hidden />
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SettingsView({
  accounts,
  aiProviderStatus,
  categories,
  dataError,
  isConfigured,
  isDemo,
  isSignedIn,
  latestPlaidSyncRun,
  merchantRules,
  plaidConnections,
  recurringExpenses,
  reviewItems,
  transactions
}: SettingsViewProps) {
  const spendingTransactions = transactions.filter((transaction) => transaction.amount < 0 && transaction.intent !== "transfer").length;
  const activeRecurring = recurringExpenses.filter((expense) => expense.status === "active" || expense.status === "pending").length;
  const activeMerchantRules = merchantRules.filter((rule) => rule.enabled).length;
  const spendingSummary = buildSpendingInsightSummary(transactions);
  const categoryConfidence = spendingSummary.confidence;
  const currentMonthFrom = `${spendingSummary.asOfDate.slice(0, 7)}-01`;
  const categorySpendingRows = buildCategorySpendingRows(
    categories,
    transactions,
    currentMonthFrom,
    spendingSummary.asOfDate
  );
  const checklist = buildFirstRunChecklist({
    accounts,
    aiProviderStatus,
    dataError,
    isConfigured,
    isDemo,
    isSignedIn,
    plaidConnections,
    recurringExpenses,
    reviewItems,
    transactions
  });

  return (
    <div className={styles.shell}>
      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so workspace metrics cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in with Supabase Auth to load your connected workspace.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      <SetupChecklist checklist={checklist} />

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <div className={styles.eyebrow}>Workspace</div>
            <h2>Personal Ledger</h2>
          </div>
          <span className={styles.dataPill}>Live data</span>
        </div>
        <div className={styles.metricGrid}>
          <SettingMetric icon={WalletCards} label="Connected accounts" value={accounts.length.toLocaleString("en-US")} />
          <SettingMetric icon={Repeat} label="Recurring items" value={activeRecurring.toLocaleString("en-US")} />
          <SettingMetric icon={TriangleAlert} label="Review queue" value={reviewItems.length.toLocaleString("en-US")} />
          <SettingMetric icon={Database} label="Spend records" value={spendingTransactions.toLocaleString("en-US")} />
        </div>
      </section>

      <PlaidConnectionPanel />

      <SyncObservabilityPanel connections={plaidConnections} latestRun={latestPlaidSyncRun} />

      <CategoryManager categories={categories} spendingRows={categorySpendingRows} />

      <MerchantRulesPanel categories={categories} merchantRules={merchantRules} />

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <div className={styles.eyebrow}>AI provider</div>
            <h2>Suggestion status</h2>
          </div>
          <span className={`${styles.statusPill} ${aiProviderStatus.configured ? styles.statusReady : styles.statusFallback}`}>
            <BrainCircuit size={13} aria-hidden />
            {aiProviderStatus.activeKind === "openai" ? "OpenAI ready" : "Fallback active"}
          </span>
        </div>
        <div className={styles.settingList}>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingTitle}>{aiProviderStatus.label}</div>
              <div className={styles.settingSub}>{aiProviderStatus.summary}</div>
            </div>
            <span className={styles.providerMeta}>
              {aiProviderStatus.model ?? "No external model"}
            </span>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <div className={styles.eyebrow}>Session</div>
            <h2>Access</h2>
          </div>
          <ShieldCheck size={16} aria-hidden />
        </div>
        <div className={styles.accessRow}>
          <div>
            <div className={styles.settingTitle}>Supabase Auth</div>
            <div className={styles.settingSub}>The app shell uses the current authenticated session for all finance data.</div>
          </div>
          <form action="/login/logout" method="post">
            <button className={styles.secondaryButton} type="submit">
              <LogOut size={14} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
