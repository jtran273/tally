import assert from "node:assert/strict";
import test from "node:test";
import { AuthApiError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { isInvalidRefreshTokenAuthError, isSupabaseAuthCookieName } from "./auth-errors";
import { buildLoggedOutRedirect, isSessionBypassPath, updateSession } from "./middleware";

test("OpenClaw API routes bypass Supabase session redirects", () => {
  assert.equal(isSessionBypassPath("/api/openclaw/signals"), true);
  assert.equal(isSessionBypassPath("/api/openclaw/replies"), true);
  assert.equal(isSessionBypassPath("/api/openclaw/query"), true);
  assert.equal(isSessionBypassPath("/api/openclaw/plaid-refresh"), true);
  assert.equal(isSessionBypassPath("/api/openclaw/briefing/scheduled"), true);
});

test("OpenClaw bypass is default-deny — unknown subpaths are not allowlisted", () => {
  // Adding a new OpenClaw route requires editing SESSION_BYPASS_PATHS so the
  // route's auth scheme gets a deliberate review.
  assert.equal(isSessionBypassPath("/api/openclaw"), false);
  assert.equal(isSessionBypassPath("/api/openclaw/admin"), false);
  assert.equal(isSessionBypassPath("/api/openclaw/totally-new"), false);
});

test("scheduled proactive scan bypasses Supabase session redirects", () => {
  assert.equal(isSessionBypassPath("/api/agents/proactive-scan/scheduled"), true);
  assert.equal(isSessionBypassPath("/api/agents/proactive-scan/scheduled/extra"), true);
  assert.equal(isSessionBypassPath("/api/agents/proactive-scan"), false);
});

test("scheduled Plaid sync bypasses Supabase session redirects", () => {
  assert.equal(isSessionBypassPath("/api/plaid/sync/scheduled"), true);
  assert.equal(isSessionBypassPath("/api/plaid/sync/scheduled/extra"), true);
});

test("scheduled Plaid sync reaches its route handler without a browser session", async () => {
  const response = await updateSession(new NextRequest("http://localhost/api/plaid/sync/scheduled"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.has("location"), false);
});

test("Google Calendar OAuth callback bypasses Supabase session redirects", () => {
  assert.equal(isSessionBypassPath("/api/calendar/callback"), true);
});

test("ordinary app and API routes still require the normal session path", () => {
  assert.equal(isSessionBypassPath("/dashboard"), false);
  assert.equal(isSessionBypassPath("/api/plaid/sync"), false);
  assert.equal(isSessionBypassPath("/api/calendar/connections"), false);
  assert.equal(isSessionBypassPath("/api/agents/proactive-scanner"), false);
  assert.equal(isSessionBypassPath("/api/openclawish/signals"), false);
});

test("invalid Supabase refresh-token errors are recognized without treating all auth errors as stale sessions", () => {
  assert.equal(
    isInvalidRefreshTokenAuthError(
      new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found")
    ),
    true
  );
  assert.equal(isInvalidRefreshTokenAuthError(new AuthApiError("User not found", 400, "user_not_found")), false);
  assert.equal(isInvalidRefreshTokenAuthError(new Error("Invalid Refresh Token: Refresh Token Not Found")), false);
});

test("stale Supabase auth cookies are cleared when redirecting a logged-out session", () => {
  const request = new NextRequest("http://localhost/dashboard", {
    headers: {
      cookie: [
        "sb-project-auth-token=stale",
        "sb-project-auth-token.0=stale",
        "supabase-auth-token=stale",
        "other=value"
      ].join("; ")
    }
  });

  const response = buildLoggedOutRedirect(request, { clearAuthCookies: true });
  const setCookieHeaders = response.headers.getSetCookie();

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/login?redirectedFrom=%2Fdashboard");
  assert.equal(setCookieHeaders.some((header) => header.startsWith("sb-project-auth-token=")), true);
  assert.equal(setCookieHeaders.some((header) => header.startsWith("sb-project-auth-token.0=")), true);
  assert.equal(setCookieHeaders.some((header) => header.startsWith("supabase-auth-token=")), true);
  assert.equal(setCookieHeaders.some((header) => header.startsWith("other=")), false);
});

test("Supabase auth cookie name matching stays scoped to auth-token cookies", () => {
  assert.equal(isSupabaseAuthCookieName("sb-project-auth-token"), true);
  assert.equal(isSupabaseAuthCookieName("sb-project-auth-token.0"), true);
  assert.equal(isSupabaseAuthCookieName("supabase-auth-token"), true);
  assert.equal(isSupabaseAuthCookieName("sb-project-preferences"), false);
});
