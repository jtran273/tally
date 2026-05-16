import { PlaidConnectionPanel } from "@/components/plaid/plaid-connection-panel";
import { GoogleCalendarConnectionPanel } from "@/components/calendar/google-calendar-connection-panel";
import { Button, Notice, Panel, PanelHeader, SectionHeading } from "@/components/ui/primitives";
import { LogOut, ShieldCheck } from "lucide-react";
import styles from "./settings.module.css";

interface SettingsViewProps {
  calendarError?: string | null;
  calendarMessage?: string | null;
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
}

export function SettingsView({
  calendarError,
  calendarMessage,
  dataError,
  isConfigured,
  isDemo,
  isSignedIn
}: SettingsViewProps) {
  return (
    <div className={styles.shell}>
      {!isConfigured ? (
        <Notice role="status">
          Supabase is not configured for this environment, so bank connections cannot be loaded.
        </Notice>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <Notice role="status">
          Sign in to manage bank connections.
        </Notice>
      ) : null}

      {dataError ? (
        <Notice role="alert" tone="error">
          {dataError}
        </Notice>
      ) : null}

      <PlaidConnectionPanel isDemo={isDemo} />

      <GoogleCalendarConnectionPanel
        isDemo={isDemo}
        initialError={calendarError}
        initialSuccessMessage={calendarMessage}
      />

      <Panel>
        <PanelHeader
          actions={(
            <ShieldCheck size={16} aria-hidden />
          )}
        >
          <SectionHeading eyebrow="Session" title="Access" />
        </PanelHeader>
        <div className={styles.accessRow}>
          <div>
            <div className={styles.settingTitle}>Signed-in access</div>
            <div className={styles.settingSub}>Sign out clears the current app session.</div>
          </div>
          <form action="/login/logout" method="post">
            <Button tone="secondary" type="submit">
              <LogOut size={14} aria-hidden />
              Sign out
            </Button>
          </form>
        </div>
      </Panel>
    </div>
  );
}
