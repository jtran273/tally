import { NextRequest } from "next/server";

// Shared helpers for the OpenClaw API route tests. This file is intentionally
// not a `*.test.ts` (so the test runner does not execute it) and not a Next.js
// route file (so it is never bundled into the deployed app).

export const OPENCLAW_TEST_TOKEN = "test-openclaw-token";

const ENV_KEYS = [
  "OPENCLAW_TOKEN",
  "OPENCLAW_USER_ID",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
] as const;

let saved: Map<string, string | undefined> | null = null;

export function saveOpenClawEnv() {
  saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
}

export function restoreOpenClawEnv() {
  if (!saved) return;
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  saved = null;
}

// Authorized caller with a fully configured server integration. DB calls are
// never reached in these tests because requests fail earlier (bad input) or are
// exercised only for their auth/validation behavior.
export function configureOpenClawServer() {
  process.env.OPENCLAW_TOKEN = OPENCLAW_TEST_TOKEN;
  process.env.OPENCLAW_USER_ID = "user-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
}

// Authorized caller, but the server integration is not configured. Reaching the
// service context should surface a 503 rather than a generic 500.
export function configureOpenClawTokenOnly() {
  process.env.OPENCLAW_TOKEN = OPENCLAW_TEST_TOKEN;
  delete process.env.OPENCLAW_USER_ID;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function openClawRequest(
  path: string,
  {
    token,
    method = "GET",
    body,
    rawBody
  }: { token?: string; method?: string; body?: unknown; rawBody?: string } = {}
) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;

  let payload: string | undefined;
  if (rawBody !== undefined) {
    headers["content-type"] = "application/json";
    payload = rawBody;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }

  return new NextRequest(`http://localhost${path}`, {
    body: payload,
    headers,
    method
  });
}
