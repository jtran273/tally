import assert from "node:assert/strict";
import test from "node:test";
import { isSessionBypassPath } from "./middleware";

test("OpenClaw API routes bypass Supabase session redirects", () => {
  assert.equal(isSessionBypassPath("/api/openclaw/signals"), true);
  assert.equal(isSessionBypassPath("/api/openclaw/replies"), true);
  assert.equal(isSessionBypassPath("/api/openclaw"), true);
});

test("Google Calendar OAuth callback bypasses Supabase session redirects", () => {
  assert.equal(isSessionBypassPath("/api/calendar/callback"), true);
});

test("ordinary app and API routes still require the normal session path", () => {
  assert.equal(isSessionBypassPath("/dashboard"), false);
  assert.equal(isSessionBypassPath("/api/plaid/sync"), false);
  assert.equal(isSessionBypassPath("/api/calendar/connections"), false);
  assert.equal(isSessionBypassPath("/api/openclawish/signals"), false);
});
