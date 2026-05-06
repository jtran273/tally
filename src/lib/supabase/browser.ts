"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getRequiredSupabaseConfig } from "./env";

export function createSupabaseBrowserClient() {
  const { anonKey, url } = getRequiredSupabaseConfig();

  return createBrowserClient(url, anonKey);
}
