import assert from "node:assert/strict";
import test from "node:test";
import type { NextRequest } from "next/server";
import { POST } from "./route";

const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const originalRefreshToken = process.env.OPENCLAW_PLAID_REFRESH_TOKEN;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalUserId = process.env.OPENCLAW_USER_ID;

test.afterEach(() => {
  restoreEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", originalAnonKey);
  restoreEnv("OPENCLAW_PLAID_REFRESH_TOKEN", originalRefreshToken);
  restoreEnv("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
  restoreEnv("NEXT_PUBLIC_SUPABASE_URL", originalSupabaseUrl);
  restoreEnv("OPENCLAW_USER_ID", originalUserId);
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function refreshRequest(token?: string) {
  return new Request("http://localhost/api/openclaw/plaid-refresh", {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    method: "POST"
  }) as NextRequest;
}

test("OpenClaw Plaid refresh route rejects unauthorized callers", async () => {
  process.env.OPENCLAW_PLAID_REFRESH_TOKEN = "test-openclaw-refresh-token";

  const response = await POST(refreshRequest("wrong-token"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "OpenClaw Plaid refresh is not authorized." });
});

test("OpenClaw Plaid refresh route reports missing server configuration", async () => {
  process.env.OPENCLAW_PLAID_REFRESH_TOKEN = "test-openclaw-refresh-token";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.OPENCLAW_USER_ID;

  const response = await POST(refreshRequest("test-openclaw-refresh-token"));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "OpenClaw integration is not configured." });
});
