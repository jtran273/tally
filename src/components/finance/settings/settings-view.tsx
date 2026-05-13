import { PlaidConnectionPanel } from "@/components/plaid/plaid-connection-panel";
import { GoogleCalendarConnectionPanel } from "@/components/calendar/google-calendar-connection-panel";
import { LogOut, ShieldCheck } from "lucide-react";
import styles from "./settings.module.css";

interface SettingsViewProps {
  calendarError?: string | null;
  calendarMessage?: string | null;
  dataError?: string;
  isConfigured: boolean;
  isSignedIn: boolean;
}

export function SettingsView({
  calendarError,
  calendarMessage,
  dataError,
  isConfigured,
  isSignedIn
}: SettingsViewProps) {
  return (
    <div className={styles.shell}>
      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so bank connections cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in to manage bank connections.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      <PlaidConnectionPanel />

      <GoogleCalendarConnectionPanel
        initialError={calendarError}
        initialSuccessMessage={calendarMessage}
      />

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
            <div className={styles.settingTitle}>Signed-in access</div>
            <div className={styles.settingSub}>Sign out clears the current app session.</div>
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
