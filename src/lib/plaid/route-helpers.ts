import { createClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";
import { jsonNoStore } from "../security/request";
import { getSupabaseConfig } from "../supabase/env";
import { createSupabaseServerClient } from "../supabase/server";
import { getPlaidErrorStatus, logPlaidError, PlaidRouteConfigurationError } from "./errors";

export async function requirePlaidRouteUser() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      response: jsonNoStore({ error: "Authentication is not configured." }, { status: 503 })
    } as const;
  }

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      response: jsonNoStore({ error: "Authentication required." }, { status: 401 })
    } as const;
  }

  return { supabase, user } as const;
}

export function plaidRouteError(context: string, error: unknown, userMessage: string) {
  logPlaidError(context, error);

  return jsonNoStore(
    { error: userMessage },
    { status: getPlaidErrorStatus(error) }
  );
}

export function createPlaidRouteWriteClient() {
  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!config || !serviceRoleKey) {
    throw new PlaidRouteConfigurationError("Missing Supabase server write configuration.");
  }

  return createClient<Database>(config.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
