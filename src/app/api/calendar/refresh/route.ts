import { type NextRequest } from "next/server";
import { isDemoMode } from "@/lib/demo/auth";
import type { FinanceSupabaseClient } from "@/lib/db";
import {
  CalendarRouteConfigurationError,
  GoogleCalendarConfigurationError,
  createCalendarRouteWriteClient,
  listGoogleCalendarConnections,
  loadUpcomingCalendarContext,
  requireCalendarRouteUser,
  type GoogleCalendarConnectionSummary,
  type UpcomingCalendarContext
} from "@/lib/calendar";
import { logSafeError } from "@/lib/security/logging";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";

export const runtime = "nodejs";

interface CalendarRefreshRouteUserContext {
  supabase: FinanceSupabaseClient;
  user: {
    id: string;
  };
}

interface CalendarRefreshDependencies {
  createWriteClient: () => FinanceSupabaseClient;
  isDemo: () => Promise<boolean>;
  listConnections: (client: FinanceSupabaseClient, userId: string) => Promise<GoogleCalendarConnectionSummary[]>;
  loadContext: (client: FinanceSupabaseClient, userId: string) => Promise<UpcomingCalendarContext>;
  requireUser: () => Promise<CalendarRefreshRouteUserContext | { response: Response }>;
}

function activeCalendarConnection(connections: GoogleCalendarConnectionSummary[]) {
  return connections.find((connection) => connection.status === "active") ?? null;
}

export async function refreshGoogleCalendarRoute(
  request: NextRequest,
  dependencies: CalendarRefreshDependencies = {
    createWriteClient: createCalendarRouteWriteClient,
    isDemo: isDemoMode,
    listConnections: listGoogleCalendarConnections,
    loadContext: loadUpcomingCalendarContext,
    requireUser: requireCalendarRouteUser
  }
) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (await dependencies.isDemo()) {
    return jsonNoStore({ connection: null, connections: [], eventCount: 0 });
  }

  const context = await dependencies.requireUser();
  if ("response" in context) return context.response;

  try {
    const writeClient = dependencies.createWriteClient();
    const calendarContext = await dependencies.loadContext(writeClient, context.user.id);
    const connections = await dependencies.listConnections(writeClient, context.user.id);

    return jsonNoStore({
      connection: activeCalendarConnection(connections),
      connections,
      eventCount: calendarContext.eventCount
    });
  } catch (error) {
    if (error instanceof GoogleCalendarConfigurationError || error instanceof CalendarRouteConfigurationError) {
      return jsonNoStore({ error: "Google Calendar integration is not configured." }, { status: 503 });
    }

    logSafeError("google_calendar_refresh_failed", error);
    return jsonNoStore({ error: "Unable to refresh Google Calendar." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return refreshGoogleCalendarRoute(request);
}
