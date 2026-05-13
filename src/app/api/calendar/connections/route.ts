import { isDemoMode } from "@/lib/demo/auth";
import {
  listGoogleCalendarConnections,
  requireCalendarRouteUser
} from "@/lib/calendar";
import { jsonNoStore } from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET() {
  if (await isDemoMode()) {
    return jsonNoStore({ connections: [] });
  }

  const context = await requireCalendarRouteUser();
  if ("response" in context) return context.response;

  try {
    const connections = await listGoogleCalendarConnections(context.supabase, context.user.id);
    return jsonNoStore({ connections });
  } catch (error) {
    console.error("google_calendar_connections_list_failed", error);
    return jsonNoStore({ error: "Unable to load Google Calendar connections." }, { status: 500 });
  }
}
