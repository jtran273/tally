import { createClient } from "@supabase/supabase-js";
import type { FinanceSupabaseClient } from "@/lib/db";
import type { Database } from "@/lib/db/types";
import { jsonNoStore } from "@/lib/security/request";
import { getSupabaseConfig } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class CalendarRouteConfigurationError extends Error {
  constructor(message = "Calendar integration is not configured.") {
    super(message);
    this.name = "CalendarRouteConfigurationError";
  }
}

export async function requireCalendarRouteUser() {
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

  return { supabase: supabase as unknown as FinanceSupabaseClient, user } as const;
}

export function createCalendarRouteWriteClient(): FinanceSupabaseClient {
  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!config || !serviceRoleKey) {
    throw new CalendarRouteConfigurationError("Missing Supabase server write configuration.");
  }

  return createClient<Database>(config.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }) as unknown as FinanceSupabaseClient;
}
