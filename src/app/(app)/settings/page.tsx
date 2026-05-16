import { SettingsView } from "@/components/finance/settings/settings-view";
import { getFinanceServerContext } from "@/lib/demo/server";

export const dynamic = "force-dynamic";

interface SettingsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function calendarMessage(value: string | undefined) {
  if (value === "connected") return "Google Calendar connected.";
  return null;
}

function calendarError(value: string | undefined) {
  if (!value) return null;
  if (value === "not_configured") return "Google Calendar OAuth is not configured for this environment.";
  if (value === "invalid_state") return "Google Calendar connection expired. Start again from this page.";
  if (value === "auth_required") return "Sign in again before connecting Google Calendar.";
  if (value === "google_denied") return "Google Calendar access was not granted.";
  return "Unable to finish the Google Calendar connection.";
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = searchParams ? await searchParams : {};
  let dataError: string | undefined;
  let isConfigured = false;
  let isDemo = false;
  let isSignedIn = false;

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isDemo = context.isDemo;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  return (
    <SettingsView
      calendarError={calendarError(firstParam(params.calendar_error))}
      calendarMessage={calendarMessage(firstParam(params.calendar))}
      dataError={dataError}
      isConfigured={isConfigured}
      isDemo={isDemo}
      isSignedIn={isSignedIn}
    />
  );
}
