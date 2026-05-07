import { PlaidConnectionPanel } from "@/components/plaid/plaid-connection-panel";
import type {
  AccountRecord,
  RecurringExpenseRecord,
  ReviewQueueItem,
  TransactionRecord
} from "@/lib/db";
import type { AiProviderStatus } from "@/lib/ai/server";
import { BrainCircuit, Database, LogOut, Repeat, ShieldCheck, TriangleAlert, WalletCards, type LucideIcon } from "lucide-react";
import styles from "./settings.module.css";

interface SettingsViewProps {
  accounts: AccountRecord[];
  aiProviderStatus: AiProviderStatus;
  dataError?: string;
  isConfigured: boolean;
  isSignedIn: boolean;
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

export function SettingsView({
  accounts,
  aiProviderStatus,
  dataError,
  isConfigured,
  isSignedIn,
  recurringExpenses,
  reviewItems,
  transactions
}: SettingsViewProps) {
  const spendingTransactions = transactions.filter((transaction) => transaction.amount < 0 && transaction.intent !== "transfer").length;
  const activeRecurring = recurringExpenses.filter((expense) => expense.status === "active" || expense.status === "pending").length;

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
