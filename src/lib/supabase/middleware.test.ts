import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { isSessionBypassPath, updateSession } from "./middleware";

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
