import { type NextRequest } from "next/server";
import { isDemoMode } from "@/lib/demo/auth";
import {
  createCalendarRouteWriteClient,
  disconnectGoogleCalendarConnection,
  CalendarRouteConfigurationError,
  GoogleCalendarConfigurationError,
  listGoogleCalendarConnections,
  requireCalendarRouteUser
} from "@/lib/calendar";
import { logSafeError } from "@/lib/security/logging";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";

export const runtime = "nodejs";

interface CalendarConnectionRouteProps {
  params: Promise<{
    connectionId: string;
  }>;
}

export async function DELETE(request: NextRequest, { params }: CalendarConnectionRouteProps) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (await isDemoMode()) {
    return jsonNoStore({ error: "Demo mode keeps calendar connections read-only." }, { status: 403 });
  }

  const context = await requireCalendarRouteUser();
  if ("response" in context) return context.response;

  const { connectionId } = await params;
  if (!connectionId) {
    return jsonNoStore({ error: "Missing calendar connection id." }, { status: 400 });
  }

  try {
    const writeClient = createCalendarRouteWriteClient();
    const connection = await disconnectGoogleCalendarConnection(writeClient, context.user.id, connectionId);
    const connections = await listGoogleCalendarConnections(writeClient, context.user.id);
    return jsonNoStore({ connection, connections });
  } catch (error) {
    if (error instanceof GoogleCalendarConfigurationError || error instanceof CalendarRouteConfigurationError) {
      return jsonNoStore({ error: "Google Calendar integration is not configured." }, { status: 503 });
    }

    logSafeError("google_calendar_disconnect_failed", error);
    return jsonNoStore({ error: "Unable to disconnect Google Calendar." }, { status: 500 });
  }
}
