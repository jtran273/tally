import { PlaidConnectionPanel } from "@/components/plaid/plaid-connection-panel";
import type {
  AccountRecord,
  RecurringExpenseRecord,
  ReviewQueueItem,
  TransactionRecord
} from "@/lib/db";
import type { AiProviderStatus } from "@/lib/ai/server";
import type { PlaidConnectionSummary } from "@/lib/plaid/service";
import { buildFirstRunChecklist, type FirstRunChecklistItem } from "@/lib/settings/first-run-checklist";
import { ArrowRight, BrainCircuit, CheckCircle2, Circle, Clock3, Database, LogOut, Repeat, ShieldCheck, TriangleAlert, WalletCards, type LucideIcon } from "lucide-react";
import Link from "next/link";
import styles from "./settings.module.css";

interface SettingsViewProps {
  accounts: AccountRecord[];
  aiProviderStatus: AiProviderStatus;
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
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
  dataError,
  isConfigured,
  isDemo,
  isSignedIn,
  plaidConnections,
  recurringExpenses,
  reviewItems,
  transactions
}: SettingsViewProps) {
  const spendingTransactions = transactions.filter((transaction) => transaction.amount < 0 && transaction.intent !== "transfer").length;
  const activeRecurring = recurringExpenses.filter((expense) => expense.status === "active" || expense.status === "pending").length;
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

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <div className={styles.eyebrow}>Review rules</div>
            <h2>Real transaction guardrails</h2>
          </div>
        </div>
        <div className={styles.settingList}>
          <SettingToggle label="Flag unmapped categories" detail="Plaid rows without a linked app category stay in review." checked />
          <SettingToggle label="Flag low confidence rows" detail="Weak category confidence is kept out of trusted review status." checked />
          <SettingToggle label="Detect recurring charges" detail="Repeated real merchants can be confirmed before joining fixed costs." checked />
        </div>
      </section>

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
          <SettingToggle
            label="Human approval required"
            detail="AI suggestions are advisory and do not edit enriched transactions unless a reviewer accepts them."
            checked
          />
          <SettingToggle
            label="Server-only credentials"
            detail="The browser receives provider status only; API keys stay in server environment variables."
            checked
          />
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
