import { type FinanceSupabaseClient } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEMO_USER_ID, createDemoFinanceClient } from "./finance-client";
import { isDemoMode } from "./auth";

export interface FinanceServerContext {
  client: FinanceSupabaseClient | null;
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
  userId: string | null;
}

export async function getFinanceServerContext(): Promise<FinanceServerContext> {
  if (await isDemoMode()) {
    return {
      client: createDemoFinanceClient(),
      isConfigured: true,
      isDemo: true,
      isSignedIn: true,
      userId: DEMO_USER_ID
    };
  }

  const supabase = await createSupabaseServerClient();
  const context: FinanceServerContext = {
    client: null,
    isConfigured: Boolean(supabase),
    isDemo: false,
    isSignedIn: false,
    userId: null
  };

  if (!supabase) return context;

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error) {
    return {
      ...context,
      dataError: `Unable to verify Supabase session: ${error.message}`
    };
  }

  if (!user) return context;

  return {
    ...context,
    client: supabase as unknown as FinanceSupabaseClient,
    isSignedIn: true,
    userId: user.id
  };
}
