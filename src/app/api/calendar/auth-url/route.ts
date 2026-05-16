import { type NextRequest } from "next/server";
import { isDemoMode } from "@/lib/demo/auth";
import {
  buildGoogleCalendarAuthUrl,
  createGoogleCalendarOAuthState,
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  GOOGLE_CALENDAR_OAUTH_STATE_MAX_AGE_SECONDS,
  GoogleCalendarConfigurationError,
  requireCalendarRouteUser
} from "@/lib/calendar";
import { logSafeError } from "@/lib/security/logging";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";

export const runtime = "nodejs";

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (await isDemoMode()) {
    return jsonNoStore({ error: "Demo mode does not connect Google Calendar." }, { status: 403 });
  }

  const context = await requireCalendarRouteUser();
  if ("response" in context) return context.response;

  try {
    const oauthState = createGoogleCalendarOAuthState(context.user.id);
    const response = jsonNoStore({ authUrl: buildGoogleCalendarAuthUrl(oauthState.state) });
    response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, oauthState.cookieValue, {
      httpOnly: true,
      maxAge: GOOGLE_CALENDAR_OAUTH_STATE_MAX_AGE_SECONDS,
      path: "/api/calendar/callback",
      sameSite: "lax",
      secure: isProductionRuntime()
    });

    return response;
  } catch (error) {
    if (error instanceof GoogleCalendarConfigurationError) {
      return jsonNoStore({ error: "Google Calendar integration is not configured." }, { status: 503 });
    }

    logSafeError("google_calendar_auth_url_failed", error);
    return jsonNoStore({ error: "Unable to start Google Calendar connection." }, { status: 500 });
  }
}
