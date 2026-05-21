import { NextResponse, type NextRequest } from "next/server";
import {
  createCalendarRouteWriteClient,
  exchangeGoogleCalendarCode,
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  CalendarRouteConfigurationError,
  GoogleCalendarConfigurationError,
  requireCalendarRouteUser,
  verifyGoogleCalendarOAuthState,
  upsertGoogleCalendarConnection
} from "@/lib/calendar";
import { logSafeError } from "@/lib/security/logging";

export const runtime = "nodejs";

function settingsRedirect(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/settings", request.nextUrl.origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/api/calendar/callback",
    sameSite: "lax",
    secure: isProductionRuntime()
  });
  return response;
}

function redirectToSettings(request: NextRequest, params: Record<string, string>) {
  return clearStateCookie(NextResponse.redirect(settingsRedirect(request, params)));
}

export async function GET(request: NextRequest) {
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return redirectToSettings(request, { calendar_error: "google_denied" });
  }

  const state = request.nextUrl.searchParams.get("state") ?? "";
  const stateCookie = request.cookies.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value ?? "";
  let verifiedState: ReturnType<typeof verifyGoogleCalendarOAuthState>;
  try {
    verifiedState = state && stateCookie ? verifyGoogleCalendarOAuthState(state, stateCookie) : null;
  } catch (error) {
    if (error instanceof GoogleCalendarConfigurationError) {
      return redirectToSettings(request, { calendar_error: "not_configured" });
    }
    throw error;
  }

  if (!verifiedState) {
    return redirectToSettings(request, { calendar_error: "invalid_state" });
  }

  const code = request.nextUrl.searchParams.get("code")?.trim();
  if (!code) {
    return redirectToSettings(request, { calendar_error: "missing_code" });
  }

  const context = await requireCalendarRouteUser();
  if ("response" in context) {
    return redirectToSettings(request, { calendar_error: "auth_required" });
  }
  if (context.user.id !== verifiedState.userId) {
    return redirectToSettings(request, { calendar_error: "invalid_state" });
  }

  try {
    const writeClient = createCalendarRouteWriteClient();
    const tokens = await exchangeGoogleCalendarCode(code);
    await upsertGoogleCalendarConnection(writeClient, context.user.id, tokens);
    return redirectToSettings(request, { calendar: "connected" });
  } catch (error) {
    if (error instanceof GoogleCalendarConfigurationError || error instanceof CalendarRouteConfigurationError) {
      return redirectToSettings(request, { calendar_error: "not_configured" });
    }

    logSafeError("google_calendar_callback_failed", error);
    return redirectToSettings(request, { calendar_error: "connection_failed" });
  }
}
