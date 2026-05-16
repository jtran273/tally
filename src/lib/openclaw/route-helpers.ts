import { createClient } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import type { Database, FinanceSupabaseClient } from "@/lib/db";
import { isAuthorizedBearerToken, jsonNoStore } from "@/lib/security/request";
import { getSupabaseConfig } from "@/lib/supabase/env";

export class OpenClawRouteConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawRouteConfigurationError";
  }
}

export interface OpenClawServiceContext {
  client: FinanceSupabaseClient;
  userId: string;
}

function configuredOpenClawToken() {
  return process.env.OPENCLAW_TOKEN?.trim() || null;
}

export function isAuthorizedOpenClawRequest(headers: Headers) {
  return isAuthorizedBearerToken(headers, configuredOpenClawToken());
}

export function requireOpenClawAuth(request: NextRequest) {
  return isAuthorizedOpenClawRequest(request.headers)
    ? null
    : jsonNoStore({ error: "OpenClaw request is not authorized." }, { status: 401 });
}

export function createOpenClawServiceContext(): OpenClawServiceContext {
  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const userId = process.env.OPENCLAW_USER_ID?.trim();

  if (!config || !serviceRoleKey || !userId) {
    throw new OpenClawRouteConfigurationError(
      "Missing OpenClaw server configuration. Set OPENCLAW_TOKEN, OPENCLAW_USER_ID, and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return {
    client: createClient<Database>(config.url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }) as unknown as FinanceSupabaseClient,
    userId
  };
}
