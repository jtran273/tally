"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getRequiredSupabaseConfig, type SupabaseConfig } from "./env";

export function createSupabaseBrowserClient(config?: SupabaseConfig) {
  const { anonKey, url } = config ?? getRequiredSupabaseConfig();

  return createBrowserClient(url, anonKey);
}
